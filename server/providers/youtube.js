// Proveedor YouTube (Shorts) — familia de credenciales 'google'.
//
// Documentación consultada (nov 2026):
//  - OAuth 2.0 servidor web:  https://developers.google.com/identity/protocols/oauth2/web-server
//  - Caducidad de tokens:     https://developers.google.com/identity/protocols/oauth2#expiration
//  - videos.insert:           https://developers.google.com/youtube/v3/docs/videos/insert
//  - Subida resumible:        https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
//  - channels.list:           https://developers.google.com/youtube/v3/docs/channels/list
//  - Cuotas (100 subidas/día): https://developers.google.com/youtube/v3/determine_quota_cost
//
// Este módulo exporta además (named exports) los helpers OAuth de Google que reutiliza gbp.js.
import fs from 'node:fs';
import path from 'node:path';
import { ProviderError, fetchJson, addSeconds, sleep, ambiguousPublish } from './_http.js';
import { knownDuration } from './_media.js';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

// Ajustable en tests.
export const _tuning = {
  chunk: 16 * 1024 * 1024, // múltiplo de 256 KB (exigencia de Google)
  maxRetries: 5,
  backoffMs: 1000,
};

/* ------------------------------------------------------------------ */
/* Helpers OAuth de Google (compartidos con gbp.js)                    */
/* ------------------------------------------------------------------ */

/** URL de autorización. access_type=offline + prompt=consent para obtener refresh_token siempre. */
export function googleAuthUrl({ creds, redirectUri, state, scopes }) {
  const p = new URLSearchParams({
    client_id: creds.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

/** Traduce errores de las APIs de Google a mensajes en español. */
export function googleApiError(e, { service = 'Google' } = {}) {
  if (!(e instanceof ProviderError)) return e;
  const err = e.raw?.error;
  const reason = err?.errors?.[0]?.reason || '';
  const status = err?.status || '';
  const msg = String(err?.message || '');
  const keep = { status: e.status, raw: e.raw };
  if (e.status === 401) {
    return new ProviderError(`${service} ha rechazado tu conexión. Reconecta tu cuenta en Redes.`, { ...keep, auth: true });
  }
  if (/quotaExceeded|dailyLimitExceeded|uploadLimitExceeded|userRateLimitExceeded/i.test(reason)) {
    return new ProviderError(
      `Has llegado al límite diario de ${service}. Vuelve a intentarlo mañana (o reduce el número de subidas).`,
      { ...keep, retryable: false },
    );
  }
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + status) || /has not been used in project|is disabled/i.test(msg)) {
    return new ProviderError(
      `La API de ${service} no está activada en tu proyecto de Google Cloud. Actívala en "APIs y servicios > Biblioteca" y vuelve a intentarlo.`,
      keep,
    );
  }
  if (/youtubeSignupRequired/i.test(reason)) {
    return new ProviderError('Esa cuenta de Google no tiene un canal de YouTube. Crea el canal en youtube.com y reconecta.', keep);
  }
  if (e.status === 403) {
    return new ProviderError(`${service}: no tienes permiso para esta acción (${msg || reason || '403'}). Reconecta y acepta todos los permisos.`, {
      ...keep,
      auth: /insufficient|scope|permission/i.test(msg + reason),
    });
  }
  return e;
}

/** Pide tokens a Google. Convierte invalid_grant en un error de reconexión. */
async function googleTokenRequest(form, { reconnectMsg } = {}) {
  try {
    return await fetchJson(GOOGLE_TOKEN_URL, { form, label: 'Google' });
  } catch (e) {
    if (e instanceof ProviderError && e.raw && typeof e.raw === 'object') {
      const code = e.raw.error;
      if (code === 'invalid_grant') {
        throw new ProviderError(
          reconnectMsg ||
            'Google ha cancelado la conexión (puede pasar si tu app está en modo "Testing": caduca a los 7 días). Reconecta tu cuenta y pasa la app a "Producción".',
          { auth: true, status: e.status, raw: e.raw },
        );
      }
      if (code === 'invalid_client' || code === 'unauthorized_client') {
        throw new ProviderError('El ID de cliente o el secreto de Google no son correctos. Revisa tu carné de Google en Redes.', {
          auth: true,
          status: e.status,
          raw: e.raw,
        });
      }
      if (code === 'redirect_uri_mismatch') {
        throw new ProviderError(
          'La URI de redirección no coincide. En Google Cloud añade exactamente http://localhost:4747/oauth/callback a tu cliente OAuth.',
          { status: e.status, raw: e.raw },
        );
      }
    }
    throw e;
  }
}

/** Intercambia el code por tokens. Comprueba que se han concedido los scopes necesarios. */
export async function googleExchange({ creds, redirectUri, code, requiredScopes = [] }) {
  const tok = await googleTokenRequest({
    code,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }, { reconnectMsg: 'Google no ha aceptado el código de conexión (ya se usó o caducó). Cierra la ventana de Google y vuelve a pulsar Conectar en WillyPost.' });
  const granted = String(tok.scope || '').split(/\s+/);
  const missing = requiredScopes.filter((s) => !granted.includes(s));
  if (missing.length) {
    throw new ProviderError(
      'Google no ha concedido todos los permisos. Vuelve a conectar y deja marcadas TODAS las casillas de permisos.',
      { auth: true },
    );
  }
  if (!tok.refresh_token) {
    throw new ProviderError(
      'Google no ha devuelto un permiso duradero. Entra en myaccount.google.com/permissions, quita el acceso de tu app y vuelve a conectar.',
      { auth: true },
    );
  }
  return tok;
}

/** Refresca el access_token de Google. */
export async function googleRefresh({ account, creds }) {
  if (!account?.refresh_token) return null;
  const tok = await googleTokenRequest({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: account.refresh_token,
    grant_type: 'refresh_token',
  });
  const out = { access_token: tok.access_token, token_expires_at: addSeconds(tok.expires_in) };
  if (tok.refresh_token) out.refresh_token = tok.refresh_token; // Google casi nunca lo rota
  return out;
}

/* ------------------------------------------------------------------ */
/* Utilidades de YouTube                                               */
/* ------------------------------------------------------------------ */

const PRIVACY = ['public', 'unlisted', 'private'];

/** Título: options.title o primera línea del texto, máx. 100 caracteres, sin < >. */
export function deriveTitle(options = {}, caption = '', media = []) {
  const clean = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  let t = clean(options.title);
  if (!t) {
    const first = String(caption || '').split(/\r?\n/).map(clean).find(Boolean);
    t = first || '';
  }
  if (!t) {
    const n = media?.[0]?.original_name;
    t = n ? clean(path.parse(n).name) : 'Short';
  }
  const chars = Array.from(t);
  if (chars.length > 100) t = chars.slice(0, 99).join('').trimEnd() + '…';
  return t || 'Short';
}

function isVertical(m) {
  return !(m?.width && m?.height) || m.height >= m.width;
}

async function rawFetch(url, init, label = 'YouTube') {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new ProviderError(`No se pudo contactar con ${label}. ¿Tienes conexión a internet?`, { retryable: true, raw: String(e) });
  }
}

async function parseBody(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return text; }
}

async function errorFromResponse(res) {
  const body = await parseBody(res);
  const msg = body?.error?.message || (typeof body === 'string' ? body.slice(0, 200) : '') || `HTTP ${res.status}`;
  return googleApiError(
    new ProviderError(`YouTube: ${msg}`, {
      auth: res.status === 401,
      retryable: res.status >= 500 || res.status === 429,
      status: res.status,
      raw: body,
    }),
    { service: 'YouTube' },
  );
}

function rangeEnd(res) {
  // Cabecera "Range: bytes=0-12345" → siguiente offset (12346). Sin Range → 0.
  const r = res.headers.get('range');
  const m = r && /bytes=0-(\d+)/.exec(r);
  return m ? Number(m[1]) + 1 : 0;
}

/** Sube el fichero a la URL de sesión resumible, por trozos, con reanudación. */
async function uploadResumable({ sessionUrl, token, filePath, mime, size, sleepFn }) {
  const fh = await fs.promises.open(filePath, 'r');
  let finalAttempted = false;
  try {
    let offset = 0;
    let failures = 0;
    for (;;) {
      const end = Math.min(offset + _tuning.chunk, size);
      const len = end - offset;
      const isFinal = end >= size;
      if (isFinal) finalAttempted = true;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      let res;
      try {
        res = await rawFetch(sessionUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': mime,
            'Content-Range': `bytes ${offset}-${end - 1}/${size}`,
          },
          body: buf,
        });
      } catch (e) {
        res = null;
        if (++failures > _tuning.maxRetries) { if (isFinal && e && typeof e === 'object') e.finalSent = true; throw e; }
      }
      if (res && (res.status === 200 || res.status === 201)) return await parseBody(res);
      if (res && res.status === 308) {
        failures = 0;
        offset = rangeEnd(res);
        if (offset >= size) {
          // El servidor dice que ya tiene todo pero no ha confirmado: consultar estado.
          const st = await queryUploadStatus({ sessionUrl, token, size });
          if (st.done) return st.body;
          offset = st.offset;
        }
        continue;
      }
      if (res && res.status === 404) {
        throw new ProviderError('La subida a YouTube ha caducado. Inténtalo de nuevo.', { retryable: true, status: 404 });
      }
      if (res && res.status < 500 && res.status !== 429) throw await errorFromResponse(res);
      // 5xx / 429 / error de red: reanudar tras consultar cuánto recibió YouTube
      if (res && ++failures > _tuning.maxRetries) {
        const err = await errorFromResponse(res);
        if (isFinal) err.finalSent = true;
        throw err;
      }
      await sleepFn(_tuning.backoffMs * 2 ** Math.min(failures, 5));
      const st = await queryUploadStatus({ sessionUrl, token, size });
      if (st.done) return st.body;
      offset = st.offset;
    }
  } catch (e) {
    // Una vez intentado el último trozo YouTube puede haber creado ya el vídeo.
    if (finalAttempted && e && typeof e === 'object') e.finalSent = true;
    throw e;
  } finally {
    await fh.close();
  }
}

async function queryUploadStatus({ sessionUrl, token, size }) {
  const res = await rawFetch(sessionUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${size}` },
  });
  if (res.status === 200 || res.status === 201) return { done: true, body: await parseBody(res) };
  if (res.status === 308) return { done: false, offset: rangeEnd(res) };
  if (res.status === 404) throw new ProviderError('La subida a YouTube ha caducado. Inténtalo de nuevo.', { retryable: true, status: 404 });
  throw await errorFromResponse(res);
}

/* ------------------------------------------------------------------ */
/* Proveedor                                                           */
/* ------------------------------------------------------------------ */

export default {
  id: 'youtube',
  label: 'YouTube Shorts',
  color: '#FF0000',
  family: 'google',
  authType: 'oauth',
  redirect: 'local',
  supports: { post: false, carousel: false, reel: true, story: false, textOnly: false },
  // 3 min: YouTube clasifica como Short los vídeos verticales/cuadrados de hasta 3 min (oct 2024; fuentes de terceros).
  limits: { captionMax: 5000, carouselMax: 0, videoMaxSec: 180 },
  needsApproval: null,
  notes:
    'Sube el vídeo a tu canal. Si tu proyecto de Google no está verificado, YouTube puede dejarlo en privado. En modo "Testing" la conexión caduca a los 7 días: pasa la app a "Producción".',
  // Opciones específicas que puede mostrar el compositor.
  optionsSchema: [
    { key: 'title', label: 'Título (máx. 100)', type: 'text' },
    { key: 'privacy', label: 'Privacidad', type: 'select', values: PRIVACY, default: 'public' },
  ],

  getAuthUrl({ creds, redirectUri, state }) {
    return googleAuthUrl({ creds, redirectUri, state, scopes: YT_SCOPES });
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const tok = await googleExchange({ creds, redirectUri, code, requiredScopes: YT_SCOPES });
    let data;
    try {
      data = await fetchJson(`${YT_API}/channels?part=snippet&mine=true`, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
        label: 'YouTube',
      });
    } catch (e) {
      throw googleApiError(e, { service: 'YouTube' });
    }
    const ch = data.items?.[0];
    if (!ch) {
      throw new ProviderError(
        'Esa cuenta de Google no tiene canal de YouTube. Crea tu canal en youtube.com y vuelve a conectar.',
      );
    }
    const th = ch.snippet?.thumbnails;
    return [
      {
        external_id: ch.id,
        name: ch.snippet?.title || 'Mi canal',
        username: ch.snippet?.customUrl || null,
        avatar_url: th?.default?.url || th?.medium?.url || null,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        token_expires_at: addSeconds(tok.expires_in),
        meta: { channel_id: ch.id, scope: tok.scope },
      },
    ];
  },

  async refresh({ account, creds }) {
    return googleRefresh({ account, creds });
  },

  validate({ type, caption, media = [], options = {} }) {
    if (type !== 'reel') return []; // el core lo marcará como manual
    const errs = [];
    const vids = media.filter((m) => m.kind === 'video');
    if (media.length !== 1 || vids.length !== 1) errs.push('YouTube Shorts necesita exactamente 1 vídeo (sin imágenes).');
    if ((caption || '').length > 5000) errs.push('La descripción de YouTube no puede pasar de 5000 caracteres.');
    if (options.title && Array.from(String(options.title)).length > 100) errs.push('El título de YouTube no puede pasar de 100 caracteres.');
    if (options.privacy && !PRIVACY.includes(options.privacy)) errs.push('La privacidad debe ser pública, no listada o privada.');
    return errs;
  },

  /** Avisos no bloqueantes (extensión del contrato; el core puede mostrarlos). */
  warnings({ type, media = [] }) {
    if (type !== 'reel') return [];
    const w = [];
    const d = knownDuration(media[0]);
    if (d !== null && d > 180) {
      w.push(`El vídeo dura ${Math.round(d)} s: YouTube solo trata como Short los de hasta 3 minutos, así que se subirá como vídeo normal.`);
    }
    if (media[0] && !isVertical(media[0])) {
      w.push('El vídeo no es vertical: YouTube lo subirá como vídeo normal, no como Short. Usa formato vertical (9:16) de hasta 3 minutos.');
    }
    return w;
  },

  async publish({ account, creds, type, caption, media, options = {}, ctx = {} }) {
    if (type !== 'reel') throw new ProviderError('YouTube solo admite vídeos (Shorts).');
    const item = media?.[0];
    if (!item || media.length !== 1) throw new ProviderError('YouTube Shorts necesita exactamente 1 vídeo.');
    const log = ctx.log || (() => {});
    const sleepFn = ctx.sleep || sleep;
    const token = account.access_token;
    const stat = await fs.promises.stat(item.path).catch(() => null);
    if (!stat || !stat.size) throw new ProviderError('No se encuentra el archivo de vídeo en tu ordenador.');

    const privacy = PRIVACY.includes(options.privacy) ? options.privacy : 'public';
    const body = {
      snippet: {
        title: deriveTitle(options, caption, media),
        description: String(caption || '').slice(0, 5000),
        categoryId: '22',
      },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    };
    const mime = item.mime && item.mime.startsWith('video/') ? item.mime : 'video/mp4';

    log('YouTube: iniciando subida resumible');
    const init = await rawFetch(`${YT_UPLOAD}?uploadType=resumable&part=${encodeURIComponent('snippet,status')}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(stat.size),
        'X-Upload-Content-Type': mime,
      },
      body: JSON.stringify(body),
    });
    if (!init.ok) throw await errorFromResponse(init);
    const sessionUrl = init.headers.get('location');
    if (!sessionUrl) throw new ProviderError('YouTube no ha devuelto la dirección de subida. Inténtalo de nuevo.', { retryable: true });

    log(`YouTube: subiendo ${stat.size} bytes`);
    const video = await uploadResumable({ sessionUrl, token, filePath: item.path, mime, size: stat.size, sleepFn })
      .catch((e) => {
        // Si ya se había enviado el último trozo, YouTube pudo crear el vídeo: no reintentar solos.
        if (e?.finalSent) throw ambiguousPublish(e, 'YouTube');
        throw e;
      });
    const id = video?.id;
    if (!id) throw new ProviderError('YouTube no ha confirmado la subida. Revisa tu canal antes de reintentar.', { retryable: false });

    const out = { external_id: id, url: `https://youtube.com/shorts/${id}` };
    const warns = [];

    // Leer el estado real: un proyecto sin verificar puede forzar el vídeo a privado.
    try {
      const st = await fetchJson(`${YT_API}/videos?part=status&id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        label: 'YouTube',
      });
      const s = st.items?.[0]?.status;
      if (s?.privacyStatus === 'private' && privacy !== 'private') {
        warns.push('YouTube ha dejado el vídeo en privado porque tu proyecto de Google no está verificado.');
      }
      if (s?.uploadStatus === 'rejected' || s?.uploadStatus === 'failed') {
        throw new ProviderError(
          `YouTube ha rechazado el vídeo (${s.rejectionReason || s.failureReason || 'motivo desconocido'}).`,
        );
      }
    } catch (e) {
      if (e instanceof ProviderError && /rechazado el vídeo/.test(e.message)) throw e;
      log('YouTube: no se pudo leer el estado del vídeo', String(e?.message || e));
    }
    if (!isVertical(item)) warns.push('El vídeo no es vertical, así que YouTube lo trata como vídeo normal y no como Short.');
    if (warns.length) out.warning = warns.join(' ');
    return out;
  },
};
