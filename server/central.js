// Modo central ("sin carné"): el alumno pulsa Conectar y acepta, sin crear apps de desarrollador.
// Contrato completo en CENTRAL.md. Resumen:
//  - GET  <broker>/config              → datos PÚBLICOS de las apps de WillyPost (client_id, config_id, relé…).
//  - POST <broker>/token/:family/:op   → el broker añade la clave secreta, llama a la red y devuelve su JSON tal cual.
// Todo lo demás (Graph API, publicar, refrescos sin secreto) sigue saliendo del ordenador del alumno.
// El carné propio, si está guardado, SIEMPRE tiene preferencia (ver resolveCreds en accounts.js).
import fs from 'node:fs';
import path from 'node:path';
import { BROKER_URL, MEDIA_PROXY, RELAY_URL, DATA_DIR } from './config.js';
import { ProviderError, httpError } from './providers/_http.js';

export const CONFIG_TTL_MS = 60 * 60 * 1000; // 1 h
const RETRY_AFTER_FAIL_MS = 60 * 1000; // sin conexión: no reintentar /config en cada clic
const CONFIG_TIMEOUT_MS = 5000;
const TOKEN_TIMEOUT_MS = 30000;
const FAMILIES = ['meta', 'instagram', 'threads', 'tiktok', 'linkedin', 'google'];
const LABELS = { meta: 'Facebook', instagram: 'Instagram', threads: 'Threads', tiktok: 'TikTok', linkedin: 'LinkedIn', google: 'Google' };

let cache = null; // { data, fetchedAt }
let lastFailAt = 0;
let inflight = null;

/**
 * Dirección del servidor central, o null si el modo central está desactivado.
 * WILLYPOST_BROKER=off lo desactiva; con otra URL se usa esa (tests, pruebas locales).
 * Dentro de `node --test` (NODE_TEST_CONTEXT) está desactivado salvo que se indique WILLYPOST_BROKER:
 * así ningún test llama de verdad a internet.
 */
export function brokerBase() {
  const env = process.env.WILLYPOST_BROKER;
  if (env != null && env !== '') {
    if (/^(off|0|false|no)$/i.test(env.trim())) return null;
    return env.trim().replace(/\/+$/, '');
  }
  if (process.env.NODE_TEST_CONTEXT) return null;
  return BROKER_URL;
}

const cacheFile = () => path.join(DATA_DIR, 'central.json');

const isHttpsUrl = (u) => {
  try { return new URL(String(u)).protocol === 'https:'; } catch { return false; }
};
const cleanStr = (v, max = 512) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** Valida y limpia la respuesta de /config. Devuelve null si no sirve. */
export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const nets = raw.networks && typeof raw.networks === 'object' && !Array.isArray(raw.networks) ? raw.networks : {};
  const networks = {};
  for (const fam of FAMILIES) {
    const n = nets[fam];
    if (!n || typeof n !== 'object') continue;
    const clientId = cleanStr(n.client_id);
    if (!clientId) continue;
    const entry = { client_id: clientId };
    if (fam === 'google') {
      // Cliente de "App de escritorio": Google considera público su secreto. Sin él no se puede canjear.
      const secret = cleanStr(n.client_secret);
      if (!secret) continue;
      entry.client_secret = secret;
    }
    if (fam === 'meta') {
      const cfgId = cleanStr(n.config_id, 64);
      if (cfgId && /^\d{5,30}$/.test(cfgId)) entry.config_id = cfgId;
    }
    networks[fam] = entry;
  }
  return {
    version: Number(raw.version) || 1,
    relay: isHttpsUrl(raw.relay) ? String(raw.relay) : RELAY_URL,
    media: isHttpsUrl(raw.media) ? String(raw.media).replace(/\/+$/, '') : MEDIA_PROXY,
    networks,
  };
}

function readPersisted() {
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    const data = sanitizeConfig(j?.data);
    return data ? { data, fetchedAt: Number(j.fetchedAt) || 0 } : null;
  } catch {
    return null;
  }
}

function persist(entry) {
  try {
    const tmp = `${cacheFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, cacheFile());
  } catch (e) {
    console.error('[central] No se pudo guardar la copia de la configuración:', e?.message || e);
  }
}

/** Configuración central ya conocida (memoria o copia en disco), sin llamar a internet. null si no hay. */
export function centralConfig() {
  if (!brokerBase()) return null;
  if (!cache) cache = readPersisted();
  return cache?.data || null;
}

/**
 * Trae /config si la copia tiene más de 1 h (o si force). Sin conexión, sigue valiendo la última copia
 * guardada en disco. Nunca lanza: devuelve la configuración o null.
 */
export async function loadCentralConfig({ force = false } = {}) {
  const base = brokerBase();
  if (!base) return null;
  if (!cache) cache = readPersisted();
  const fresh = cache && Date.now() - cache.fetchedAt < CONFIG_TTL_MS;
  if (fresh && !force) return cache.data;
  if (!force && Date.now() - lastFailAt < RETRY_AFTER_FAIL_MS) return cache?.data || null;
  inflight ||= (async () => {
    try {
      const res = await fetch(`${base}/config`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = sanitizeConfig(await res.json());
      if (!data) throw new Error('respuesta no válida');
      cache = { data, fetchedAt: Date.now() };
      lastFailAt = 0;
      persist(cache);
    } catch (e) {
      lastFailAt = Date.now();
      console.warn('[central] No se pudo leer la configuración del servidor central:', e?.message || e);
    }
    return cache?.data || null;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Solo para tests: olvida la caché en memoria. */
export function _resetCentralCache() {
  cache = null;
  lastFailAt = 0;
  inflight = null;
}

/**
 * Credenciales PÚBLICAS de la app central de una familia, o null si esa red no está en modo central.
 * Nunca contiene secretos, salvo el de Google (cliente de escritorio, público por diseño).
 */
export function centralCredsFor(family) {
  const cfg = centralConfig();
  const n = cfg?.networks?.[family];
  if (!n?.client_id) return null;
  const out = { client_id: n.client_id, extra: {}, central: true, relay: cfg.relay };
  if (family === 'google') out.client_secret = n.client_secret;
  if (family === 'meta' && n.config_id) out.extra.config_id = n.config_id;
  return out;
}

/** Mensaje en español para un error propio del servidor central (willypost_*). */
function brokerErrorMessage(status, family, code = '') {
  const label = LABELS[family] || 'la red';
  if (status === 404) {
    return `La conexión sin carné con ${label} no está disponible ahora mismo. Inténtalo más tarde o usa tu propia app de desarrollador (opción avanzada en Redes).`;
  }
  if (status === 429) return 'El servidor de WillyPost está recibiendo muchas peticiones. Espera un par de minutos y vuelve a intentarlo.';
  if (code === 'willypost_respuesta_no_valida') return `${label} ha contestado algo inesperado al servidor de WillyPost. Espera unos minutos y vuelve a intentarlo.`;
  if (status === 502 || status === 503 || status === 504) return `${label} no responde ahora mismo. Espera unos minutos y vuelve a intentarlo.`;
  if (status >= 500) return 'El servidor de WillyPost ha tenido un fallo momentáneo. Espera unos minutos y vuelve a intentarlo.';
  // 400 (petición mal formada, willypost_tipo_no_valido…), 405, 413: algo de esta versión no encaja con el servidor.
  return `WillyPost no ha podido completar la conexión con ${label}. Vuelve a pulsar Conectar; si se repite, actualiza WillyPost a la última versión.`;
}

/**
 * Canje de tokens a través del servidor central. Devuelve { status, json } con la respuesta de la red tal cual.
 * Lanza ProviderError (con .central = true) si el servidor central no responde o devuelve un error propio.
 * El cuerpo NUNCA lleva secretos: el broker los añade.
 */
export async function centralToken(family, op, body) {
  const base = brokerBase();
  if (!base) throw Object.assign(new ProviderError('El modo sin carné está desactivado en este ordenador.'), { central: true });
  let res;
  try {
    res = await fetch(`${base}/token/${encodeURIComponent(family)}/${encodeURIComponent(op)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (e) {
    const err = new ProviderError('No se pudo contactar con el servidor de WillyPost. ¿Tienes conexión a internet? Vuelve a intentarlo en un momento.', {
      retryable: true, raw: String(e?.message || e),
    });
    err.central = true;
    throw err;
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = text; }
  if (json && typeof json === 'object' && typeof json.error === 'string' && json.error.startsWith('willypost_')) {
    const s = res.status;
    const err = new ProviderError(brokerErrorMessage(s, family, json.error), {
      retryable: s === 429 || s >= 500, rateLimited: s === 429, status: s, raw: json,
    });
    err.central = true;
    throw err;
  }
  return { status: res.status, json };
}

/** Como fetchJson pero a través del servidor central: devuelve el JSON o lanza el mismo ProviderError que la red directa. */
export async function centralFetchJson(family, op, body, { label } = {}) {
  const { status, json } = await centralToken(family, op, body);
  if (status < 200 || status >= 300) throw httpError(status, json, label || LABELS[family]);
  return json;
}

/**
 * Fotos de TikTok en modo central (PULL_FROM_URL): TikTok solo descarga de dominios verificados, así que
 * la URL del túnel https://<sub>.trycloudflare.com/m/<token>/<archivo> se sirve a través de
 * https://media.<dominio>/t/<sub>/m/<token>/<archivo>. Cualquier otra URL se devuelve tal cual.
 */
export function mediaProxyUrl(url) {
  const m = /^https:\/\/([a-z0-9-]{3,63})\.trycloudflare\.com\/m\/([A-Za-z0-9_-]{16,128})\/(media\.(?:jpg|jpeg|png|webp|gif|mp4|mov|webm))$/i.exec(String(url || ''));
  if (!m) return url;
  const base = centralConfig()?.media || MEDIA_PROXY;
  return `${base}/t/${m[1].toLowerCase()}/m/${m[2]}/${m[3].toLowerCase()}`;
}
