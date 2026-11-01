// Bluesky (AT Protocol) con contraseña de aplicación. No hay app review ni "carné" de desarrollador.
//
// Fuentes:
//  - Publicar, facets (offsets en bytes UTF-8) e imágenes (≤4, aspectRatio):
//      https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/posts.md
//  - Vídeo (getServiceAuth aud=did:web:<host del PDS> lxm=com.atproto.repo.uploadBlob exp ≈ 30 min ->
//    POST https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did&name con Bearer del service auth ->
//    sondear app.bsky.video.getJobStatus hasta tener `blob` -> embed app.bsky.embed.video):
//      https://docs.bsky.app/docs/tutorials/video
//  - Límites de tasa y sesiones: https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/rate-limits.md
//  - Autenticación: https://atproto.com/guides/sdk-auth
//
// Decisiones:
//  * Solo se guardan los tokens (accessJwt / refreshJwt). La contraseña de aplicación NO se guarda: si el
//    refresh falla, se pide al alumno que la vuelva a introducir (ProviderError auth:true).
//  * Solo se aceptan contraseñas de aplicación (formato xxxx-xxxx-xxxx-xxxx) para no recibir nunca la contraseña real.
//  * 300 grafemas de texto (Intl.Segmenter); imágenes ≤ ~950 KB (límite del lexicon: 1.000.000 bytes).
//
// NO VERIFICADO: límites exactos de vídeo (las fuentes se contradicen); se consulta app.bsky.video.getUploadLimits
// en tiempo de ejecución cuando es posible. La resolución de PDS usa plc.directory / did:web (estándar atproto).
import fs from 'node:fs';
import { ProviderError, fetchJson, waitFor, ambiguousPublish } from './_http.js';
import { durationErrors } from './_media.js';

const ENTRYWAY = 'https://bsky.social';
const PUBLIC_API = 'https://public.api.bsky.app';
const VIDEO_SERVICE = 'https://video.bsky.app';
const VIDEO_DID = 'did:web:video.bsky.app';
const L = 'Bluesky';

const TEXT_MAX_GRAPHEMES = 300;
const TEXT_MAX_BYTES = 3000;
const IMAGE_TARGET_BYTES = 950 * 1024; // el límite real es 1.000.000 bytes
const APP_PASSWORD_RE = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i;
const VIDEO_MIMES = new Set(['video/mp4', 'video/mpeg', 'video/webm', 'video/quicktime']);

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemeLength(text) {
  let n = 0;
  for (const _ of segmenter.segment(String(text ?? ''))) n++; // eslint-disable-line no-unused-vars
  return n;
}

const isVideo = (m) => m.kind === 'video' || /^video\//.test(m.mime || '');
const isImage = (m) => m.kind === 'image' || /^image\//.test(m.mime || '');

// ---------------------------------------------------------------- helpers de red

function mapXrpcError(e) {
  if (!(e instanceof ProviderError)) return e;
  const code = e.raw && typeof e.raw === 'object' ? e.raw.error : null;
  if (['ExpiredToken', 'InvalidToken', 'AuthenticationRequired', 'AuthMissing', 'BadJwt'].includes(code)) {
    return new ProviderError('Tu sesión de Bluesky ha caducado. Reconecta tu cuenta en Redes con tu contraseña de aplicación.', { auth: true, status: e.status, raw: e.raw });
  }
  if (code === 'RateLimitExceeded' || e.status === 429) {
    return new ProviderError('Bluesky indica demasiadas peticiones seguidas. Se reintentará más tarde.', { retryable: true, status: e.status, raw: e.raw, rateLimited: true });
  }
  const msg = String(e.raw?.message || '');
  if (code === 'InvalidRequest' && /grapheme|longer than|too long/i.test(msg)) {
    return new ProviderError('El texto es demasiado largo para Bluesky (máximo 300 caracteres). Acórtalo y vuelve a programar.', { status: e.status, raw: e.raw });
  }
  if (/blob|too large|size/i.test(msg) && e.status === 400) {
    return new ProviderError('Bluesky ha rechazado un archivo por su tamaño. Las imágenes deben pesar menos de 1 MB (WillyPost las reduce solas) y los vídeos ser cortos y ligeros.', { status: e.status, raw: e.raw });
  }
  return e;
}

async function xrpc(base, nsid, { method = 'GET', token, query, json, body, contentType } = {}) {
  let url = `${base.replace(/\/$/, '')}/xrpc/${nsid}`;
  if (query) url += `?${new URLSearchParams(query).toString()}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers, label: L };
  if (json !== undefined) opts.json = json;
  else if (body !== undefined) {
    opts.body = body;
    if (contentType) headers['Content-Type'] = contentType;
  }
  try {
    return await fetchJson(url, opts);
  } catch (e) {
    throw mapXrpcError(e);
  }
}

function jwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function pdsFromDoc(doc) {
  const svc = (doc?.service || []).find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint || null;
}

/** Devuelve { did, pds } (pds = servicio real del usuario) o null si no se puede resolver. */
async function resolveIdentity(handle) {
  try {
    const r = await fetchJson(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?${new URLSearchParams({ handle })}`, { label: L });
    const did = r.did;
    if (!did) return null;
    let doc;
    if (did.startsWith('did:plc:')) doc = await fetchJson(`https://plc.directory/${did}`, { label: L });
    else if (did.startsWith('did:web:')) doc = await fetchJson(`https://${did.slice(8)}/.well-known/did.json`, { label: L });
    return { did, pds: pdsFromDoc(doc) };
  } catch {
    return null;
  }
}

async function resolveMentionDid(handle) {
  try {
    const r = await fetchJson(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?${new URLSearchParams({ handle })}`, { label: L });
    return r.did || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- facets

const TLDS = 'com|net|org|es|io|co|eu|info|dev|app|ai|me|tv|uk|fr|de|it|pt|mx|ar|cl|us|ly|link|blog|shop|online|site|academy|school|seo|tech|xyz|cat|gal|eus';
const LINK_RE = new RegExp(
  String.raw`(?<![@\w/.-])(?:https?:\/\/[^\s<>"]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS})(?![\p{L}\p{N}-])(?::\d+)?(?:\/[^\s<>"]*)?)`,
  'giu',
);
const TAG_RE = /(?<=^|\s)[#＃]([^\s#]+)/gu;
const MENTION_RE = /(?<![\w@])@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)/gi;

function trimTrailing(str) {
  let s = str;
  for (;;) {
    const last = s.at(-1);
    if (!last) break;
    if (/[.,;:!?'"»”’]/.test(last)) s = s.slice(0, -1);
    else if (last === ')' && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
    else if (last === ']' && (s.match(/\[/g) || []).length < (s.match(/\]/g) || []).length) s = s.slice(0, -1);
    else break;
  }
  return s;
}

/**
 * Construye los facets (enlaces, hashtags y menciones) con offsets en bytes UTF-8.
 * @param {string} text
 * @param {{resolveMention?: (handle:string)=>Promise<string|null>}} [opts]
 */
export async function buildFacets(text, { resolveMention = resolveMentionDid } = {}) {
  const found = [];
  const taken = [];
  const free = (a, b) => taken.every(([x, y]) => b <= x || a >= y);
  const byteAt = (idx) => Buffer.byteLength(text.slice(0, idx), 'utf8');
  const add = (start, end, feature) => {
    if (end <= start || !free(start, end)) return false;
    taken.push([start, end]);
    found.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(end) }, features: [feature] });
    return true;
  };

  for (const m of text.matchAll(LINK_RE)) {
    const raw = trimTrailing(m[0]);
    if (!raw) continue;
    const uri = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    add(m.index, m.index + raw.length, { $type: 'app.bsky.richtext.facet#link', uri });
  }
  for (const m of text.matchAll(TAG_RE)) {
    const tag = trimTrailing(m[1]).replace(/[\p{P}\p{S}]+$/u, '');
    if (!tag || /^\d+$/.test(tag) || graphemeLength(tag) > 64) continue;
    add(m.index, m.index + 1 + tag.length, { $type: 'app.bsky.richtext.facet#tag', tag });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    if (!free(m.index, m.index + m[0].length)) continue;
    const did = await resolveMention(m[1].toLowerCase());
    if (did) add(m.index, m.index + m[0].length, { $type: 'app.bsky.richtext.facet#mention', did });
  }
  found.sort((a, b) => a.index.byteStart - b.index.byteStart);
  return found;
}

// ---------------------------------------------------------------- imágenes

async function prepareImage(item, ctx) {
  const buf = await fs.promises.readFile(item.path);
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    sharp = null;
  }
  const alreadyOk = buf.length <= IMAGE_TARGET_BYTES && /^image\//.test(item.mime || '');
  if (alreadyOk) {
    let w = item.width, h = item.height;
    if (sharp) {
      try {
        const md = await sharp(buf).metadata();
        if (md.width && md.height) [w, h] = md.orientation >= 5 ? [md.height, md.width] : [md.width, md.height];
      } catch { /* usamos las dimensiones de la base de datos */ }
    }
    return { buf, mime: item.mime, width: w, height: h };
  }
  if (!sharp) throw new ProviderError(`La imagen "${item.original_name || item.id}" pesa demasiado para Bluesky y no se puede reducir.`);
  const sizes = [null, 2048, 1600, 1280, 1024, 800];
  const qualities = [88, 78, 68, 58];
  for (const side of sizes) {
    for (const q of qualities) {
      let pipe = sharp(buf).rotate().flatten({ background: '#ffffff' });
      if (side) pipe = pipe.resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });
      const { data, info } = await pipe.jpeg({ quality: q, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (data.length <= IMAGE_TARGET_BYTES) {
        ctx?.log?.(`Bluesky: imagen reducida a ${Math.round(data.length / 1024)} KB (calidad ${q}${side ? `, ${side}px` : ''})`);
        return { buf: data, mime: 'image/jpeg', width: info.width, height: info.height };
      }
    }
  }
  throw new ProviderError(`No se ha podido reducir la imagen "${item.original_name || item.id}" por debajo del límite de Bluesky (1 MB).`);
}

// ---------------------------------------------------------------- vídeo

async function serviceAuth(meta, token, aud, lxm) {
  const r = await xrpc(meta.pds || ENTRYWAY, 'com.atproto.server.getServiceAuth', {
    token,
    query: { aud, lxm, exp: String(Math.floor(Date.now() / 1000) + 29 * 60) },
  });
  if (!r.token) throw new ProviderError('Bluesky no ha concedido permiso para subir vídeo.');
  return r.token;
}

async function uploadVideoBlob(account, item, ctx) {
  const meta = account.meta || {};
  const token = account.access_token;
  const pdsHost = new URL(meta.pdsUrl || meta.pds || ENTRYWAY).host;
  const log = ctx?.log || (() => {});
  const fail = (e) => {
    if (e instanceof ProviderError && e.auth) return e;
    const reason = e instanceof ProviderError ? e.message : String(e?.message || e);
    return new ProviderError(
      `No se ha podido subir el vídeo a Bluesky: ${reason}. Prueba con un vídeo más corto o más ligero, comprueba que has verificado tu email en Bluesky, o publícalo a mano.`,
      { retryable: e instanceof ProviderError ? e.retryable : false, raw: e?.raw },
    );
  };
  try {
    // Límites diarios (best effort).
    try {
      const t = await serviceAuth(meta, token, VIDEO_DID, 'app.bsky.video.getUploadLimits');
      const lim = await xrpc(VIDEO_SERVICE, 'app.bsky.video.getUploadLimits', { token: t });
      if (lim.canUpload === false) {
        throw new ProviderError(lim.message || 'Bluesky no te deja subir más vídeo hoy', { raw: lim });
      }
    } catch (e) {
      if (e instanceof ProviderError && /no te deja subir|límite|limit/i.test(e.message) && !e.status) throw e;
    }

    const stat = await fs.promises.stat(item.path);
    const auth = await serviceAuth(meta, token, `did:web:${pdsHost}`, 'com.atproto.repo.uploadBlob');
    const data = await fs.promises.readFile(item.path);
    const name = (item.original_name || `video-${item.id}.mp4`).replace(/[^\w.\-]+/g, '_');
    let job;
    try {
      const up = await xrpc(VIDEO_SERVICE, 'app.bsky.video.uploadVideo', {
        method: 'POST', token: auth, body: data, contentType: item.mime || 'video/mp4',
        query: { did: meta.did, name },
      });
      job = up.jobStatus || up;
    } catch (e) {
      // Si el vídeo ya se subió antes, Bluesky responde 409 con el job existente.
      if (e instanceof ProviderError && e.status === 409 && e.raw?.jobId) job = e.raw;
      else throw e;
    }
    log(`Bluesky: vídeo enviado (${Math.round(stat.size / 1024 / 1024)} MB), procesando…`);
    const blob = await waitFor(async () => {
      if (job.blob) return job.blob;
      const st = await xrpc(VIDEO_SERVICE, 'app.bsky.video.getJobStatus', { query: { jobId: job.jobId } });
      const js = st.jobStatus || st;
      if (js.state === 'JOB_STATE_FAILED' || js.error) {
        throw new ProviderError(js.message || js.error || 'el procesado del vídeo ha fallado');
      }
      if (js.blob) return js.blob;
      return null;
    }, { interval: 2000, timeout: 5 * 60 * 1000, label: 'a que Bluesky procese el vídeo' });
    return blob;
  } catch (e) {
    throw fail(e);
  }
}

// ---------------------------------------------------------------- proveedor

export default {
  id: 'bluesky',
  label: 'Bluesky',
  color: '#1185FE',
  family: null,
  authType: 'apppassword',
  redirect: 'local',
  supports: { post: true, carousel: true, reel: true, story: false, textOnly: true },
  limits: { captionMax: TEXT_MAX_GRAPHEMES, carouselMax: 4, videoMaxSec: 180 },
  needsApproval: null,
  notes:
    'Sin carné de desarrollador: usa una contraseña de aplicación (Ajustes > Privacidad y seguridad > Contraseñas de aplicación). 300 caracteres, hasta 4 imágenes. Para subir vídeo tu email de Bluesky debe estar verificado.',

  async connectWithPassword({ handle, appPassword }) {
    const id = String(handle || '').trim().replace(/^@/, '').toLowerCase();
    const pw = String(appPassword || '').trim();
    if (!id) throw new ProviderError('Escribe tu usuario de Bluesky (por ejemplo, tunombre.bsky.social).');
    if (!APP_PASSWORD_RE.test(pw)) {
      throw new ProviderError(
        'Eso no parece una contraseña de aplicación. Créala en Bluesky > Ajustes > Privacidad y seguridad > Contraseñas de aplicación (tiene el formato xxxx-xxxx-xxxx-xxxx). No uses tu contraseña normal.',
      );
    }
    // 1) Dónde está la cuenta. bsky.social hace de entrada para las cuentas alojadas por Bluesky.
    let base = ENTRYWAY;
    if (!id.endsWith('.bsky.social') && !id.includes('@')) {
      const ident = await resolveIdentity(id);
      if (ident?.pds && !new URL(ident.pds).host.endsWith('.host.bsky.network')) base = ident.pds;
    }
    // 2) Sesión
    let s;
    try {
      s = await xrpc(base, 'com.atproto.server.createSession', { method: 'POST', json: { identifier: id, password: pw } });
    } catch (e) {
      if (e instanceof ProviderError && (e.status === 401 || e.status === 400)) {
        throw new ProviderError('Bluesky no ha aceptado ese usuario o esa contraseña de aplicación. Revisa que no tenga espacios y que la hayas creado en Bluesky.', { auth: true, status: e.status, raw: e.raw });
      }
      throw e;
    }
    const realPds = pdsFromDoc(s.didDoc) || base;
    // 3) Perfil (nombre y avatar). No es crítico.
    let profile = {};
    try {
      profile = await fetchJson(`${PUBLIC_API}/xrpc/app.bsky.actor.getProfile?${new URLSearchParams({ actor: s.did })}`, { label: L });
    } catch { /* sin avatar */ }
    const finalHandle = s.handle || profile.handle || id;
    return {
      external_id: s.did,
      name: profile.displayName || finalHandle,
      username: finalHandle,
      avatar_url: profile.avatar || null,
      access_token: s.accessJwt,
      refresh_token: s.refreshJwt,
      token_expires_at: jwtExp(s.accessJwt),
      meta: { did: s.did, pds: base, pdsUrl: realPds, handle: finalHandle },
    };
  },

  async refresh({ account }) {
    const base = account.meta?.pds || ENTRYWAY;
    if (!account.refresh_token) {
      throw new ProviderError('Tu conexión con Bluesky ha caducado. Vuelve a escribir tu contraseña de aplicación en Redes.', { auth: true });
    }
    try {
      const r = await xrpc(base, 'com.atproto.server.refreshSession', { method: 'POST', token: account.refresh_token });
      return {
        access_token: r.accessJwt,
        refresh_token: r.refreshJwt || account.refresh_token,
        token_expires_at: jwtExp(r.accessJwt),
      };
    } catch (e) {
      if (e instanceof ProviderError && (e.retryable || (!e.status && !e.auth))) throw e; // sin internet, etc.
      throw new ProviderError('Tu conexión con Bluesky ha caducado. Vuelve a escribir tu contraseña de aplicación en Redes.', { auth: true, status: e?.status, raw: e?.raw });
    }
  },

  validate({ type, caption, media = [] }) {
    const errs = [];
    if (type === 'story') return errs; // sin stories por API -> modo manual
    const text = String(caption ?? '');
    const n = graphemeLength(text);
    if (n > TEXT_MAX_GRAPHEMES) errs.push(`Bluesky admite 300 caracteres (tienes ${n}). Acorta el texto.`);
    if (Buffer.byteLength(text, 'utf8') > TEXT_MAX_BYTES) errs.push('El texto es demasiado largo para Bluesky.');
    const imgs = media.filter(isImage);
    const vids = media.filter(isVideo);
    if (imgs.length && vids.length) errs.push('Bluesky no permite mezclar imágenes y vídeo en la misma publicación.');
    if (imgs.length > 4) errs.push('Bluesky admite hasta 4 imágenes por publicación.');
    if (vids.length > 1) errs.push('Bluesky solo admite un vídeo por publicación.');
    if (type === 'carousel' && imgs.length < 2) errs.push('Un carrusel en Bluesky necesita entre 2 y 4 imágenes.');
    if (type === 'reel' && vids.length !== 1) errs.push('Un reel en Bluesky necesita exactamente un vídeo.');
    if (!text.trim() && !media.length) errs.push('Escribe un texto o añade un archivo.');
    for (const v of vids) {
      errs.push(...durationErrors(v, { max: 180, label: 'Bluesky' }));
      if (v.mime && !VIDEO_MIMES.has(v.mime)) errs.push(`Bluesky no admite este formato de vídeo (${v.mime}). Usa MP4.`);
    }
    return errs;
  },

  async publish({ account, type, caption, media = [], options = {}, ctx }) {
    const token = account.access_token;
    const meta = account.meta || {};
    const base = meta.pds || ENTRYWAY;
    if (!token || !meta.did) {
      throw new ProviderError('Tu conexión con Bluesky ha caducado. Reconecta tu cuenta en Redes.', { auth: true });
    }
    const text = String(caption ?? '');
    const imgs = media.filter(isImage).slice(0, 4);
    const vid = media.find(isVideo);

    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
    };
    if (Array.isArray(options.langs) && options.langs.length) record.langs = options.langs.slice(0, 3);
    const facets = await buildFacets(text);
    if (facets.length) record.facets = facets;

    const altOf = (i) => {
      const a = options.altText;
      const v = Array.isArray(a) ? a[i] : a;
      return typeof v === 'string' ? v.slice(0, 1000) : '';
    };

    if (vid) {
      const blob = await uploadVideoBlob(account, vid, ctx);
      record.embed = { $type: 'app.bsky.embed.video', video: blob };
      if (vid.width && vid.height) record.embed.aspectRatio = { width: vid.width, height: vid.height };
      if (altOf(0)) record.embed.alt = altOf(0);
    } else if (imgs.length) {
      const out = [];
      for (let i = 0; i < imgs.length; i++) {
        const p = await prepareImage(imgs[i], ctx);
        const up = await xrpc(base, 'com.atproto.repo.uploadBlob', { method: 'POST', token, body: p.buf, contentType: p.mime });
        const entry = { alt: altOf(i), image: up.blob };
        if (p.width && p.height) entry.aspectRatio = { width: p.width, height: p.height };
        out.push(entry);
      }
      record.embed = { $type: 'app.bsky.embed.images', images: out };
    }

    const res = await xrpc(base, 'com.atproto.repo.createRecord', {
      method: 'POST', token,
      json: { repo: meta.did, collection: 'app.bsky.feed.post', record },
    }).catch((e) => { throw ambiguousPublish(e, 'Bluesky'); });
    const rkey = String(res.uri || '').split('/').pop();
    const who = meta.handle || account.username || meta.did;
    return { external_id: res.uri, url: `https://bsky.app/profile/${who}/post/${rkey}` };
  },
};
