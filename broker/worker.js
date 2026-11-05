// WillyPost · servidor central (broker OAuth) — Cloudflare Worker de un solo archivo.
//
// Qué hace (contrato completo en CENTRAL.md):
//   GET  https://auth.willypost.com/config            → datos públicos (qué redes funcionan en modo central)
//   GET  https://auth.willypost.com/health            → { ok: true, networks: [...] }
//   POST https://auth.willypost.com/token/:family/:op → añade la clave secreta y canjea el token con la red
//   GET  https://media.willypost.com/t/<sub>/m/<token>/<archivo> → reenvía la foto/vídeo del túnel del alumno
//
// Principios: sin estado, sin base de datos, NUNCA registra tokens ni cuerpos (no hay ni un console.* aquí).
// Sin dependencias y sin compilar: se puede pegar tal cual en el panel de Cloudflare.
//
// Variables (Settings → Variables and Secrets del Worker):
//   SITE, RELAY, MEDIA (texto normal; tienen valores por defecto)
//   META_APP_ID, META_APP_SECRET, META_CONFIG_ID, META_IG_CONFIG_ID, IG_APP_ID, IG_APP_SECRET, THREADS_APP_ID,
//   THREADS_APP_SECRET, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, LINKEDIN_CLIENT_ID,
//   LINKEDIN_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (secretos)
// Una red sin sus variables simplemente no aparece.

// Debe coincidir con GRAPH_VERSION de server/providers/facebook.js (única constante de versión aquí).
export const GRAPH_VERSION = 'v26.0';

const DEFAULTS = {
  SITE: 'https://willypost.com',
  RELAY: 'https://willypost.com/callback.html',
  MEDIA: 'https://media.willypost.com',
};

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 4 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const RATE_LIMIT = 300; // llamadas a /token por IP y minuto (aproximado). Alto a propósito: tras la CDN de Hostinger muchos alumnos pueden compartir IP
const RATE_WINDOW_MS = 60_000;
const TUNNEL_DOMAIN = 'trycloudflare.com';

/* ------------------------------------------------------------------ redes ------------------------------------------------------------------ */

// Variables que tiene que tener cada familia para aparecer. `public` = lo que se entrega en /config.
const FAMILIES = {
  meta: {
    id: 'META_APP_ID',
    secret: 'META_APP_SECRET',
    // META_IG_CONFIG_ID (opcional): configuración de «Facebook Login for Business» SOLO para Instagram. Las apps nuevas
    // de Meta ya no pueden usar «Instagram API with Instagram Login»: Instagram se conecta entonces a través de
    // Facebook Login (esta misma app de Meta) y publica con la Graph API de Facebook.
    public: (env) => ({
      client_id: v(env, 'META_APP_ID'),
      ...(v(env, 'META_CONFIG_ID') ? { config_id: v(env, 'META_CONFIG_ID') } : {}),
      ...(v(env, 'META_IG_CONFIG_ID') ? { ig_config_id: v(env, 'META_IG_CONFIG_ID') } : {}),
    }),
  },
  instagram: { id: 'IG_APP_ID', secret: 'IG_APP_SECRET', public: (env) => ({ client_id: v(env, 'IG_APP_ID') }) },
  threads: { id: 'THREADS_APP_ID', secret: 'THREADS_APP_SECRET', public: (env) => ({ client_id: v(env, 'THREADS_APP_ID') }) },
  tiktok: { id: 'TIKTOK_CLIENT_KEY', secret: 'TIKTOK_CLIENT_SECRET', public: (env) => ({ client_id: v(env, 'TIKTOK_CLIENT_KEY') }) },
  linkedin: { id: 'LINKEDIN_CLIENT_ID', secret: 'LINKEDIN_CLIENT_SECRET', public: (env) => ({ client_id: v(env, 'LINKEDIN_CLIENT_ID') }) },
  // Cliente «App de escritorio»: Google considera público su secreto, por eso SÍ se entrega. No tiene operaciones aquí.
  google: {
    id: 'GOOGLE_CLIENT_ID',
    secret: 'GOOGLE_CLIENT_SECRET',
    public: (env) => ({ client_id: v(env, 'GOOGLE_CLIENT_ID'), client_secret: v(env, 'GOOGLE_CLIENT_SECRET') }),
  },
};

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
// Threads: mismo dominio que usa server/providers/threads.js (graph.threads.com; antes graph.threads.net).
const THREADS_ROOT = 'https://graph.threads.com';

// Lista CERRADA de operaciones. `fields` = lo que manda la app; `build` = la llamada oficial.
// Cada build recibe (body, id, secret, relay) y devuelve { url, method, form? }.
const OPS = {
  meta: {
    code: {
      fields: ['code', 'redirect_uri'],
      build: (b, id, secret) => ({
        method: 'GET',
        url: `${GRAPH}/oauth/access_token?${qs({ client_id: id, client_secret: secret, redirect_uri: b.redirect_uri, code: b.code })}`,
      }),
    },
    long_lived: {
      fields: ['access_token'],
      build: (b, id, secret) => ({
        method: 'GET',
        url: `${GRAPH}/oauth/access_token?${qs({ grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: b.access_token })}`,
      }),
    },
  },
  instagram: {
    code: {
      fields: ['code', 'redirect_uri'],
      build: (b, id, secret) => ({
        method: 'POST',
        url: 'https://api.instagram.com/oauth/access_token',
        form: { client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: b.redirect_uri, code: b.code },
      }),
    },
    long_lived: {
      fields: ['access_token'],
      build: (b, id, secret) => ({
        method: 'GET',
        url: `https://graph.instagram.com/access_token?${qs({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: b.access_token })}`,
      }),
    },
  },
  threads: {
    code: {
      fields: ['code', 'redirect_uri'],
      build: (b, id, secret) => ({
        method: 'POST',
        url: `${THREADS_ROOT}/oauth/access_token`,
        form: { client_id: id, client_secret: secret, code: b.code, grant_type: 'authorization_code', redirect_uri: b.redirect_uri },
      }),
    },
    long_lived: {
      fields: ['access_token'],
      build: (b, id, secret) => ({
        method: 'GET',
        url: `${THREADS_ROOT}/access_token?${qs({ grant_type: 'th_exchange_token', client_secret: secret, access_token: b.access_token })}`,
      }),
    },
  },
  tiktok: {
    code: {
      fields: ['code', 'redirect_uri', 'code_verifier'],
      build: (b, id, secret) => ({
        method: 'POST',
        url: TIKTOK_TOKEN,
        form: {
          client_key: id,
          client_secret: secret,
          code: b.code,
          grant_type: 'authorization_code',
          redirect_uri: b.redirect_uri,
          code_verifier: b.code_verifier,
        },
      }),
    },
    refresh: {
      fields: ['refresh_token'],
      build: (b, id, secret) => ({
        method: 'POST',
        url: TIKTOK_TOKEN,
        form: { client_key: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: b.refresh_token },
      }),
    },
  },
  linkedin: {
    code: {
      fields: ['code', 'redirect_uri'],
      build: (b, id, secret) => ({
        method: 'POST',
        url: 'https://www.linkedin.com/oauth/v2/accessToken',
        form: { grant_type: 'authorization_code', code: b.code, client_id: id, client_secret: secret, redirect_uri: b.redirect_uri },
      }),
    },
  },
};

/* ---------------------------------------------------------------- utilidades ---------------------------------------------------------------- */

function v(env, name) {
  const val = env && env[name];
  return typeof val === 'string' ? val.trim() : '';
}

function setting(env, name) {
  return v(env, name) || DEFAULTS[name];
}

function qs(obj) {
  return new URLSearchParams(obj).toString();
}

function configured(env, family) {
  const f = Object.hasOwn(FAMILIES, family) ? FAMILIES[family] : null;
  return Boolean(f && v(env, f.id) && v(env, f.secret));
}

function configuredFamilies(env) {
  return Object.keys(FAMILIES).filter((f) => configured(env, f));
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...extra } });
}

function fail(status, motivo, message, extra = {}) {
  return json({ error: `willypost_${motivo}`, message }, status, extra);
}

const byteLength = (s) => new TextEncoder().encode(s).length;

/** Lee el cuerpo sin pasar de `limit` bytes. Devuelve el texto o null si es demasiado grande. */
async function readLimited(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* da igual */ }
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** fetch con tiempo límite SOLO hasta recibir las cabeceras (el cuerpo puede seguir llegando después). */
async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { res, ctrl, timer };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/* ------------------------------------------------------------ límite de peticiones ------------------------------------------------------------ */

// Aproximado y por copia del Worker (isolate): Cloudflare puede tener varias copias. La protección fuerte es la
// regla gratuita de «Rate limiting» del panel (ver LEEME.md). Esto solo frena abusos evidentes.
const hits = new Map(); // ip → { start, count }

function rateLimited(ip, now = Date.now()) {
  if (hits.size > 5000) {
    for (const [k, h] of hits) if (now - h.start >= RATE_WINDOW_MS) hits.delete(k);
    if (hits.size > 5000) hits.clear();
  }
  const h = hits.get(ip);
  if (!h || now - h.start >= RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  h.count += 1;
  return h.count > RATE_LIMIT;
}

/* ------------------------------------------------------------------ /token ------------------------------------------------------------------ */

async function handleToken(request, env, family, op) {
  // Solo propiedades propias (como array_key_exists en PHP): "constructor", "toString"… no son familias.
  const spec = Object.hasOwn(OPS, family) && Object.hasOwn(OPS[family], op) ? OPS[family][op] : null;
  if (!spec) return fail(404, 'operacion_desconocida', 'Esta operación no existe en el servidor central de WillyPost.');
  if (!configured(env, family)) {
    return fail(404, 'no_configurada', 'Esta red todavía no está disponible en modo central. Usa tu propia app (carné) o inténtalo más adelante.');
  }
  if (request.method !== 'POST') {
    return fail(405, 'metodo_no_permitido', 'Solo se admite POST en esta dirección.', { Allow: 'POST' });
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
  if (rateLimited(ip)) {
    return fail(429, 'demasiadas_peticiones', 'Demasiadas peticiones seguidas. Espera un minuto y vuelve a intentarlo.', { 'Retry-After': '60' });
  }

  const ctype = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (ctype !== 'application/json') {
    return fail(400, 'tipo_no_valido', 'La petición debe enviarse en formato JSON (Content-Type: application/json).');
  }
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, 'demasiado_grande', 'La petición es demasiado grande.');
  }
  const text = await readLimited(request, MAX_BODY_BYTES);
  if (text === null) return fail(413, 'demasiado_grande', 'La petición es demasiado grande.');

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'json_no_valido', 'El contenido de la petición no es un JSON válido.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'json_no_valido', 'El contenido de la petición debe ser un objeto JSON.');
  }

  const clean = {};
  for (const f of spec.fields) {
    const val = body[f];
    if (typeof val !== 'string' || val.length === 0) {
      return fail(400, 'falta_campo', `Falta el campo «${f}» o no es un texto.`);
    }
    if (byteLength(val) > MAX_FIELD_BYTES) {
      return fail(400, 'campo_demasiado_largo', `El campo «${f}» es demasiado largo.`);
    }
    clean[f] = val;
  }
  if ('redirect_uri' in clean && clean.redirect_uri !== setting(env, 'RELAY')) {
    return fail(400, 'redirect_uri_no_valida', 'La dirección de vuelta (redirect_uri) no es la del servidor central de WillyPost.');
  }

  const F = FAMILIES[family];
  const call = spec.build(clean, v(env, F.id), v(env, F.secret));
  const init = { method: call.method, headers: { Accept: 'application/json' }, redirect: 'manual' };
  if (call.form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = qs(call.form);
  }

  let res;
  let raw;
  let timer;
  try {
    const r = await fetchWithTimeout(call.url, init);
    res = r.res;
    timer = r.timer;
    raw = await res.text(); // sigue bajo el mismo tiempo límite
  } catch (e) {
    const timeout = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return fail(
      502,
      'red_no_responde',
      timeout
        ? 'La red social ha tardado demasiado en responder. Inténtalo de nuevo en unos minutos.'
        : 'No se ha podido contactar con la red social. Inténtalo de nuevo en unos minutos.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 300 && res.status < 400) {
    return fail(502, 'respuesta_no_valida', 'La red social ha respondido de una forma inesperada (redirección). Inténtalo más tarde.');
  }
  try {
    JSON.parse(raw);
  } catch {
    return json(
      { error: 'willypost_respuesta_no_valida', message: 'La red social ha respondido de una forma inesperada. Inténtalo más tarde.', status: res.status },
      502,
    );
  }
  // Tal cual: mismo JSON y mismo código HTTP que la red. No se copian sus cabeceras (cookies, etc.).
  return new Response(raw, { status: res.status, headers: BASE_HEADERS });
}

/* ------------------------------------------------------------- proxy de medios ------------------------------------------------------------- */

const MEDIA_PATH = /^\/t\/([a-z0-9-]{3,63})\/m\/([A-Za-z0-9_-]{16,128})\/(media\.(?:jpg|jpeg|png|webp|gif|mp4|mov|webm))$/;
const MEDIA_TYPE = /^(?:image\/(?:jpeg|png|webp|gif)|video\/[a-z0-9.+-]+)$/; // nunca SVG ni HTML
const RANGE = /^bytes=\d*-\d*$/;
const PASS_HEADERS = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag'];

async function handleMedia(request, url) {
  const m = url.pathname.match(MEDIA_PATH);
  if (!m) return fail(404, 'no_encontrado', 'Archivo no encontrado.');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return fail(405, 'metodo_no_permitido', 'Solo se admite GET o HEAD.', { Allow: 'GET, HEAD' });
  }
  const [, sub, token, file] = m;
  const range = request.headers.get('Range');
  if (range && !RANGE.test(range.trim())) {
    return fail(400, 'rango_no_valido', 'La cabecera Range no es válida.');
  }

  const target = `https://${sub}.${TUNNEL_DOMAIN}/m/${token}/${file}`;
  const headers = {};
  if (range) headers.Range = range.trim();

  let res;
  let timer;
  try {
    const r = await fetchWithTimeout(target, { method: request.method, headers, redirect: 'manual' });
    res = r.res;
    timer = r.timer;
  } catch (e) {
    const timeout = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
    return fail(
      502,
      'red_no_responde',
      timeout ? 'El ordenador del alumno ha tardado demasiado en responder.' : 'No se ha podido contactar con el ordenador del alumno.',
    );
  } finally {
    clearTimeout(timer); // el vídeo puede tardar en descargarse: el límite es solo hasta las cabeceras
  }

  const drop = () => { try { res.body?.cancel(); } catch { /* da igual */ } };

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    drop();
    return fail(502, 'redireccion_no_permitida', 'El archivo no se puede servir con redirecciones.');
  }
  if (res.status === 416) {
    drop();
    const out = { ...BASE_HEADERS };
    const cr = res.headers.get('Content-Range');
    if (cr) out['Content-Range'] = cr;
    return new Response(null, { status: 416, headers: out });
  }
  if (res.status !== 200 && res.status !== 206) {
    drop();
    return res.status === 404 || res.status === 410
      ? fail(404, 'no_encontrado', 'Archivo no encontrado o caducado.')
      : fail(502, 'respuesta_no_valida', 'El ordenador del alumno ha respondido con un error.');
  }
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!MEDIA_TYPE.test(type)) {
    drop();
    return fail(502, 'tipo_no_permitido', 'Solo se sirven fotos o vídeos.');
  }

  const out = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  for (const h of PASS_HEADERS) {
    const val = res.headers.get(h);
    if (val) out.set(h, val);
  }
  out.set('Content-Type', type);
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
}

/* ------------------------------------------------------------------ entrada ------------------------------------------------------------------ */

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ''; }
}

export default {
  async fetch(request, env = {}) {
    try {
      const url = new URL(request.url);
      const host = url.hostname.toLowerCase();

      if (host === hostOf(setting(env, 'MEDIA'))) {
        return await handleMedia(request, url);
      }

      const path = url.pathname.replace(/\/+$/, '') || '/';
      const tok = path.match(/^\/token\/([^/]+)\/([^/]+)$/);
      if (tok) return await handleToken(request, env, tok[1], tok[2]);

      // Avisos de Meta (Instagram/Threads/Facebook) cuando alguien quita la app o pide borrar sus datos.
      // El servidor no guarda nada de nadie, así que solo confirmamos y señalamos la página de borrado.
      if (path === '/meta/deauthorize' || path === '/meta/delete') {
        if (request.method !== 'POST') return fail(405, 'metodo_no_permitido', 'Solo se admite POST.', { Allow: 'POST' });
        if (path === '/meta/deauthorize') return json({ ok: true });
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        const code = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
        const site = setting(env, 'SITE').replace(/\/+$/, '');
        return json({ url: `${site}/borrar-datos.html`, confirmation_code: code });
      }

      const isRead = request.method === 'GET' || request.method === 'HEAD';
      if (path === '/config' || path === '/health') {
        if (!isRead) return fail(405, 'metodo_no_permitido', 'Solo se admite GET.', { Allow: 'GET, HEAD' });
        const families = configuredFamilies(env);
        if (path === '/health') return json({ ok: true, networks: families }, 200, { 'Access-Control-Allow-Origin': '*' });
        const networks = {};
        for (const f of families) networks[f] = FAMILIES[f].public(env);
        return json(
          { version: 1, relay: setting(env, 'RELAY'), media: setting(env, 'MEDIA'), networks },
          200,
          { 'Access-Control-Allow-Origin': '*' },
        );
      }
      if (path === '/' && isRead) {
        return new Response(null, { status: 302, headers: { Location: setting(env, 'SITE'), 'Cache-Control': 'no-store' } });
      }
      return fail(404, 'no_encontrado', 'Dirección no encontrada.');
    } catch {
      // Sin registrar nada: el error podría contener datos de la petición.
      return fail(500, 'error_interno', 'Ha habido un error en el servidor central de WillyPost. Inténtalo de nuevo.');
    }
  },
};
