// Proveedor TikTok (Content Posting API + Login Kit for Desktop) — familia 'tiktok'.
//
// Documentación consultada (nov 2026):
//  - Login Kit for Desktop (PKCE, redirect):  https://developers.tiktok.com/doc/login-kit-desktop
//  - Tokens (access/refresh):                  https://developers.tiktok.com/doc/oauth-user-access-token-management
//  - User info:                                https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
//  - Direct Post (video/init):                 https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
//  - Subir a la bandeja (inbox/video/init):    https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content
//  - Query creator info:                       https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
//  - Estado de la publicación:                 https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
//  - Reglas de trozos (FILE_UPLOAD):           https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
//  - Primeros pasos / auditoría:               https://developers.tiktok.com/doc/content-posting-api-get-started
//  - Crear app, sandbox:                       https://developers.tiktok.com/doc/getting-started-create-an-app , https://developers.tiktok.com/doc/add-a-sandbox
//
// PKCE: TikTok exige code_challenge = SHA256(code_verifier) CODIFICADO EN HEXADECIMAL (no base64url).
// El core genera el challenge estándar (base64url de SHA256) y nos lo pasa en getAuthUrl. Como el
// base64url ES el digest SHA256, lo reconvertimos aquí a hex: no hace falta nada especial del core.
// (Si el core ya respeta `pkceMethod: 'tiktok-hex'` y pasa el hex, también lo aceptamos tal cual.)
//
// NO VERIFICADO: si la subida a la bandeja (video.upload) funciona sin auditoría — la doc no lo dice
// explícitamente; blogs de terceros afirman que sí. Si el redirect exige barra final (la doc usa
// ejemplos como http://localhost:3455/callback/) — registrar exactamente LOCAL_REDIRECT.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ProviderError, fetchJson, waitFor, addSeconds, oauthExchangeError, ambiguousPublish } from './_http.js';
import { durationErrors, knownDuration } from './_media.js';
import { TIKTOK_PRIVACY_LABEL, isTikTokPhoto } from '../compliance.js';
import { centralToken } from '../central.js';
import { httpError } from './_http.js';

/**
 * Canje/renovación de tokens a través del servidor central de WillyPost (modo sin carné): el broker pone
 * client_key y client_secret. Aplica las mismas comprobaciones que call() a la respuesta de TikTok.
 */
async function centralCall(op, body) {
  const { status, json } = await centralToken('tiktok', op, body);
  const b = json && typeof json === 'object' ? json : {};
  if (status < 200 || status >= 300) {
    const code = b.error?.code || (typeof b.error === 'string' ? b.error : undefined);
    if (code) throw mapError({ code, message: b.error?.message || b.error_description, status, raw: b });
    throw httpError(status, json, 'TikTok');
  }
  if (typeof b.error === 'string' && b.error) {
    const invalid = /invalid_grant|invalid_request|expired|revoked/i.test(b.error + (b.error_description || ''));
    throw new ProviderError(
      invalid
        ? 'TikTok ha rechazado la conexión (código caducado o ya usado). Vuelve a conectar tu cuenta.'
        : `TikTok: ${b.error_description || b.error}`,
      { auth: invalid, raw: b },
    );
  }
  if (b.error?.code && b.error.code !== 'ok') throw mapError({ code: b.error.code, message: b.error.message, status: 200, raw: b });
  return b;
}

const API = 'https://open.tiktokapis.com';
const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const MB = 1024 * 1024;
export const DEFAULT_SCOPES = ['user.info.basic', 'video.upload', 'video.publish'];

// Ajustable en tests.
export const _tuning = {
  singleMax: 64 * MB, // hasta 64 MB: un solo trozo
  chunk: 32 * MB, // tamaño de trozo para ficheros mayores (5-64 MB)
  maxChunkRetries: 3,
  pollTimeoutMs: 10 * 60 * 1000,
};

/** base64url (43 car.) → hex (64 car.). Si ya es hex de 64 caracteres, se devuelve tal cual. */
export function toHexChallenge(challenge) {
  if (/^[0-9a-f]{64}$/i.test(challenge)) return challenge.toLowerCase();
  return Buffer.from(challenge, 'base64url').toString('hex');
}

/** Para quien quiera calcularlo desde el verifier directamente. */
export function hexChallengeFromVerifier(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('hex');
}

const ERR = {
  access_token_invalid: ['Tu conexión con TikTok ha caducado. Reconecta tu cuenta en Redes.', { auth: true }],
  scope_not_authorized: ['Falta un permiso de TikTok. Reconecta tu cuenta y acepta todos los permisos (subir y publicar vídeos).', { auth: true }],
  spam_risk_too_many_posts: ['Has llegado al límite diario de publicaciones de TikTok. Inténtalo mañana.', {}],
  spam_risk_user_banned_from_posting: ['TikTok no te deja publicar ahora mismo (cuenta restringida).', {}],
  reached_active_user_cap: ['Tu app de TikTok ha llegado al límite diario de usuarios que publican. Inténtalo mañana.', {}],
  unaudited_client_can_only_post_to_private_accounts: [
    'Tu app de TikTok aún no está auditada: solo puede publicar si tu cuenta de TikTok es privada. Usa el modo "bandeja" o pon tu cuenta en privado.',
    {},
  ],
  url_ownership_unverified: ['TikTok no puede leer el vídeo desde esa dirección (dominio sin verificar).', {}],
  privacy_level_option_mismatch: ['La privacidad elegida no está permitida para tu cuenta de TikTok.', {}],
  rate_limit_exceeded: ['TikTok te pide ir más despacio. Se reintentará en unos minutos.', { retryable: true }],
  invalid_param: [null, {}], // se usa el mensaje de TikTok
};

const FAIL_REASONS = {
  file_format_check_failed: 'TikTok no acepta el formato del vídeo (usa MP4/MOV/WebM con H.264).',
  duration_check_failed: 'La duración del vídeo no es válida para TikTok.',
  frame_rate_check_failed: 'La tasa de fotogramas del vídeo no es válida para TikTok (23-60 fps).',
  picture_size_check_failed: 'La resolución del vídeo no es válida para TikTok (360-4096 px).',
  internal: 'TikTok ha tenido un error interno. Se reintentará.',
  publish_cancelled: 'La publicación se canceló en TikTok.',
  auth_removed: 'Has quitado el acceso de la app en TikTok. Reconecta tu cuenta.',
  spam_risk_too_many_posts: 'Has llegado al límite diario de publicaciones de TikTok.',
  spam_risk_user_banned_from_posting: 'TikTok no te deja publicar ahora mismo (cuenta restringida).',
  spam_risk_text: 'TikTok ha rechazado el texto por considerarlo spam.',
  spam_risk: 'TikTok ha rechazado la publicación por riesgo de spam.',
};

function mapError({ code, message, status, raw }) {
  const known = ERR[code];
  if (known) {
    return new ProviderError(known[0] || `TikTok: ${message || code}`, {
      status,
      raw,
      retryable: !!known[1].retryable || (status >= 500),
      auth: !!known[1].auth,
    });
  }
  return new ProviderError(`TikTok: ${message || code || 'error desconocido'}`, {
    status,
    raw,
    retryable: status >= 500 || status === 429,
    auth: status === 401,
  });
}

/** Llamada a la API de TikTok (JSON). Revisa error.code incluso con HTTP 200. */
async function call(url, { token, method = 'POST', json, form } = {}) {
  const opts = { label: 'TikTok', method };
  if (token) opts.headers = { Authorization: `Bearer ${token}` };
  if (json !== undefined) opts.json = json;
  if (form !== undefined) opts.form = form;
  let body;
  try {
    body = await fetchJson(url, opts);
  } catch (e) {
    if (e instanceof ProviderError && e.raw && typeof e.raw === 'object') {
      const code = e.raw.error?.code || (typeof e.raw.error === 'string' ? e.raw.error : undefined);
      if (code) throw mapError({ code, message: e.raw.error?.message || e.raw.error_description, status: e.status, raw: e.raw });
    }
    throw e;
  }
  // El endpoint de token devuelve {error:'invalid_grant', error_description} a veces con HTTP 200.
  if (body && typeof body.error === 'string' && body.error) {
    const invalid = /invalid_grant|invalid_request|expired|revoked/i.test(body.error + (body.error_description || ''));
    throw new ProviderError(
      invalid
        ? 'TikTok ha rechazado la conexión (código caducado o ya usado). Vuelve a conectar tu cuenta.'
        : `TikTok: ${body.error_description || body.error}`,
      { auth: invalid, raw: body },
    );
  }
  if (body?.error?.code && body.error.code !== 'ok') {
    throw mapError({ code: body.error.code, message: body.error.message, status: 200, raw: body });
  }
  return body;
}

/**
 * Estado de la publicación. Los IDs de vídeo de TikTok son int64 (19 dígitos) y JSON.parse los
 * redondea, así que se convierten a cadena en el texto crudo ANTES de parsear.
 */
async function fetchStatus(token, publishId) {
  let res;
  try {
    res = await fetch(`${API}/v2/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ publish_id: publishId }),
    });
  } catch (e) {
    throw new ProviderError('No se pudo contactar con TikTok. ¿Tienes conexión a internet?', { retryable: true, raw: String(e) });
  }
  const text = await res.text();
  const safe = text.replace(/("publicaly_available_post_id"\s*:\s*\[)([^\]]*)\]/, (_m, a, nums) =>
    `${a}${nums.replace(/-?\d+/g, (n) => `"${n}"`)}]`,
  );
  let body;
  try { body = safe ? JSON.parse(safe) : {}; } catch { body = {}; }
  if (!res.ok || (body?.error?.code && body.error.code !== 'ok')) {
    throw mapError({ code: body?.error?.code, message: body?.error?.message || `HTTP ${res.status}`, status: res.status, raw: body });
  }
  return body;
}

function decodeCode(code) {
  // TikTok indica que el code debe ir URL-decodificado. Express ya lo decodifica; por si acaso:
  if (/%[0-9A-Fa-f]{2}/.test(code)) {
    try { return decodeURIComponent(code); } catch { /* ignorar */ }
  }
  return code;
}

function videoMime(item) {
  const m = (item.mime || '').toLowerCase();
  if (m === 'video/quicktime' || m === 'video/webm' || m === 'video/mp4') return m;
  const n = (item.original_name || item.path || '').toLowerCase();
  if (n.endsWith('.mov')) return 'video/quicktime';
  if (n.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/** Plan de trozos según las reglas de TikTok (el último absorbe el resto, hasta 128 MB). */
export function planChunks(size) {
  if (size <= _tuning.singleMax) return { chunkSize: size, count: 1, ranges: [[0, size - 1]] };
  let chunkSize = _tuning.chunk;
  let count = Math.floor(size / chunkSize);
  if (count > 1000) {
    chunkSize = Math.ceil(size / 1000 / MB) * MB;
    count = Math.floor(size / chunkSize);
  }
  const ranges = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
    ranges.push([start, end]);
  }
  return { chunkSize, count, ranges };
}

async function putChunks({ uploadUrl, filePath, mime, size, plan, log }) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    for (const [start, end] of plan.ranges) {
      const len = end - start + 1;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      for (let attempt = 0; ; attempt++) {
        try {
          log?.(`TikTok: subiendo bytes ${start}-${end}/${size}`);
          await fetchJson(uploadUrl, {
            method: 'PUT',
            label: 'TikTok',
            headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${size}` },
            body: buf,
          });
          break;
        } catch (e) {
          if (e instanceof ProviderError && e.status === 403) {
            throw new ProviderError('La subida a TikTok ha caducado (más de 1 hora). Inténtalo de nuevo.', { retryable: true, status: 403 });
          }
          if (e instanceof ProviderError && e.retryable && attempt < _tuning.maxChunkRetries) continue;
          throw e;
        }
      }
    }
  } finally {
    await fh.close();
  }
}

/* ------------------------------------------------------------------ */
/* Publicar según las Content Sharing Guidelines de TikTok             */
/* https://developers.tiktok.com/doc/content-sharing-guidelines        */
/* ------------------------------------------------------------------ */

/** Códigos de creator_info que significan «este creador no puede publicar ahora mismo». */
export const CANNOT_POST_CODES = ['spam_risk_too_many_posts', 'spam_risk_user_banned_from_posting', 'reached_active_user_cap'];

/** creator_info/query → subconjunto seguro (sin tokens). Lanza ProviderError con el código de TikTok en raw. */
export async function queryCreatorInfo(token) {
  const ci = await call(`${API}/v2/post/publish/creator_info/query/`, { token, json: {} });
  const c = ci?.data || {};
  const max = Number(c.max_video_post_duration_sec);
  return {
    nickname: c.creator_nickname ? String(c.creator_nickname) : null,
    username: c.creator_username ? String(c.creator_username) : null,
    avatar_url: typeof c.creator_avatar_url === 'string' && /^https:\/\//.test(c.creator_avatar_url) ? c.creator_avatar_url : null,
    privacy_level_options: Array.isArray(c.privacy_level_options) ? c.privacy_level_options.filter((x) => typeof x === 'string') : [],
    comment_disabled: !!c.comment_disabled,
    duet_disabled: !!c.duet_disabled,
    stitch_disabled: !!c.stitch_disabled,
    max_video_post_duration_sec: Number.isFinite(max) && max > 0 ? max : null,
  };
}

/** Código de error de TikTok dentro de un ProviderError (o null). */
export const tiktokErrorCode = (e) => (e instanceof ProviderError && e.raw?.error?.code) || null;

/** ¿Lo activó la persona? (sin elección = desactivado, como exige TikTok). Admite los nombres antiguos disable_*. */
function allowed(options, key, legacyKey) {
  if (options[key] !== undefined) return !!options[key];
  if (options[legacyKey] !== undefined) return !options[legacyKey];
  return false;
}

/**
 * post_info para Direct Post a partir de lo que eligió la persona y de lo que permite el creador AHORA.
 * Nunca cambia la elección por su cuenta: si algo ya no cuadra, lanza un error claro (no reintentable).
 */
export function buildPostInfo({ options = {}, creator, caption = '', photo = false }) {
  const privacy = options.tiktok_privacy;
  const fix = 'Abre la publicación en WillyPost, revisa las opciones de TikTok y pulsa Reintentar.';
  if (!privacy) throw new ProviderError(`No se ha elegido quién puede ver la publicación en TikTok. ${fix}`);
  if (!creator.privacy_level_options.includes(privacy)) {
    throw new ProviderError(`Tu cuenta de TikTok ya no permite la privacidad elegida («${TIKTOK_PRIVACY_LABEL[privacy] || privacy}»). No la hemos cambiado por otra: ${fix}`);
  }
  const commercial = !!options.commercial;
  const brandOrganic = commercial && !!options.brand_organic;
  const brandContent = commercial && !!options.brand_content;
  if (commercial && !brandOrganic && !brandContent) {
    throw new ProviderError(`Has activado «Divulgar contenido comercial» pero no has marcado «Tu marca» ni «Contenido de marca». ${fix}`);
  }
  if (brandContent && privacy === 'SELF_ONLY') {
    throw new ProviderError(`El contenido de marca no puede publicarse como «Solo yo». ${fix}`);
  }
  const text = String(caption || '');
  const info = { privacy_level: privacy };
  if (photo) {
    // Fotos: título (máx. 90) + descripción (máx. 4000). Sin Dúo ni Stitch.
    const title = String(options.title || '').trim() || text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
    info.title = title.slice(0, 90);
    info.description = text.slice(0, 4000);
  } else {
    info.title = text.slice(0, 2200);
  }
  info.disable_comment = !allowed(options, 'allow_comment', 'disable_comment') || creator.comment_disabled;
  if (!photo) {
    info.disable_duet = !allowed(options, 'allow_duet', 'disable_duet') || creator.duet_disabled;
    info.disable_stitch = !allowed(options, 'allow_stitch', 'disable_stitch') || creator.stitch_disabled;
  }
  info.brand_content_toggle = brandContent;
  info.brand_organic_toggle = brandOrganic;
  if (options.is_aigc && !photo) info.is_aigc = true;
  return info;
}

export default {
  id: 'tiktok',
  label: 'TikTok',
  color: '#000000',
  family: 'tiktok',
  authType: 'oauth',
  redirect: 'local', // Login Kit for Desktop: http://localhost:4747/oauth/callback
  // El core debe generar un code_verifier (43-128 car. de [A-Za-z0-9-._~]) y pasar el challenge S256.
  pkce: true,
  pkceMethod: 'tiktok-hex', // informativo: este proveedor convierte base64url→hex él mismo
  supports: { post: false, carousel: false, reel: true, story: false, textOnly: false },
  limits: { captionMax: 2200, carouselMax: 0, videoMaxSec: 600 },
  needsApproval:
    'Sin auditoría de TikTok, el vídeo llega a tu bandeja de TikTok (o se publica en privado). Para publicar en abierto TikTok tiene que auditar tu app.',
  centralNeedsApproval:
    'Mientras TikTok termina de aprobar WillyPost, el vídeo llega a tu bandeja de TikTok y desde ahí lo publicas con un toque.',
  centralNotes:
    'Al programar eliges quién puede verlo y si permites comentarios. Si TikTok aún no deja publicar directamente, el vídeo llega a tu bandeja de TikTok.',
  notes:
    'Sin auditoría de TikTok, el vídeo llega a tu bandeja de TikTok (o se publica en privado). Ábrela desde la notificación de la app de TikTok para terminar y publicar.',
  optionsSchema: [
    { key: 'tiktok_mode', label: 'Modo', type: 'select', values: ['inbox', 'direct'], default: 'inbox' },
    // Sin valor por defecto: la persona elige entre las que permite creator_info (reglas de TikTok).
    { key: 'tiktok_privacy', label: 'Quién puede verlo (solo modo directo)', type: 'select', values: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] },
    { key: 'allow_comment', label: 'Permitir comentarios', type: 'bool', default: false },
    { key: 'allow_duet', label: 'Permitir dúos (solo vídeo)', type: 'bool', default: false },
    { key: 'allow_stitch', label: 'Permitir stitch (solo vídeo)', type: 'bool', default: false },
    { key: 'commercial', label: 'Divulgar contenido comercial', type: 'bool', default: false },
    { key: 'brand_organic', label: 'Tu marca', type: 'bool', default: false },
    { key: 'brand_content', label: 'Contenido de marca', type: 'bool', default: false },
  ],

  getAuthUrl({ creds, redirectUri, state, codeChallenge }) {
    if (!codeChallenge) throw new ProviderError('Falta el código PKCE para conectar con TikTok.');
    const scopes = creds.extra?.scopes
      ? String(creds.extra.scopes).split(/[\s,]+/).filter(Boolean)
      : DEFAULT_SCOPES;
    const p = new URLSearchParams({
      client_key: creds.client_id, // TikTok lo llama client_key
      response_type: 'code',
      scope: scopes.join(','),
      redirect_uri: redirectUri,
      state,
      code_challenge: toHexChallenge(codeChallenge),
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${p.toString()}`;
  },

  async exchangeCode({ creds, redirectUri, code, codeVerifier }) {
    if (!codeVerifier) throw new ProviderError('Falta el verificador PKCE. Vuelve a empezar la conexión con TikTok.');
    const tok = await (creds.central
      // Modo sin carné: el broker añade client_key y client_secret.
      ? centralCall('code', { code: decodeCode(code), redirect_uri: redirectUri, code_verifier: codeVerifier })
      : call(`${API}/v2/oauth/token/`, {
        form: {
          client_key: creds.client_id,
          client_secret: creds.client_secret,
          code: decodeCode(code),
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        },
      })
    ).catch((e) => {
      if (e instanceof ProviderError && e.auth) throw e;
      throw oauthExchangeError('TikTok', e, { appName: 'tu app de TikTok (Client key y Client secret)', central: creds.central });
    });
    if (!tok.access_token) throw new ProviderError('TikTok no ha devuelto el permiso de acceso. Vuelve a conectar.', { auth: true });
    const scopes = String(tok.scope || '').split(',').map((s) => s.trim());
    if (!scopes.includes('video.upload')) {
      throw new ProviderError('No has dado permiso para subir vídeos. Vuelve a conectar y deja marcados todos los permisos.', { auth: true });
    }
    const fields = ['open_id', 'avatar_url', 'display_name'];
    if (scopes.includes('user.info.profile')) fields.push('username');
    const info = await call(`${API}/v2/user/info/?fields=${fields.join(',')}`, { token: tok.access_token, method: 'GET' });
    const u = info.data?.user || {};
    return [
      {
        external_id: tok.open_id || u.open_id,
        name: u.display_name || 'Mi TikTok',
        username: u.username || null,
        avatar_url: u.avatar_url || null,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        token_expires_at: addSeconds(tok.expires_in),
        meta: {
          open_id: tok.open_id || u.open_id,
          scope: tok.scope,
          username: u.username || null,
          refresh_expires_at: addSeconds(tok.refresh_expires_in),
        },
      },
    ];
  },

  /** Access 24 h, refresh 365 d. TikTok puede rotar el refresh_token: se devuelve el nuevo. */
  async refresh({ account, creds }) {
    if (!account?.refresh_token) return null;
    const tok = creds?.central
      // Cuenta conectada sin carné: se renueva con la app central (el secreto lo pone el broker).
      ? await centralCall('refresh', { refresh_token: account.refresh_token })
      : await call(`${API}/v2/oauth/token/`, {
        form: {
          client_key: creds.client_id,
          client_secret: creds.client_secret,
          grant_type: 'refresh_token',
          refresh_token: account.refresh_token,
        },
      });
    if (!tok.access_token) throw new ProviderError('TikTok no ha renovado la conexión. Reconecta tu cuenta.', { auth: true });
    const out = { access_token: tok.access_token, token_expires_at: addSeconds(tok.expires_in) };
    if (tok.refresh_token) out.refresh_token = tok.refresh_token;
    return out;
  },

  validate({ type, caption, media = [], options = {} }) {
    if (type !== 'reel') return []; // post/carrusel/story: el core usa modo manual
    const errs = [];
    if (media.length !== 1 || media[0].kind !== 'video') errs.push('TikTok necesita exactamente 1 vídeo.');
    else errs.push(...durationErrors(media[0], { min: 3, max: 600, label: 'TikTok' }));
    if ((caption || '').length > 2200) errs.push('El texto de TikTok no puede pasar de 2200 caracteres.');
    if (options.tiktok_mode && !['inbox', 'direct'].includes(options.tiktok_mode)) errs.push('El modo de TikTok debe ser "inbox" o "direct".');
    return errs;
  },

  async publish({ account, type, caption, media, options = {}, ctx = {} }) {
    if (isTikTokPhoto(type)) return publishPhotos({ account, caption, media, options, ctx });
    if (type !== 'reel') throw new ProviderError('TikTok solo admite vídeos por API.');
    const item = media?.[0];
    if (!item || media.length !== 1) throw new ProviderError('TikTok necesita exactamente 1 vídeo.');
    const log = ctx.log || (() => {});
    const token = account.access_token;
    const stat = await fs.promises.stat(item.path).catch(() => null);
    if (!stat || !stat.size) throw new ProviderError('No se encuentra el archivo de vídeo en tu ordenador.');
    const size = stat.size;
    const mime = videoMime(item);
    const plan = planChunks(size);
    const sourceInfo = { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count };

    let mode = options.tiktok_mode === 'direct' ? 'direct' : 'inbox';
    const warns = [];
    let username = account.meta?.username || null;
    let privacy = null;
    let init;

    const initInbox = () => call(`${API}/v2/post/publish/inbox/video/init/`, { token, json: { source_info: sourceInfo } });

    if (mode === 'direct') {
      // Justo antes de publicar se vuelve a consultar creator_info (puede haber cambiado desde que se programó).
      const creator = await queryCreatorInfo(token);
      ctx.onCreatorInfo?.(creator);
      username = creator.username || username;
      const dur = knownDuration(item);
      if (dur !== null && creator.max_video_post_duration_sec && dur > creator.max_video_post_duration_sec) {
        throw new ProviderError(`El vídeo dura ${Math.round(dur)} s y tu cuenta de TikTok solo permite vídeos de hasta ${creator.max_video_post_duration_sec} s. Recórtalo y vuelve a programarlo.`);
      }
      const postInfo = buildPostInfo({ options, creator, caption });
      privacy = postInfo.privacy_level;
      try {
        init = await call(`${API}/v2/post/publish/video/init/`, { token, json: { post_info: postInfo, source_info: sourceInfo } });
      } catch (e) {
        const unaudited = e instanceof ProviderError && e.raw?.error?.code === 'unaudited_client_can_only_post_to_private_accounts';
        if (unaudited && options.tiktok_fallback !== false) {
          log('TikTok: app sin auditar, cambiando a modo bandeja');
          mode = 'inbox';
          privacy = null;
          warns.push('Tu app de TikTok no está auditada, así que el vídeo se ha enviado a tu bandeja de TikTok en vez de publicarse.');
          init = await initInbox();
        } else {
          throw e;
        }
      }
    } else {
      init = await initInbox();
    }

    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) throw new ProviderError('TikTok no ha devuelto la dirección de subida. Inténtalo de nuevo.', { retryable: true });

    // Hasta aquí no existe ningún post: reintentar es seguro. Con el último trozo enviado ya no.
    await putChunks({ uploadUrl, filePath: item.path, mime, size, plan, log });

    // Esperar a que TikTok procese. Desde que se envió el último trozo TikTok puede haber creado la publicación:
    // un fallo de red o un tiempo agotado aquí NO se reintenta solo (duplicaría el vídeo).
    const done = await waitPublished({ token, publishId, mode, ctx, what: 'el vídeo' });

    const out = { external_id: String(publishId), url: null };
    const postId = done.publicaly_available_post_id?.[0];
    if (postId) {
      out.external_id = String(postId);
      if (username) out.url = `https://www.tiktok.com/@${username}/video/${postId}`;
    }
    if (!out.url && username) out.url = `https://www.tiktok.com/@${username}`;

    if (done.status === 'SEND_TO_USER_INBOX') {
      warns.push(
        'El vídeo está en tu bandeja de TikTok: abre la notificación en la app de TikTok, revisa y pulsa Publicar. El texto no viaja con el vídeo: cópialo desde WillyPost.',
      );
    } else if (privacy === 'SELF_ONLY') {
      warns.push('Publicado como «Solo yo»: de momento solo lo ves tú (puedes cambiarlo en la app de TikTok).');
    }
    if (warns.length) out.warning = warns.join(' ');
    return out;
  },
};

/** Sondea el estado hasta que TikTok publique (o lo deje en la bandeja). */
async function waitPublished({ token, publishId, mode, ctx = {}, what }) {
  return waitFor(
    async () => {
      const r = await fetchStatus(token, publishId);
      const s = r.data || {};
      if (s.status === 'FAILED') {
        const reason = s.fail_reason || 'desconocido';
        throw new ProviderError(FAIL_REASONS[reason] || `TikTok no ha podido procesar ${what} (${reason}).`, {
          retryable: reason === 'internal',
          rateLimited: reason === 'internal', // TikTok dice que NO publicó: reintentar es seguro
          auth: reason === 'auth_removed',
        });
      }
      if (s.status === 'PUBLISH_COMPLETE') return s;
      if (mode === 'inbox' && s.status === 'SEND_TO_USER_INBOX') return s;
      return null;
    },
    { interval: ctx.pollInterval ?? 3000, timeout: _tuning.pollTimeoutMs, label: `a que TikTok procese ${what}` },
  ).catch((e) => {
    if (e instanceof ProviderError && e.retryable && e.message.startsWith('Se agotó')) {
      throw new ProviderError(`TikTok tarda demasiado en procesar ${what} y no sabemos si lo ha recibido. Mira la bandeja o tus publicaciones en la app de TikTok: si no aparece, pulsa Reintentar.`, { raw: e.raw });
    }
    throw ambiguousPublish(e, 'TikTok');
  });
}

/**
 * Fotos (1-35) por PULL_FROM_URL: TikTok solo descarga de un dominio verificado por la app, así que la
 * dirección la da ctx.verifiedUrl (proxy de medios del modo central) o, si no hay, ctx.publicUrl.
 * Mismas reglas que el vídeo, pero sin Dúo ni Stitch.
 * https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
 */
async function publishPhotos({ account, caption, media = [], options = {}, ctx = {} }) {
  const images = media.filter((m) => m.kind === 'image');
  if (!images.length || images.length !== media.length) throw new ProviderError('TikTok necesita solo fotos (de 1 a 35) para una publicación de fotos.');
  if (images.length > 35) throw new ProviderError('TikTok admite como mucho 35 fotos por publicación.');
  const toUrl = ctx.verifiedUrl || ctx.publicUrl;
  if (!toUrl) throw new ProviderError('No hay forma de crear una dirección pública para las fotos de TikTok.', { retryable: true });
  const token = account.access_token;
  const mode = options.tiktok_mode === 'direct' ? 'direct' : 'inbox';
  let username = account.meta?.username || null;
  const body = { media_type: 'PHOTO', post_mode: mode === 'direct' ? 'DIRECT_POST' : 'MEDIA_UPLOAD' };
  let privacy = null;
  if (mode === 'direct') {
    const creator = await queryCreatorInfo(token);
    ctx.onCreatorInfo?.(creator);
    username = creator.username || username;
    body.post_info = buildPostInfo({ options, creator, caption, photo: true });
    privacy = body.post_info.privacy_level;
    if (options.is_aigc) body.is_aigc = true;
  } else {
    body.post_info = { title: String(caption || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)?.slice(0, 90) || '', description: String(caption || '').slice(0, 4000) };
  }
  const urls = [];
  for (const m of images) {
    // TikTok acepta JPG y WebP: el resto se convierte a JPG antes.
    const it = /image\/(jpeg|webp)/.test(m.mime || '') || !ctx.toJpeg ? m : await ctx.toJpeg(m);
    urls.push(await toUrl(it));
  }
  body.source_info = { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls };
  const init = await call(`${API}/v2/post/publish/content/init/`, { token, json: body });
  const publishId = init.data?.publish_id;
  if (!publishId) throw new ProviderError('TikTok no ha confirmado la publicación de las fotos. Revisa tu TikTok antes de reintentar.');
  const done = await waitPublished({ token, publishId, mode, ctx, what: 'las fotos' });
  const out = { external_id: String(done.publicaly_available_post_id?.[0] || publishId), url: username ? `https://www.tiktok.com/@${username}` : null };
  if (done.status === 'SEND_TO_USER_INBOX') out.warning = 'Las fotos están en tu bandeja de TikTok: abre la notificación en la app de TikTok, revisa y pulsa Publicar.';
  else if (privacy === 'SELF_ONLY') out.warning = 'Publicado como «Solo yo»: de momento solo lo ves tú (puedes cambiarlo en la app de TikTok).';
  return out;
}
