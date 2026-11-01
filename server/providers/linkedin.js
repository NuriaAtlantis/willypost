// LinkedIn (perfil personal). Productos de la app: "Sign In with LinkedIn using OpenID Connect"
// + "Share on LinkedIn" (scopes: openid profile w_member_social). Token de 60 días, sin refresh.
//
// Documentación verificada (Microsoft Learn, versión de API li-lms-2026-10) el 2026-11-01:
//  - OAuth 3-legged:   https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
//  - Sign In OIDC:     https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
//  - Posts API:        https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
//  - Images API:       https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
//  - MultiImage API:   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
//  - Videos API:       https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
//  - Formato "little": https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
//
// Hechos de la documentación usados aquí:
//  * Todas las llamadas /rest/* llevan `Linkedin-Version: YYYYMM` y `X-Restli-Protocol-Version: 2.0.0`.
//    La versión 202511 se retira el 2026-11-16; la última documentada es 202610.
//  * POST /rest/posts -> 201 y el id del post en la cabecera de respuesta `x-restli-id`.
//  * Imágenes: POST /rest/images?action=initializeUpload {initializeUploadRequest:{owner}} ->
//    {value:{uploadUrl, image:"urn:li:image:..."}}; luego se sube el binario a uploadUrl.
//    JPG/GIF/PNG, < 36.152.320 píxeles.
//  * multiImage: content.multiImage.images[{id, altText}] con mínimo 2 y máximo 20 imágenes.
//  * Vídeo: POST /rest/videos?action=initializeUpload {owner, fileSizeBytes, uploadCaptions, uploadThumbnail}
//    -> {value:{video, uploadToken, uploadInstructions:[{firstByte,lastByte,uploadUrl}]}} (trozos de 4 MB);
//    PUT de cada trozo (el ETag de la respuesta es el id del trozo) y
//    POST /rest/videos?action=finalizeUpload {finalizeUploadRequest:{video, uploadToken, uploadedPartIds}}.
//    MP4, 3 s – 30 min, 75 KB – 500 MB. Estado: GET /rest/videos/{urn} -> PROCESSING | AVAILABLE | PROCESSING_FAILED.
//  * Texto del post ("commentary") en formato "little": los caracteres reservados
//    | { } @ [ ] ( ) < > # \ * _ ~ hay que escaparlos con barra invertida (si no, el texto se trunca o se rompe).
//    Un "#palabra" sin escapar se convierte en hashtag.
//  * El token de w_member_social es de solo escritura: los GET de /rest/images y /rest/videos pueden dar 403.
//    Por eso el sondeo de estado es "best effort" y, si no se puede leer, esperamos un tiempo prudencial.
//
// NO VERIFICADO (no está en las páginas consultadas): si la subida PUT a uploadUrl necesita la cabecera
// Authorization (la mandamos en imágenes, como en la guía antigua de Assets API; en vídeo no, como en el
// ejemplo oficial) y el límite exacto de caracteres de "commentary" (3000 es el dato conocido).
import fs from 'node:fs';
import { ProviderError, sleep, ambiguousPublish } from './_http.js';
import { durationErrors } from './_media.js';

export const LINKEDIN_VERSION = process.env.WILLYPOST_LINKEDIN_VERSION || '202610';
const API = 'https://api.linkedin.com';
const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const SCOPES = 'openid profile w_member_social';
const CAPTION_MAX = 3000;
const IMAGE_MAX_PIXELS = 36152320;
const VIDEO_MIN_BYTES = 75 * 1024;
const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const VIDEO_PART_BYTES = 4194304;
const NATIVE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif']);

const L = 'LinkedIn';

function restHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Linkedin-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

/** Traduce un error HTTP de LinkedIn a ProviderError en español. */
function httpError(res, body, what) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body || {});
  const detail = (body && (body.message || body.error_description || body.code)) || raw.slice(0, 250);
  const s = res.status;
  if (s === 401) {
    return new ProviderError('Tu conexión con LinkedIn ha caducado o se ha revocado. Reconecta tu cuenta en Redes.', { auth: true, status: s, raw: body });
  }
  if (s === 403) {
    return new ProviderError(
      'LinkedIn ha rechazado el permiso. Reconecta la cuenta y comprueba que tu app tiene los productos "Share on LinkedIn" y "Sign In with LinkedIn using OpenID Connect".',
      { auth: true, status: s, raw: body },
    );
  }
  if (s === 426 || /NONEXISTENT_VERSION/i.test(raw)) {
    return new ProviderError('LinkedIn ya no acepta la versión de API que usa esta copia de WillyPost. Actualiza WillyPost.', { status: s, raw: body });
  }
  if (s === 422 || (s === 400 && /duplicate/i.test(raw))) {
    return new ProviderError(`LinkedIn ha rechazado la publicación (¿contenido duplicado o texto no válido?): ${detail}`, { status: s, raw: body });
  }
  if (s === 429) {
    return new ProviderError('LinkedIn indica demasiadas peticiones. Se reintentará más tarde.', { retryable: true, status: s, raw: body });
  }
  return new ProviderError(`LinkedIn (${what}): ${detail}`, { retryable: s >= 500, status: s, raw: body });
}

async function rest(url, { token, method = 'POST', json, headers = {}, what }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: restHeaders(token, json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers),
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch (e) {
    throw new ProviderError('No se pudo contactar con LinkedIn. ¿Tienes conexión a internet?', { retryable: true, raw: String(e) });
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!res.ok) throw httpError(res, body, what);
  return { res, body };
}

/** Sube bytes a una uploadUrl firmada con PUT. Devuelve la cabecera ETag (sin comillas) si la hay. */
async function putBinary(url, data, { token, mime = 'application/octet-stream', what }) {
  const headers = { 'Content-Type': mime || 'application/octet-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method: 'PUT', headers, body: data });
  } catch (e) {
    throw new ProviderError('No se pudo subir el archivo a LinkedIn. ¿Tienes conexión a internet?', { retryable: true, raw: String(e) });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw httpError(res, t, what);
  }
  const etag = res.headers.get('etag');
  return etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') : null;
}

/**
 * Escapa el texto al formato "little" de LinkedIn. Los #hashtags (# + letras/números/_) se dejan tal cual
 * para que LinkedIn los convierta en hashtag; cualquier otro carácter reservado se escapa.
 */
export function escapeLittle(text) {
  return String(text ?? '').replace(
    /(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+|[\\|{}@[\]()<>*_~#]/gu,
    (m) => (m.length > 1 ? m : `\\${m}`),
  );
}

function isVideo(m) { return m.kind === 'video' || /^video\//.test(m.mime || ''); }
function isImage(m) { return m.kind === 'image' || /^image\//.test(m.mime || ''); }

export default {
  id: 'linkedin',
  label: 'LinkedIn',
  color: '#0A66C2',
  family: 'linkedin',
  authType: 'oauth',
  redirect: 'relay',
  supports: { post: true, carousel: true, reel: true, story: false, textOnly: true },
  limits: { captionMax: CAPTION_MAX, carouselMax: 20, videoMaxSec: 1800 },
  needsApproval: null,
  notes:
    'Perfil personal (las páginas de empresa exigen aprobación de LinkedIn). Necesitas los productos "Share on LinkedIn" y "Sign In with LinkedIn using OpenID Connect". La conexión dura 60 días en LinkedIn (WillyPost te pide reconectar a los 30).',

  getAuthUrl({ creds, redirectUri, state }) {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES,
    });
    return `${AUTH_URL}?${p.toString()}`;
  },

  async exchangeCode({ creds, redirectUri, code }) {
    let res;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          redirect_uri: redirectUri,
        }).toString(),
      });
    } catch (e) {
      throw new ProviderError('No se pudo contactar con LinkedIn. ¿Tienes conexión a internet?', { retryable: true, raw: String(e) });
    }
    const tok = await res.json().catch(() => ({}));
    if (!res.ok || !tok.access_token) {
      const d = tok.error_description || tok.error || `HTTP ${res.status}`;
      throw new ProviderError(
        `LinkedIn no ha aceptado el código de conexión (${d}). Revisa el Client ID, el Client Secret y que la URI de redirección de tu app sea exactamente la que te indica el asistente.`,
        { auth: true, status: res.status, raw: tok },
      );
    }
    const ui = await fetch(`${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const info = await ui.json().catch(() => ({}));
    if (!ui.ok || !info.sub) {
      throw new ProviderError(
        'LinkedIn no ha devuelto tu perfil. Comprueba que tu app tiene el producto "Sign In with LinkedIn using OpenID Connect" activado y vuelve a conectar.',
        { auth: true, status: ui.status, raw: info },
      );
    }
    const expiresIn = Number(tok.expires_in) || 60 * 24 * 3600;
    return [
      {
        external_id: info.sub,
        name: info.name || [info.given_name, info.family_name].filter(Boolean).join(' ') || 'LinkedIn',
        username: info.email || null,
        avatar_url: info.picture || null,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token || null,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        meta: { urn: `urn:li:person:${info.sub}`, scope: tok.scope || SCOPES },
      },
    ];
  },

  // LinkedIn no da refresh_token a apps normales: hay que reautorizar (el alumno reconecta).
  async refresh() {
    return null;
  },

  validate({ type, caption, media = [] }) {
    const errs = [];
    if (type === 'story') return errs; // no soportado por API -> el core lo pasa a modo manual
    const text = String(caption ?? '');
    if (text.length > CAPTION_MAX) errs.push(`LinkedIn admite hasta ${CAPTION_MAX} caracteres (tienes ${text.length}).`);
    const imgs = media.filter(isImage);
    const vids = media.filter(isVideo);
    if (imgs.length && vids.length) errs.push('LinkedIn no permite mezclar imágenes y vídeo en la misma publicación.');
    if (vids.length > 1) errs.push('LinkedIn solo admite un vídeo por publicación.');
    if (imgs.length > 20) errs.push('LinkedIn admite hasta 20 imágenes por publicación.');
    if (type === 'carousel' && imgs.length < 2) errs.push('Un carrusel en LinkedIn necesita al menos 2 imágenes.');
    if (type === 'reel' && vids.length !== 1) errs.push('Un reel en LinkedIn necesita exactamente un vídeo.');
    if (!text.trim() && !media.length) errs.push('Escribe un texto o añade un archivo.');
    for (const m of imgs) {
      if (m.width && m.height && m.width * m.height >= IMAGE_MAX_PIXELS) {
        errs.push(`La imagen "${m.original_name || m.id}" es demasiado grande para LinkedIn (máx. unos 36 megapíxeles).`);
      }
    }
    for (const m of vids) {
      if (m.mime && m.mime !== 'video/mp4') errs.push(`LinkedIn solo admite vídeo MP4 ("${m.original_name || m.id}" no lo es).`);
      if (m.size && m.size > VIDEO_MAX_BYTES) errs.push('El vídeo supera el máximo de LinkedIn (500 MB).');
      errs.push(...durationErrors(m, { min: 3, max: 1800, label: 'LinkedIn' }));
      if (m.size && m.size < VIDEO_MIN_BYTES) errs.push('El vídeo es demasiado pequeño para LinkedIn (mínimo 75 KB).');
    }
    return errs;
  },

  async publish({ account, type, caption, media = [], options = {}, ctx }) {
    const token = account.access_token;
    if (!token) throw new ProviderError('Tu conexión con LinkedIn ha caducado. Reconecta tu cuenta en Redes.', { auth: true });
    const owner = account.meta?.urn || `urn:li:person:${account.external_id}`;
    const log = ctx?.log || (() => {});
    const doSleep = ctx?.sleep || sleep;

    const imgs = media.filter(isImage);
    const vid = media.find(isVideo);

    const altOf = (i) => {
      const a = options.altText;
      if (Array.isArray(a)) return a[i] || undefined;
      return typeof a === 'string' && a ? a : undefined;
    };

    // ---- Imágenes ----
    async function uploadImage(item) {
      let file = { path: item.path, mime: item.mime };
      if (!NATIVE_IMAGE_MIMES.has(item.mime) && ctx?.toJpeg) file = await ctx.toJpeg(item);
      const init = await rest(`${API}/rest/images?action=initializeUpload`, {
        token, what: 'preparar la imagen',
        json: { initializeUploadRequest: { owner } },
      });
      const { uploadUrl, image } = init.body?.value || {};
      if (!uploadUrl || !image) throw new ProviderError('LinkedIn no ha devuelto la dirección de subida de la imagen.', { retryable: true, raw: init.body });
      const data = await fs.promises.readFile(file.path);
      await putBinary(uploadUrl, data, { token, mime: file.mime, what: 'subir la imagen' });
      log(`LinkedIn: imagen subida ${image}`);
      return image;
    }

    // ---- Vídeo ----
    async function uploadVideo(item) {
      const stat = await fs.promises.stat(item.path);
      const init = await rest(`${API}/rest/videos?action=initializeUpload`, {
        token, what: 'preparar el vídeo',
        json: { initializeUploadRequest: { owner, fileSizeBytes: stat.size, uploadCaptions: false, uploadThumbnail: false } },
      });
      const v = init.body?.value || {};
      if (!v.video || !Array.isArray(v.uploadInstructions) || !v.uploadInstructions.length) {
        throw new ProviderError('LinkedIn no ha devuelto las instrucciones de subida del vídeo.', { retryable: true, raw: init.body });
      }
      const fh = await fs.promises.open(item.path, 'r');
      const etags = [];
      try {
        for (const part of v.uploadInstructions) {
          const first = Number(part.firstByte);
          const last = Math.min(Number(part.lastByte), stat.size - 1);
          const len = last - first + 1;
          if (len <= 0 || len > VIDEO_PART_BYTES * 2) throw new ProviderError('LinkedIn ha indicado un trozo de vídeo no válido.', { retryable: true });
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, first);
          const etag = await putBinary(part.uploadUrl, buf, { mime: 'application/octet-stream', what: 'subir el vídeo' });
          if (!etag) throw new ProviderError('LinkedIn no ha confirmado un trozo del vídeo (falta ETag). Inténtalo de nuevo.', { retryable: true });
          etags.push(etag);
          log(`LinkedIn: trozo de vídeo ${etags.length}/${v.uploadInstructions.length}`);
        }
      } finally {
        await fh.close();
      }
      await rest(`${API}/rest/videos?action=finalizeUpload`, {
        token, what: 'cerrar la subida del vídeo',
        json: { finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken || '', uploadedPartIds: etags } },
      });
      // Esperar a AVAILABLE (best effort: con w_member_social el GET puede dar 403).
      const urn = encodeURIComponent(v.video);
      const start = Date.now();
      let readable = true;
      while (Date.now() - start < 10 * 60 * 1000) {
        try {
          const st = await rest(`${API}/rest/videos/${urn}`, { token, method: 'GET', what: 'consultar el vídeo' });
          const status = st.body?.status;
          if (status === 'AVAILABLE') return v.video;
          if (status === 'PROCESSING_FAILED') {
            throw new ProviderError(`LinkedIn no ha podido procesar el vídeo${st.body?.processingFailureReason ? ` (${st.body.processingFailureReason})` : ''}. Comprueba que es un MP4 válido.`);
          }
        } catch (e) {
          if (e instanceof ProviderError && /no ha podido procesar/.test(e.message)) throw e;
          if (e.status === 401) throw e;
          readable = false;
          break;
        }
        await doSleep(4000);
      }
      if (!readable) {
        log('LinkedIn: no se puede consultar el estado del vídeo con este permiso; espera de cortesía.');
        await doSleep(Math.min(60000, 8000 + Math.round(stat.size / (1024 * 1024)) * 1000));
      }
      return v.video;
    }

    // ---- Contenido del post ----
    const body = {
      author: owner,
      commentary: escapeLittle(caption),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (vid) {
      const urn = await uploadVideo(vid);
      body.content = { media: { id: urn, ...(options.title ? { title: String(options.title).slice(0, 200) } : {}) } };
    } else if (imgs.length === 1) {
      const urn = await uploadImage(imgs[0]);
      const alt = altOf(0);
      body.content = { media: { id: urn, ...(alt ? { altText: alt } : {}) } };
    } else if (imgs.length >= 2) {
      const urns = [];
      for (const it of imgs.slice(0, 20)) urns.push(await uploadImage(it));
      body.content = {
        multiImage: { images: urns.map((id, i) => ({ id, ...(altOf(i) ? { altText: altOf(i) } : {}) })) },
      };
    }

    const { res, body: out } = await rest(`${API}/rest/posts`, { token, json: body, what: 'publicar' })
      .catch((e) => { throw ambiguousPublish(e, 'LinkedIn'); });
    const urn = res.headers.get('x-restli-id') || out?.id;
    if (!urn) throw new ProviderError('LinkedIn ha aceptado la publicación pero no ha devuelto su identificador. Compruébala en tu perfil.', { raw: out });
    return { external_id: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
  },
};
