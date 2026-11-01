// Facebook Pages (Graph API, Facebook Login). family 'meta', redirect 'relay'.
//
// Documentación consultada (nov-2026):
//  - Versiones Graph API (última: v26.0, 29-jul-2026): https://developers.facebook.com/docs/graph-api/changelog/versions
//  - Login manual (dialog + code→token):   https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
//  - Publicar en Páginas (feed/photos):    https://developers.facebook.com/docs/pages-api/posts
//  - POST /{page}/photos (source/url, published=false, attached_media): https://developers.facebook.com/docs/graph-api/reference/page/photos/
//  - Reels (video_reels, rupload):         https://developers.facebook.com/docs/video-api/guides/reels-publishing
//  - Stories de Página (photo_stories / video_stories): https://developers.facebook.com/docs/page-stories-api
// Sin verificar en docs oficiales: fb_exchange_token (conocimiento previo, API estable), campo permalink_url,
// que el Page token derivado de un token largo no caduca (fuentes de terceros).
import fs from 'node:fs';
import { ProviderError, fetchJson, waitFor, ambiguousPublish, oauthExchangeError } from './_http.js';
import { fitImage, durationErrors, MAX_IMAGE_BYTES } from './_media.js';

export const GRAPH_VERSION = 'v26.0'; // única constante de versión
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const RUPLOAD = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;
const LABEL = 'Facebook';

const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'publish_video',
  'business_management', // necesario para que /me/accounts liste Páginas que están dentro de un portfolio de negocio
];
const FB_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff']);
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613]);

/* ------------------------------ errores ------------------------------ */

/** Convierte un error genérico de fetchJson en un ProviderError con códigos de Meta. */
function classify(e) {
  if (!(e instanceof ProviderError)) return e;
  const err = e.raw && typeof e.raw === 'object' ? (e.raw.error && typeof e.raw.error === 'object' ? e.raw.error : null) : null;
  if (!err) return e;
  const code = Number(err.code || 0);
  const msg = err.error_user_msg || err.message || e.message;
  const auth = code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300);
  const retryable = RETRYABLE_CODES.has(code) || err.is_transient === true || (e.status ?? 0) >= 500 || e.status === 429;
  const rateLimited = [4, 17, 32, 613].includes(code) || e.status === 429;
  let text;
  if (code === 190 || code === 102) text = 'Tu token de Facebook ha caducado: reconecta la cuenta en Redes.';
  else if (code === 368) text = 'Facebook ha bloqueado temporalmente que publiques desde esta Página (lo trata como posible spam). Espera unas horas y vuelve a intentarlo, o publícalo a mano.';
  else if (code === 100 && /duplicate|already/i.test(msg)) text = 'Facebook dice que este contenido ya se publicó antes. Cambia un poco el texto o la imagen.';
  else if (auth) text = `Facebook dice que falta un permiso (${msg}). Reconecta la cuenta en Redes y acepta todos los permisos.`;
  else if ([4, 17, 32, 613].includes(code)) text = 'Facebook ha limitado temporalmente las peticiones. Lo reintentaremos más tarde.';
  else text = `Facebook ha rechazado la petición: ${msg}`;
  const out = new ProviderError(text, { auth, retryable: retryable && code !== 368, status: e.status, raw: e.raw, rateLimited });
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

/* ------------------------------ helpers Graph ------------------------------ */

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();

function graphGet(path, token, params = {}) {
  return call(`${GRAPH}/${path}?${qs({ ...params, access_token: token })}`, { method: 'GET' });
}

function graphPostForm(path, token, fields = {}) {
  const form = { access_token: token };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form[k] = String(v);
  return call(`${GRAPH}/${path}`, { method: 'POST', form });
}

async function graphPostFile(path, token, fields, fileField, item, mime) {
  const fd = new FormData();
  fd.append('access_token', token);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
  const blob = await fs.openAsBlob(item.path, { type: mime || item.mime || 'application/octet-stream' });
  fd.append(fileField, blob, item.original_name || 'archivo');
  return call(`${GRAPH}/${path}`, { method: 'POST', body: fd });
}

async function ruploadFile(url, token, item) {
  const size = (await fs.promises.stat(item.path)).size;
  const blob = await fs.openAsBlob(item.path, { type: 'application/octet-stream' });
  return call(url, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(size), 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
}

async function prepImage(item, ctx) {
  let it = item;
  if (!FB_IMAGE_MIMES.has(item.mime) && ctx?.toJpeg) {
    const j = await ctx.toJpeg(item);
    it = { ...item, path: j.path, mime: j.mime };
  }
  // Facebook admite fotos de hasta 10 MB.
  return fitImage(it, { maxBytes: MAX_IMAGE_BYTES.facebook, label: 'Facebook', log: ctx?.log });
}

function absUrl(u, fallback) {
  if (!u) return fallback;
  return u.startsWith('/') ? `https://www.facebook.com${u}` : u;
}

async function permalinkOf(id, token, fallback) {
  try {
    const r = await graphGet(id, token, { fields: 'permalink_url' });
    return absUrl(r.permalink_url, fallback);
  } catch {
    return fallback;
  }
}

/** Estado de un vídeo/reel subido: devuelve el objeto `status`. */
async function videoStatus(videoId, token) {
  const r = await graphGet(videoId, token, { fields: 'status' });
  return r.status || {};
}

function phaseError(s) {
  for (const k of ['uploading_phase', 'processing_phase', 'publishing_phase']) {
    if (s?.[k]?.status === 'error') {
      const detail = s[k].errors?.[0]?.message || s[k].error?.message || '';
      return `Facebook no ha podido procesar el vídeo${detail ? `: ${detail}` : '. Comprueba que es vertical (9:16), de 3 a 90 s, MP4 con H.264 y audio AAC.'}`;
    }
  }
  if (s?.video_status === 'error') return 'Facebook no ha podido procesar el vídeo. Comprueba que es vertical (9:16), de 3 a 90 s, MP4 con H.264 y audio AAC.';
  if (s?.video_status === 'upload_failed') return 'La subida del vídeo a Facebook ha fallado. Inténtalo de nuevo.';
  if (s?.video_status === 'expired') return 'Facebook ha descartado el vídeo antes de publicarlo. Inténtalo de nuevo.';
  return null;
}

/** Marca un error de story como "publícala a mano" (el core hace el fallback a manual). */
function storyFallback(e) {
  if (!(e instanceof ProviderError)) return e;
  if (e.retryable || (e.auth && e.code === 190)) return e;
  const out = new ProviderError(
    'Facebook no permite publicar esta story por API (o no hay permiso): publica esta story a mano desde la app de Facebook o Meta Business Suite.',
    { raw: e.raw, status: e.status },
  );
  out.manual = true;
  out.cause = e;
  return out;
}

/* ------------------------------ publicación ------------------------------ */

async function publishText({ pageId, token, caption, options }) {
  const r = await graphPostForm(`${pageId}/feed`, token, { message: caption || '', link: options?.link }).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
  const id = r.id;
  return { external_id: id, url: await permalinkOf(id, token, `https://www.facebook.com/${id}`) };
}

async function publishPhoto({ pageId, token, caption, item, ctx }) {
  const it = await prepImage(item, ctx);
  const r = await graphPostFile(`${pageId}/photos`, token, { caption: caption || undefined, published: 'true' }, 'source', it, it.mime).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
  const id = r.post_id || r.id;
  return { external_id: id, url: await permalinkOf(id, token, `https://www.facebook.com/${id}`) };
}

async function publishVideoPost({ pageId, token, caption, item }) {
  const r = await graphPostFile(`${pageId}/videos`, token, { description: caption || undefined }, 'source', item, item.mime).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
  return { external_id: r.id, url: `https://www.facebook.com/watch/?v=${r.id}` };
}

async function publishCarousel({ pageId, token, caption, items, ctx }) {
  const ids = [];
  for (const item of items) {
    const it = await prepImage(item, ctx);
    const r = await graphPostFile(`${pageId}/photos`, token, { published: 'false' }, 'source', it, it.mime);
    ids.push(r.id);
    ctx?.log?.(`Facebook: foto subida (${ids.length}/${items.length})`);
  }
  const fields = { message: caption || '' };
  ids.forEach((id, i) => { fields[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
  const r = await graphPostForm(`${pageId}/feed`, token, fields).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
  return { external_id: r.id, url: await permalinkOf(r.id, token, `https://www.facebook.com/${r.id}`) };
}

async function publishReel({ pageId, token, caption, item, options, ctx }) {
  const start = await graphPostForm(`${pageId}/video_reels`, token, { upload_phase: 'start' });
  const videoId = start.video_id;
  if (!videoId) throw new ProviderError('Facebook no ha iniciado la subida del Reel. Inténtalo de nuevo.', { retryable: true, raw: start });
  ctx?.log?.('Facebook: subiendo el Reel…');
  await ruploadFile(start.upload_url || `${RUPLOAD}/${videoId}`, token, item);
  await graphPostForm(`${pageId}/video_reels`, token, {
    video_id: videoId,
    upload_phase: 'finish',
    video_state: 'PUBLISHED',
    description: caption || undefined,
    title: options?.title,
  }).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
  // A partir de aquí el Reel ya está enviado a publicar: no reintentar nunca (duplicaría).
  try {
    await waitFor(async () => {
      const s = await videoStatus(videoId, token);
      const err = phaseError(s);
      if (err) throw new ProviderError(err);
      return s.publishing_phase?.status === 'complete' || s.video_status === 'published' ? s : false;
    }, { interval: ctx?.pollMs ?? 5000, timeout: 240000, label: 'a que Facebook publique el Reel' });
  } catch (e) {
    if (e instanceof ProviderError && e.retryable) ctx?.log?.('Facebook: el Reel sigue procesándose; lo damos por enviado.');
    else throw e;
  }
  return { external_id: videoId, url: `https://www.facebook.com/reel/${videoId}` };
}

async function publishStory({ pageId, token, item, ctx }) {
  try {
    if (item.kind === 'video') {
      const start = await graphPostForm(`${pageId}/video_stories`, token, { upload_phase: 'start' });
      const videoId = start.video_id;
      await ruploadFile(start.upload_url || `${RUPLOAD}/${videoId}`, token, item);
      try {
        await waitFor(async () => {
          const s = await videoStatus(videoId, token);
          const err = phaseError(s);
          if (err) throw new ProviderError(err);
          return s.uploading_phase?.status === 'complete' || s.video_status === 'ready' ? s : false;
        }, { interval: ctx?.pollMs ?? 5000, timeout: 90000, label: 'la subida de la story' });
      } catch (e) {
        if (!(e instanceof ProviderError && e.retryable)) throw e;
      }
      const r = await graphPostForm(`${pageId}/video_stories`, token, { video_id: videoId, upload_phase: 'finish' }).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
      return { external_id: r.post_id || videoId, url: `https://www.facebook.com/${pageId}` };
    }
    const it = await prepImage(item, ctx);
    const up = await graphPostFile(`${pageId}/photos`, token, { published: 'false' }, 'source', it, it.mime);
    const r = await graphPostForm(`${pageId}/photo_stories`, token, { photo_id: up.id }).catch((e) => { throw ambiguousPublish(e, 'Facebook'); });
    return { external_id: r.post_id || up.id, url: `https://www.facebook.com/${pageId}` };
  } catch (e) {
    throw storyFallback(e);
  }
}

/* ------------------------------ proveedor ------------------------------ */

export default {
  id: 'facebook',
  label: 'Facebook',
  color: '#1877F2',
  family: 'meta',
  authType: 'oauth',
  redirect: 'relay',
  supports: { post: true, carousel: true, reel: true, story: true, textOnly: true },
  limits: { captionMax: 63206, carouselMax: 10, videoMaxSec: 90 },
  needsApproval: null,
  notes:
    'Publica en Páginas de Facebook de las que eres administrador. Para que el público vea las publicaciones, la app de Meta debe estar en modo Live. Las stories se intentan por API; si Facebook las rechaza, pasan a modo manual.',

  getAuthUrl({ creds, redirectUri, state }) {
    const scopes = creds?.extra?.scopes
      ? String(creds.extra.scopes).split(/[\s,]+/).filter(Boolean)
      : DEFAULT_SCOPES;
    const p = new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
    });
    if (creds?.extra?.config_id) {
      // Opcional: apps con "Facebook Login for Business" usan una configuración en vez de scope.
      p.set('config_id', String(creds.extra.config_id));
      p.set('override_default_response_type', 'true');
    } else {
      p.set('scope', scopes.join(','));
    }
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${p}`;
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const cleanCode = String(code).replace(/#_(=_)?$/, '');
    // 1) code → token de usuario corto
    const short = await call(`${GRAPH}/oauth/access_token?${qs({
      client_id: creds.client_id, client_secret: creds.client_secret, redirect_uri: redirectUri, code: cleanCode,
    })}`, { method: 'GET' }).catch((e) => { throw oauthExchangeError('Facebook', e, { appName: 'tu app de Meta' }); });
    // 2) corto → largo (~60 días)
    const long = await call(`${GRAPH}/oauth/access_token?${qs({
      grant_type: 'fb_exchange_token', client_id: creds.client_id, client_secret: creds.client_secret, fb_exchange_token: short.access_token,
    })}`, { method: 'GET' });
    const userToken = long.access_token || short.access_token;
    const userExpires = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null;

    // 3) Páginas del usuario (cada una trae su propio Page access token)
    const pages = [];
    let url = `${GRAPH}/me/accounts?${qs({
      fields: 'id,name,username,access_token,tasks,category,picture.type(large){url}',
      limit: 100,
      access_token: userToken,
    })}`;
    for (let i = 0; i < 5 && url; i++) {
      const r = await call(url, { method: 'GET' });
      pages.push(...(r.data || []));
      url = r.paging?.next || null;
    }
    const usable = pages.filter((p) => p.access_token && (!Array.isArray(p.tasks) || p.tasks.length === 0 || p.tasks.includes('CREATE_CONTENT')));
    if (pages.length && !usable.length) {
      throw new ProviderError(
        'Tu usuario de Facebook ve tus Páginas pero no puede publicar en ninguna: necesita el rol de Administrador (o Editor con permiso para crear contenido) en la Página. Pídele al administrador que te lo dé y vuelve a conectar.',
        { raw: pages.map((p) => ({ id: p.id, tasks: p.tasks })) },
      );
    }
    if (!usable.length) {
      throw new ProviderError(
        'No hemos encontrado ninguna Página de Facebook que puedas administrar con esta cuenta. Comprueba que eres administrador de la Página, que al conectar marcaste la Página en la ventana de permisos y que en tu app has añadido el permiso business_management (si tu Página está dentro de un portfolio de negocio).',
        { raw: pages },
      );
    }
    return usable.map((p) => ({
      external_id: String(p.id),
      name: p.name,
      username: p.username || null,
      avatar_url: p.picture?.data?.url || null,
      access_token: p.access_token,
      refresh_token: null,
      token_expires_at: null, // los Page tokens derivados de un token largo no caducan
      meta: { category: p.category || null, tasks: p.tasks || [], user_token_expires_at: userExpires },
    }));
  },

  // Los Page tokens no se renuevan: si dejan de valer hay que reconectar.
  async refresh() {
    return null;
  },

  validate({ type, caption, media = [], options = {} }) {
    const errs = [];
    const images = media.filter((m) => m.kind === 'image');
    const videos = media.filter((m) => m.kind === 'video');
    if (caption && caption.length > 63206) errs.push('El texto es demasiado largo para Facebook (máx. 63.206 caracteres).');
    if (type === 'post') {
      if (media.length === 0 && !caption && !options.link) errs.push('Escribe un texto o añade una imagen para publicar en Facebook.');
      if (videos.length > 1 || (videos.length && images.length)) errs.push('Un post de Facebook admite un vídeo o varias fotos, no mezclas.');
      if (images.length > 10) errs.push('Facebook: máximo 10 fotos por publicación.');
    } else if (type === 'carousel') {
      if (images.length < 2 || videos.length) errs.push('Un carrusel de Facebook necesita entre 2 y 10 fotos (sin vídeos).');
      if (images.length > 10) errs.push('Facebook: máximo 10 fotos por carrusel.');
    } else if (type === 'reel') {
      if (videos.length !== 1 || media.length !== 1) errs.push('Un Reel de Facebook necesita exactamente 1 vídeo (vertical, de 3 a 90 s).');
      errs.push(...durationErrors(videos[0], { min: 3, max: 90, label: 'los Reels de Facebook' }));
    } else if (type === 'story') {
      if (media.length !== 1) errs.push('Una story necesita exactamente 1 imagen o vídeo.');
      errs.push(...durationErrors(videos[0], { min: 3, max: 60, label: 'las stories de Facebook' }));
    }
    return errs;
  },

  async publish({ account, type, caption, media = [], options = {}, ctx = {} }) {
    const pageId = account.external_id;
    const token = account.access_token;
    if (!token) throw new ProviderError('Tu token de Facebook ha caducado: reconecta la cuenta en Redes.', { auth: true });
    const images = media.filter((m) => m.kind === 'image');

    if (type === 'reel') return publishReel({ pageId, token, caption, item: media[0], options, ctx });
    if (type === 'story') return publishStory({ pageId, token, item: media[0], ctx });
    if (type === 'carousel') return publishCarousel({ pageId, token, caption, items: images, ctx });

    // type === 'post'
    if (media.length === 0) return publishText({ pageId, token, caption, options });
    if (media[0].kind === 'video') return publishVideoPost({ pageId, token, caption, item: media[0] });
    if (images.length > 1) return publishCarousel({ pageId, token, caption, items: images, ctx });
    return publishPhoto({ pageId, token, caption, item: images[0], ctx });
  },
};
