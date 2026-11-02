// Threads (graph.threads.com). family 'threads', redirect 'relay'.
//
// Documentación consultada (nov-2026):
//  - Tokens y permisos (authorize en threads.com, POST graph.threads.com/oauth/access_token):
//      https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
//  - Tokens largos (th_exchange_token, th_refresh_token): https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
//  - Publicar (TEXT/IMAGE/VIDEO/CAROUSEL, threads_publish, ~30 s de espera): https://developers.facebook.com/docs/threads/posts
//  - Estado del contenedor (status, error_message): https://developers.facebook.com/docs/threads/troubleshooting
//  - Perfil (/me?fields=id,username,name,threads_profile_picture_url): https://developers.facebook.com/docs/threads/threads-profiles
//  - Objeto media (campo permalink): https://developers.facebook.com/docs/threads/threads-media
// Nota: la doc actual usa el dominio threads.com / graph.threads.com (antes threads.net / graph.threads.net).
import { ProviderError, fetchJson, waitFor, ambiguousPublish, oauthExchangeError } from './_http.js';
import { fitImage, checkVideoSize, durationErrors, MAX_IMAGE_BYTES } from './_media.js';
import { centralFetchJson } from '../central.js';

const API_VERSION = 'v1.0';
const API = `https://graph.threads.com/${API_VERSION}`;
const API_ROOT = 'https://graph.threads.com'; // oauth/access_token, access_token y refresh_access_token van sin versión
const LABEL = 'Threads';
const SCOPES = ['threads_basic', 'threads_content_publish'];
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613]);
const DAY = 24 * 3600 * 1000;
const TOKEN_LIFETIME_MS = 60 * DAY;
const THREADS_IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);
const TEXT_MAX = 500;
const VIDEO_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB (doc de Threads)
const CONTAINER_ERRORS = {
  FAILED_DOWNLOADING_VIDEO: 'Threads no pudo descargar el vídeo (revisa tu conexión: el enlace temporal debe estar activo).',
  FAILED_PROCESSING_AUDIO: 'Threads no pudo procesar el audio del vídeo (usa AAC, mono o estéreo).',
  FAILED_PROCESSING_VIDEO: 'Threads no pudo procesar el vídeo (usa MP4/MOV con H.264 o HEVC).',
  INVALID_ASPEC_RATIO: 'La proporción del vídeo no es válida para Threads (usa 9:16 o similar).',
  INVALID_BIT_RATE: 'La tasa de bits del vídeo no es válida para Threads.',
  INVALID_DURATION: 'La duración del vídeo no es válida para Threads (máximo 5 minutos).',
  INVALID_FRAME_RATE: 'Los fotogramas por segundo del vídeo no son válidos para Threads (23-60 fps).',
  INVALID_AUDIO_CHANNELS: 'Los canales de audio del vídeo no son válidos para Threads (mono o estéreo).',
  INVALID_AUDIO_CHANNEL_LAYOUT: 'El audio del vídeo no es válido para Threads (mono o estéreo).',
};

/**
 * Longitud de un texto para Threads. La doc dice que los emojis cuentan como sus bytes UTF-8
 * (un emoji suele valer 4, no 1); el resto de caracteres cuentan 1.
 */
export function threadsLength(text) {
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let n = 0;
  for (const { segment } of seg.segment(String(text ?? ''))) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) n += Buffer.byteLength(segment, 'utf8');
    else n += [...segment].length;
  }
  return n;
}

/* ------------------------------ errores ------------------------------ */

function classify(e) {
  if (!(e instanceof ProviderError)) return e;
  const body = e.raw && typeof e.raw === 'object' ? e.raw : null;
  if (!body) return e;
  if (!body.error && body.error_message) {
    return new ProviderError(`Threads ha rechazado la petición: ${body.error_message}`, {
      retryable: (e.status ?? 0) >= 500, status: e.status, raw: body,
    });
  }
  const err = body.error && typeof body.error === 'object' ? body.error : null;
  if (!err) return e;
  const code = Number(err.code || 0);
  const msg = err.error_user_msg || err.message || e.message;
  const auth = code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300);
  const retryable = RETRYABLE_CODES.has(code) || err.is_transient === true || (e.status ?? 0) >= 500 || e.status === 429;
  const rateLimited = [4, 17, 32, 613].includes(code) || e.status === 429;
  let text;
  if (code === 190 || code === 102) text = 'Tu token de Threads ha caducado: reconecta la cuenta en Redes.';
  else if (auth) text = `Threads dice que falta un permiso (${msg}). Reconecta la cuenta en Redes y acepta todos los permisos.`;
  else if ([4, 17, 32, 613].includes(code)) text = 'Threads ha limitado temporalmente las peticiones. Lo reintentaremos más tarde.';
  else text = `Threads ha rechazado la petición: ${msg}`;
  const out = new ProviderError(text, { auth, retryable, status: e.status, raw: body, rateLimited });
  out.code = code;
  return out;
}

async function call(url, opts = {}) {
  try {
    return await fetchJson(url, { label: LABEL, ...opts });
  } catch (e) {
    throw classify(e);
  }
}

/** Canje de tokens a través del servidor central de WillyPost (modo sin carné): el secreto lo pone el broker. */
async function centralCall(op, body) {
  try {
    return await centralFetchJson('threads', op, body, { label: LABEL });
  } catch (e) {
    throw e.central ? e : classify(e);
  }
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
const get = (path, token, params = {}) => call(`${API}/${path}?${qs({ ...params, access_token: token })}`, { method: 'GET' });
const post = (path, token, fields = {}) => {
  const form = { access_token: token };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form[k] = String(v);
  return call(`${API}/${path}`, { method: 'POST', form });
};

/* ------------------------------ contenedores ------------------------------ */

async function mediaUrl(item, ctx) {
  if (item.kind === 'image') {
    let it = item;
    if (!THREADS_IMAGE_MIMES.has(item.mime)) {
      const j = await ctx.toJpeg(item);
      it = { ...item, path: j.path, mime: j.mime };
    }
    return ctx.publicUrl(await fitImage(it, { maxBytes: MAX_IMAGE_BYTES.threads, label: 'Threads', log: ctx?.log }));
  }
  await checkVideoSize(item, { maxBytes: VIDEO_MAX_BYTES, label: 'Threads' });
  return ctx.publicUrl(item);
}

async function waitContainer(id, token, ctx, label) {
  return waitFor(async () => {
    const r = await get(id, token, { fields: 'status,error_message' });
    if (r.status === 'FINISHED' || r.status === 'PUBLISHED') return r;
    if (r.status === 'ERROR') {
      const known = CONTAINER_ERRORS[r.error_message];
      throw new ProviderError(`Threads no ha podido procesar ${label}: ${known || r.error_message || 'error desconocido'}`.replace(/\.?$/, '.'), { raw: r });
    }
    if (r.status === 'EXPIRED') throw new ProviderError('El archivo caducó antes de publicarse. Inténtalo de nuevo.', { retryable: true, raw: r });
    return false;
  }, { interval: ctx?.pollMs ?? 5000, timeout: 300000, label: `a que Threads procese ${label}` });
}

/**
 * Los textos casi siempre están listos al instante, pero la doc recomienda esperar un poco antes de publicar.
 * Comprobación tolerante: si el estado no se puede leer o no trae `status`, seguimos adelante.
 */
async function settleTextContainer(id, token, ctx) {
  for (let i = 0; i < 12; i++) {
    let r;
    try {
      r = await get(id, token, { fields: 'status,error_message' });
    } catch (e) {
      if (e instanceof ProviderError && e.auth) throw e;
      return; // sin estado legible: publicamos igualmente
    }
    if (!r?.status || r.status === 'FINISHED' || r.status === 'PUBLISHED') return;
    if (r.status === 'ERROR') {
      throw new ProviderError(`Threads no ha podido procesar el texto: ${CONTAINER_ERRORS[r.error_message] || r.error_message || 'error desconocido'}.`, { raw: r });
    }
    await (ctx?.sleep ? ctx.sleep(ctx?.pollMs ?? 2000) : new Promise((res) => setTimeout(res, ctx?.pollMs ?? 2000)));
  }
}

async function createAndWait(userId, token, fields, ctx, label) {
  const c = await post(`${userId}/threads`, token, fields);
  await waitContainer(c.id, token, ctx, label);
  return c.id;
}

/* ------------------------------ proveedor ------------------------------ */

export default {
  id: 'threads',
  label: 'Threads',
  color: '#101010',
  family: 'threads',
  authType: 'oauth',
  redirect: 'relay',
  supports: { post: true, carousel: true, reel: true, story: false, textOnly: true },
  limits: { captionMax: 500, carouselMax: 20, videoMaxSec: 300 },
  needsApproval: null,
  notes:
    'Texto de hasta 500 caracteres. Necesitas haberte añadido como probador de Threads en tu app de Meta. Las stories no existen en Threads.',
  centralNotes: 'Texto de hasta 500 caracteres. Las stories no existen en Threads.',

  getAuthUrl({ creds, redirectUri, state }) {
    const p = new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      scope: SCOPES.join(','),
      response_type: 'code',
      state,
    });
    return `https://threads.com/oauth/authorize?${p}`;
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const cleanCode = String(code).replace(/#_$/, '');
    // 1) code → token corto (1 h)
    const short = await (creds.central
      ? centralCall('code', { code: cleanCode, redirect_uri: redirectUri })
      : call(`${API_ROOT}/oauth/access_token`, {
        method: 'POST',
        form: {
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          code: cleanCode,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        },
      })
    ).catch((e) => { throw oauthExchangeError('Threads', e, { appName: 'tu app de Threads (no uses los de Facebook)', central: creds.central }); });
    if (!short?.access_token) throw new ProviderError('Threads no ha devuelto un token. Vuelve a conectar la cuenta.', { raw: short });
    // 2) corto → largo (60 días)
    const long = await (creds.central
      ? centralCall('long_lived', { access_token: short.access_token })
      : call(`${API_ROOT}/access_token?${qs({
        grant_type: 'th_exchange_token', client_secret: creds.client_secret, access_token: short.access_token,
      })}`, { method: 'GET' }));
    const token = long.access_token;
    const expiresAt = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
    // 3) perfil
    const me = await get('me', token, { fields: 'id,username,name,threads_profile_picture_url' });
    return [{
      external_id: String(me.id || short.user_id),
      name: me.name || me.username,
      username: me.username || null,
      avatar_url: me.threads_profile_picture_url || null,
      access_token: token,
      refresh_token: null,
      token_expires_at: expiresAt,
      meta: { username: me.username || null },
    }];
  },

  /** Renueva el token largo (válido si tiene >24 h y no ha caducado). Devuelve null si aún no toca. */
  async refresh({ account }) {
    const exp = account.token_expires_at ? Date.parse(account.token_expires_at) : null;
    if (exp) {
      if (exp <= Date.now()) throw new ProviderError('Tu token de Threads ha caducado: reconecta la cuenta en Redes.', { auth: true });
      if (Date.now() - (exp - TOKEN_LIFETIME_MS) < DAY) return null;
    }
    const r = await call(`${API_ROOT}/refresh_access_token?${qs({
      grant_type: 'th_refresh_token', access_token: account.access_token,
    })}`, { method: 'GET' });
    return {
      access_token: r.access_token,
      token_expires_at: r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() : new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
    };
  },

  validate({ type, caption, media = [] }) {
    const errs = [];
    const videos = media.filter((m) => m.kind === 'video');
    if (caption && threadsLength(caption) > TEXT_MAX) errs.push(`Threads admite como máximo ${TEXT_MAX} caracteres (los emojis cuentan como varios). Tu texto cuenta ${threadsLength(caption)}.`);
    if (type === 'post') {
      if (media.length === 0 && !caption) errs.push('Escribe un texto o añade una imagen para publicar en Threads.');
      if (media.length > 1 && videos.length) errs.push('Para varias imágenes en Threads usa un carrusel.');
    } else if (type === 'carousel') {
      if (media.length < 2 || media.length > 20) errs.push('Un carrusel de Threads necesita entre 2 y 20 imágenes o vídeos.');
    } else if (type === 'reel') {
      if (videos.length !== 1 || media.length !== 1) errs.push('Para vídeo en Threads necesitas exactamente 1 vídeo.');
    }
    videos.forEach((v) => errs.push(...durationErrors(v, { max: 300, label: 'Threads' })));
    // type 'story': Threads no lo soporta; no es error, el core lo marca como manual.
    return errs;
  },

  async publish({ account, type, caption, media = [], options = {}, ctx = {} }) {
    const userId = account.external_id;
    const token = account.access_token;
    if (!token) throw new ProviderError('Tu token de Threads ha caducado: reconecta la cuenta en Redes.', { auth: true });
    if (type === 'story') throw new ProviderError('Threads no tiene stories: publica esta story a mano en otra red.');
    const needsUrl = media.length > 0;
    if (needsUrl && !ctx.publicUrl) throw new ProviderError('Threads necesita un enlace público temporal y no está disponible. Reinicia WillyPost.', { retryable: true });

    let creationId;
    if (type === 'carousel' || media.length > 1) {
      const children = [];
      for (const [i, item] of media.entries()) {
        const url = await mediaUrl(item, ctx);
        const fields = item.kind === 'video'
          ? { media_type: 'VIDEO', video_url: url, is_carousel_item: 'true' }
          : { media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' };
        children.push(await createAndWait(userId, token, fields, ctx, `el elemento ${i + 1} del carrusel`));
        ctx.log?.(`Threads: elemento ${i + 1}/${media.length} listo`);
      }
      creationId = await createAndWait(userId, token, {
        media_type: 'CAROUSEL', children: children.join(','), text: caption || undefined,
      }, ctx, 'el carrusel');
    } else if (media.length === 1) {
      const item = media[0];
      const url = await mediaUrl(item, ctx);
      const fields = item.kind === 'video'
        ? { media_type: 'VIDEO', video_url: url, text: caption || undefined }
        : { media_type: 'IMAGE', image_url: url, text: caption || undefined };
      creationId = await createAndWait(userId, token, fields, ctx, item.kind === 'video' ? 'el vídeo' : 'la imagen');
    } else {
      const c = await post(`${userId}/threads`, token, {
        media_type: 'TEXT', text: caption || '', link_attachment: options.link,
      });
      creationId = c.id;
      await settleTextContainer(creationId, token, ctx);
    }

    const pub = await post(`${userId}/threads_publish`, token, { creation_id: creationId })
      .catch((e) => { throw ambiguousPublish(e, 'Threads'); });
    let url = account.meta?.username ? `https://www.threads.com/@${account.meta.username}` : 'https://www.threads.com/';
    try {
      const r = await get(pub.id, token, { fields: 'permalink' });
      if (r.permalink) url = r.permalink;
    } catch { /* el permalink es opcional */ }
    return { external_id: pub.id, url };
  },
};
