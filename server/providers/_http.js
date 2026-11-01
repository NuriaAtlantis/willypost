// Helpers compartidos por todos los proveedores.
import fs from 'node:fs';

export class ProviderError extends Error {
  /**
   * @param {string} message  Mensaje en español, se muestra al alumno.
   * @param {{auth?: boolean, retryable?: boolean, status?: number, raw?: any, rateLimited?: boolean}} [opts]
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'ProviderError';
    this.auth = !!opts.auth;
    this.retryable = !!opts.retryable;
    this.status = opts.status;
    this.raw = opts.raw;
    // true = la red ha rechazado la petición ANTES de procesarla (límite de ritmo): reintentar es seguro.
    this.rateLimited = !!opts.rateLimited;
  }
}

function pickMessage(body) {
  if (!body) return null;
  if (typeof body === 'string') return body.slice(0, 300);
  return (
    body.error?.error_user_msg ||
    body.error?.message ||
    body.error_description ||
    body.message ||
    (typeof body.error === 'string' ? body.error : null) ||
    JSON.stringify(body).slice(0, 300)
  );
}

/**
 * fetch + JSON con errores legibles. Lanza ProviderError si !ok.
 * @param {string} url
 * @param {RequestInit & {json?: any, form?: Record<string,string>, label?: string}} [opts]
 */
export async function fetchJson(url, opts = {}) {
  const { json, form, label = 'la red social', headers = {}, ...rest } = opts;
  const init = { ...rest, headers: { ...headers } };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['Content-Type'] = 'application/json';
    init.method ||= 'POST';
  } else if (form !== undefined) {
    init.body = new URLSearchParams(form).toString();
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.method ||= 'POST';
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ProviderError(`No se pudo contactar con ${label}. ¿Tienes conexión a internet?`, { retryable: true, raw: String(e) });
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!res.ok) {
    const s = res.status;
    const msg = pickMessage(body) || `HTTP ${s}`;
    // Solo se marca "reconectar" lo que lo es de verdad: un 401, o un 400/403 que habla del token/OAuth.
    const tokenish = /(invalid|expired|revoked|malformed|missing)[^.]{0,30}(token|credential|grant)|(token|credential|grant)[^.]{0,30}(invalid|expired|revoked)|oauth/i.test(String(msg));
    const auth = s === 401 || ((s === 400 || s === 403) && tokenish);
    let text2;
    if (s === 401) text2 = `${label} ha rechazado tu conexión. Reconecta la cuenta en Redes.`;
    else if (s === 429) text2 = `${label} te pide ir más despacio (demasiadas peticiones). Lo reintentaremos en unos minutos.`;
    else if (s >= 500) text2 = `${label} está teniendo problemas ahora mismo (error ${s}). Lo reintentaremos en unos minutos.`;
    else text2 = `${label}: ${msg}`;
    throw new ProviderError(text2, { auth, retryable: s >= 500 || s === 429, status: s, raw: body, rateLimited: s === 429 });
  }
  return body;
}

/**
 * Último paso de una publicación (el que crea el post de verdad). Si falla de forma "dudosa"
 * (se cortó la conexión o la red dio un 5xx) no sabemos si el post se ha creado: reintentar
 * automáticamente podría duplicarlo. Se convierte en un error NO reintentable con instrucciones.
 */
export function ambiguousPublish(e, label) {
  if (!(e instanceof ProviderError) || !e.retryable || e.auth || e.manual || e.rateLimited || e.status === 429) return e;
  const out = new ProviderError(
    `${label} ha dado un fallo justo al publicar y no podemos saber si tu publicación ha salido. Mira tu perfil en ${label}: si NO aparece, pulsa Reintentar; si ya está, marca el envío como publicado para no duplicarla.`,
    { status: e.status, raw: e.raw },
  );
  out.cause = e;
  return out;
}

/** Error al canjear el código OAuth: explica qué revisar (casi siempre el ID/secreto o la URI de redirección). */
export function oauthExchangeError(label, e, { appName = `la app de ${label}`, extra = '' } = {}) {
  if (!(e instanceof ProviderError)) return e;
  if (e.retryable && !e.status) return e; // sin internet: el mensaje ya vale
  const raw = e.raw && typeof e.raw === 'object' ? e.raw : {};
  const detail = raw.error?.message || raw.error_message || raw.error_description || (typeof raw.error === 'string' ? raw.error : '') || '';
  const out = new ProviderError(
    `${label} no ha aceptado la conexión${detail ? ` (${String(detail).slice(0, 160)})` : ''}. Revisa que el ID y el secreto de ${appName} estén bien copiados en tu carné, ` +
      `que la dirección de redirección sea exactamente la que te indica el asistente${extra}, y vuelve a pulsar Conectar.`,
    { auth: true, status: e.status, raw: e.raw },
  );
  out.cause = e;
  return out;
}

/** Lee un archivo local como Buffer. */
export function readFileBuffer(p) {
  return fs.promises.readFile(p);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que check() devuelva un valor truthy (polling). */
export async function waitFor(check, { interval = 3000, timeout = 300000, label = 'el procesado' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await check();
    if (v) return v;
    await sleep(interval);
  }
  throw new ProviderError(`Se agotó el tiempo esperando ${label}. Inténtalo de nuevo.`, { retryable: true });
}

export function addSeconds(sec) {
  return sec ? new Date(Date.now() + Number(sec) * 1000).toISOString() : null;
}
