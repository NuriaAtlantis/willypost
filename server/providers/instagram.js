// Instagram — dos variantes:
//  a) "Instagram API with Instagram Login" (graph.instagram.com, sin Página de Facebook). La de siempre: carné
//     propio y modo central cuando /config trae la familia 'instagram'.
//  b) "Instagram API with Facebook Login" (graph.facebook.com), SOLO en modo central cuando /config no trae
//     'instagram' pero 'meta' trae ig_config_id (creds.via === 'facebook'): Meta ya no deja que las apps nuevas
//     usen el Inicio de sesión con Instagram. Se entra con Facebook Login for Business (configuración propia de
//     Instagram), se canjea por el broker con la familia 'meta', y la cuenta guarda el Page access token de la
//     Página vinculada (no caduca) y meta.via = 'facebook'. Publicar usa los mismos endpoints en graph.facebook.com.
// family 'instagram', redirect 'relay'.
//
// Documentación consultada (nov-2026):
//  - Content Publishing (hosts: graph.facebook.com con Facebook Login + Page access token; graph.instagram.com con
//    Instagram Login): https://developers.facebook.com/docs/instagram-platform/content-publishing
//  - Business Login (authorize, access_token, ig_exchange_token, ig_refresh_token):
//      https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
//  - Content Publishing (contenedores, status_code, media_publish, límites):
//      https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
//  - Get started (campos de /me: user_id, username, profile_picture_url, account_type):
//      https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started
//  - Versiones Graph API (v26.0): https://developers.facebook.com/docs/graph-api/changelog/versions
//  - Especificaciones (ig-user/media): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
//    Reel: MP4/MOV H.264/HEVC, 3 s-15 min, <=300 MB, 23-60 fps. Story vídeo: 3-60 s, <=100 MB. Imagen: JPEG <=8 MB, 4:5 a 1,91:1.
//    Carrusel: hasta 20 elementos (verificado nov-2026; antes eran 10). Límite 100 publicaciones/24 h y 400 contenedores/24 h.
// Sin verificar en docs oficiales: campo `permalink` de IG Media (conocimiento previo, estable), códigos de
// error_subcode concretos (2207xxx) usados solo para dar mensajes más claros.
import { ProviderError, fetchJson, waitFor, sleep, ambiguousPublish, oauthExchangeError } from './_http.js';
import { fitImage, checkVideoSize, durationErrors, MAX_IMAGE_BYTES } from './_media.js';
import { centralFetchJson, centralCredsFor } from '../central.js';
import { GRAPH_VERSION } from './facebook.js';

export const IG_VERSION = 'v26.0';
const IG = `https://graph.instagram.com/${IG_VERSION}`;
const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`; // variante "a través de Facebook"
const IG_UNVERSIONED = 'https://graph.instagram.com'; // access_token y refresh_access_token van sin versión en la doc
const LABEL = 'Instagram';
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613]);
const DAY = 24 * 3600 * 1000;
const TOKEN_LIFETIME_MS = 60 * DAY;

const MAX_CAROUSEL = 20;
const REEL_MAX_BYTES = 300 * 1024 * 1024;
const STORY_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const SUBCODE_MESSAGES = {
  2207010: 'El texto es demasiado largo para Instagram.',
  2207020: 'El archivo caducó antes de publicarse. Inténtalo de nuevo.',
  2207042: 'Has llegado al límite diario de publicaciones de Instagram. Inténtalo mañana.',
  36003: 'La proporción de la imagen no es válida (Instagram admite de 4:5 a 1,91:1).',
  2207009: 'La proporción de la imagen no es válida (Instagram admite de 4:5 a 1,91:1).',
  2207004: 'La imagen pesa demasiado (máx. 8 MB).',
  2207005: 'Formato de imagen no admitido (Instagram solo admite JPEG).',
  2207026: 'Formato de vídeo no admitido (usa MP4/MOV con H.264 y audio AAC).',
  2207003: 'Instagram no pudo descargar el archivo a tiempo (revisa tu conexión y que el túnel esté activo).',
  2207052: 'Instagram no pudo descargar el archivo (revisa tu conexión y que el túnel esté activo).',
};

/* ------------------------------ errores ------------------------------ */

function classify(e) {
  if (!(e instanceof ProviderError)) return e;
  const body = e.raw && typeof e.raw === 'object' ? e.raw : null;
  if (!body) return e;
  // Errores de api.instagram.com: { error_type, code, error_message }
  if (!body.error && body.error_message) {
    return new ProviderError(`Instagram ha rechazado la petición: ${body.error_message}`, {
      retryable: (e.status ?? 0) >= 500,
      status: e.status,
      raw: body,
    });
  }
  const err = body.error && typeof body.error === 'object' ? body.error : null;
  if (!err) return e;
  const code = Number(err.code || 0);
  const sub = Number(err.error_subcode || 0);
  const msg = err.error_user_msg || err.message || e.message;
  const auth = code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300);
  const retryable = RETRYABLE_CODES.has(code) || err.is_transient === true || (e.status ?? 0) >= 500 || e.status === 429;
  const rateLimited = [4, 17, 32, 613].includes(code) || e.status === 429;
  let text;
  if (code === 190 || code === 102) text = 'Tu token de Instagram ha caducado: reconecta la cuenta en Redes.';
  else if (auth) text = `Instagram dice que falta un permiso (${msg}). Reconecta la cuenta en Redes y acepta todos los permisos.`;
  else if ([4, 17, 32, 613].includes(code)) text = 'Instagram ha limitado temporalmente las peticiones. Lo reintentaremos más tarde.';
  else if (SUBCODE_MESSAGES[sub]) text = `${SUBCODE_MESSAGES[sub]} (${msg})`;
  else text = `Instagram ha rechazado la petición: ${msg}`;
  const out = new ProviderError(text, { auth, retryable, status: e.status, raw: body, rateLimited });
  out.code = code;
  out.subcode = sub;
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
// family: 'instagram' (Inicio de sesión con Instagram) o 'meta' (Instagram a través de Facebook).
async function centralCall(op, body, family = 'instagram') {
  try {
    return await centralFetchJson(family, op, body, { label: LABEL });
  } catch (e) {
    throw e.central ? e : classify(e);
  }
}

const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();

/** Cliente Graph para una base (graph.instagram.com o graph.facebook.com) y un token. */
function graph(base, token) {
  return {
    get: (path, params = {}) => call(`${base}/${path}?${qs({ ...params, access_token: token })}`, { method: 'GET' }),
    post: (path, fields = {}) => {
      const form = { access_token: token };
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form[k] = String(v);
      return call(`${base}/${path}`, { method: 'POST', form });
    },
  };
}
const get = (path, token, params = {}) => graph(IG, token).get(path, params);

const viaFacebook = (account) => account?.meta?.via === 'facebook';
/** Cuentas "a través de Facebook" publican en graph.facebook.com con el Page token; las demás, en graph.instagram.com. */
const apiFor = (account) => graph(viaFacebook(account) ? FB_GRAPH : IG, account.access_token);

/* ------------------------------ medios y contenedores ------------------------------ */

const hashtags = (t = '') => (t.match(/#[\p{L}\p{N}_]+/gu) || []).length;

/** URL https pública de una imagen (siempre JPEG) o vídeo. */
async function publicMediaUrl(item, ctx) {
  if (item.kind === 'image') {
    if (item.mime !== 'image/jpeg') ctx?.log?.('Instagram solo admite JPEG: lo convertimos automáticamente');
    const j = await ctx.toJpeg(item);
    const fitted = await fitImage({ ...item, path: j.path, mime: j.mime }, { maxBytes: MAX_IMAGE_BYTES.instagram, label: 'Instagram', log: ctx?.log });
    return ctx.publicUrl(fitted);
  }
  return ctx.publicUrl(item);
}

/** Mensaje claro para un contenedor en ERROR: el campo `status` suele traer "Error: ... error code 2207026". */
function containerErrorText(r, label) {
  const raw = String(r.status || '');
  const sub = Number((raw.match(/\b(22070\d\d|36\d{3})\b/) || [])[1] || 0);
  const known = SUBCODE_MESSAGES[sub];
  return `Instagram no ha podido procesar ${label}${known ? `: ${known}` : raw ? `: ${raw}` : ''}. Revisa formato, tamaño y proporción.`;
}

async function waitContainer(id, api, ctx, label) {
  return waitFor(async () => {
    const r = await api.get(id, { fields: 'status_code,status' });
    if (r.status_code === 'FINISHED') return r;
    if (r.status_code === 'ERROR') {
      throw new ProviderError(containerErrorText(r, label), { raw: r });
    }
    if (r.status_code === 'EXPIRED') {
      throw new ProviderError('El archivo caducó antes de publicarse. Inténtalo de nuevo.', { retryable: true, raw: r });
    }
    return false;
  }, { interval: ctx?.pollMs ?? 5000, timeout: ctx?.pollMs ? 300000 : 600000, label: `a que Instagram procese ${label}` });
}

async function createAndWait(igId, api, fields, ctx, label) {
  const c = await api.post(`${igId}/media`, fields);
  await waitContainer(c.id, api, ctx, label);
  return c.id;
}

/** media_publish con reintentos si el contenedor aún "no está listo" (código 9007 / subcode 2207027). */
async function publishContainer(igId, api, creationId, ctx) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.post(`${igId}/media_publish`, { creation_id: creationId });
    } catch (e) {
      const notReady = e instanceof ProviderError && (e.code === 9007 || e.subcode === 2207027);
      if (!notReady || attempt >= 4) throw e;
      await (ctx?.sleep ? ctx.sleep(ctx.pollMs ?? 5000) : sleep(ctx?.pollMs ?? 5000));
    }
  }
}

async function finish(igId, api, account, creationId, ctx) {
  const pub = await publishContainer(igId, api, creationId, ctx).catch((e) => { throw ambiguousPublish(e, 'Instagram'); });
  let url = account.meta?.username ? `https://www.instagram.com/${account.meta.username}/` : 'https://www.instagram.com/';
  try {
    const r = await api.get(pub.id, { fields: 'permalink' });
    if (r.permalink) url = r.permalink;
  } catch { /* el permalink es opcional */ }
  return { external_id: pub.id, url };
}

function sizeProblem(item) {
  if (!item.width || !item.height) return null;
  const ratio = item.width / item.height;
  return ratio < 0.79 || ratio > 1.92;
}

/* ------------------------------ a través de Facebook ------------------------------ */

const CENTRAL_NOTES_IG =
  'Requiere cuenta profesional (Empresa o Creador). Las imágenes se convierten a JPEG automáticamente y se publican a través de un enlace temporal.';
const CENTRAL_NOTES_FB =
  'Requiere cuenta profesional de Instagram (Empresa o Creador) vinculada a una Página de Facebook que administres. Se conecta entrando con Facebook: en la ventana de permisos marca tu cuenta de Instagram y su Página. Las imágenes se convierten a JPEG automáticamente y se publican a través de un enlace temporal.';

const NO_IG_LINKED =
  'No hemos encontrado ninguna cuenta de Instagram que puedas usar. Para conectar Instagram a través de Facebook: ' +
  '1) tu cuenta de Instagram tiene que ser profesional (Empresa o Creador; se cambia en Instagram > Ajustes > Tipo de cuenta); ' +
  '2) tiene que estar vinculada a una Página de Facebook que administres (en la Página: Configuración > Cuentas vinculadas > Instagram); ' +
  '3) al conectar, en la ventana de permisos de Facebook marca tu cuenta de Instagram Y la Página. Después vuelve a pulsar Conectar.';

/** code → token largo de usuario (por el broker, familia 'meta') → Páginas con cuenta de Instagram profesional vinculada. */
async function exchangeViaFacebook({ redirectUri, code }) {
  const cleanCode = String(code).replace(/#_(=_)?$/, '');
  const short = await centralCall('code', { code: cleanCode, redirect_uri: redirectUri }, 'meta')
    .catch((e) => { throw oauthExchangeError('Instagram', e, { central: true }); });
  if (!short?.access_token) throw new ProviderError('Facebook no ha devuelto un token. Vuelve a conectar la cuenta de Instagram.', { raw: short });
  const long = await centralCall('long_lived', { access_token: short.access_token }, 'meta');
  const userToken = long?.access_token || short.access_token;
  const userExpires = long?.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null;

  const pages = [];
  let url = `${FB_GRAPH}/me/accounts?${qs({
    fields: 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
    limit: 100,
    access_token: userToken,
  })}`;
  for (let i = 0; i < 5 && url; i++) {
    const r = await call(url, { method: 'GET' });
    pages.push(...(r.data || []));
    url = r.paging?.next || null;
  }
  const seen = new Set();
  const out = [];
  for (const p of pages) {
    const ig = p.instagram_business_account;
    if (!ig?.id || !p.access_token || seen.has(String(ig.id))) continue;
    seen.add(String(ig.id));
    out.push({
      external_id: String(ig.id),
      name: ig.name || ig.username || p.name,
      username: ig.username || null,
      avatar_url: ig.profile_picture_url || null,
      // Page access token: el que pide la API de Instagram con Facebook Login. Derivado de un token largo, no caduca.
      access_token: p.access_token,
      refresh_token: null,
      token_expires_at: null,
      meta: { via: 'facebook', page_id: String(p.id), page_name: p.name || null, username: ig.username || null, user_token_expires_at: userExpires },
    });
  }
  if (!out.length) throw new ProviderError(NO_IG_LINKED, { raw: pages.map((p) => ({ id: p.id, ig: !!p.instagram_business_account })) });
  return out;
}

/* ------------------------------ proveedor ------------------------------ */

export default {
  id: 'instagram',
  label: 'Instagram',
  color: '#E1306C',
  family: 'instagram',
  authType: 'oauth',
  redirect: 'relay',
  supports: { post: true, carousel: true, reel: true, story: true, textOnly: false },
  limits: { captionMax: 2200, carouselMax: MAX_CAROUSEL, videoMaxSec: 900 },
  needsApproval: null,
  notes:
    'Requiere cuenta profesional (Empresa o Creador) y haberte añadido como probador de Instagram en tu app de Meta. Las imágenes se convierten a JPEG automáticamente y se publican a través de un enlace temporal.',
  // En modo central, el texto depende de cómo conecta la app de WillyPost (Instagram directo o a través de Facebook).
  get centralNotes() {
    return centralCredsFor('instagram')?.via === 'facebook' ? CENTRAL_NOTES_FB : CENTRAL_NOTES_IG;
  },

  getAuthUrl({ creds, redirectUri, state }) {
    if (creds?.via === 'facebook') {
      // Instagram a través de Facebook Login for Business: la configuración (config_id) define los permisos.
      const p = new URLSearchParams({
        client_id: creds.client_id,
        redirect_uri: redirectUri,
        state,
        response_type: 'code',
        config_id: String(creds.extra?.config_id || ''),
        override_default_response_type: 'true',
      });
      return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${p}`;
    }
    const p = new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(','),
      state,
      force_reauth: 'true',
    });
    return `https://www.instagram.com/oauth/authorize?${p}`;
  },

  async exchangeCode({ creds, redirectUri, code }) {
    if (creds?.via === 'facebook') return exchangeViaFacebook({ redirectUri, code });
    const cleanCode = String(code).replace(/#_$/, '');
    // 1) code → token corto (1 h)
    const r1 = await (creds.central
      ? centralCall('code', { code: cleanCode, redirect_uri: redirectUri })
      : call('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        form: {
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: cleanCode,
        },
      })
    ).catch((e) => { throw oauthExchangeError('Instagram', e, { appName: 'tu app de Instagram (no uses los de Facebook)', central: creds.central }); });
    const short = Array.isArray(r1.data) ? r1.data[0] : r1;
    if (!short?.access_token) throw new ProviderError('Instagram no ha devuelto un token. Vuelve a conectar la cuenta.', { raw: r1 });
    // 2) corto → largo (60 días)
    const r2 = await (creds.central
      ? centralCall('long_lived', { access_token: short.access_token })
      : call(`${IG_UNVERSIONED}/access_token?${qs({
        grant_type: 'ig_exchange_token', client_secret: creds.client_secret, access_token: short.access_token,
      })}`, { method: 'GET' }));
    const token = r2.access_token;
    const expiresAt = r2.expires_in ? new Date(Date.now() + Number(r2.expires_in) * 1000).toISOString() : new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
    // 3) perfil
    const me = await get('me', token, { fields: 'user_id,username,name,profile_picture_url,account_type' });
    if (/^PERSONAL$/i.test(String(me.account_type || ''))) {
      throw new ProviderError('Esta cuenta de Instagram es personal. Cámbiala a cuenta profesional (Empresa o Creador) en Instagram > Ajustes > Tipo de cuenta, y vuelve a conectar.');
    }
    const igId = String(me.user_id || short.user_id || me.id);
    return [{
      external_id: igId,
      name: me.name || me.username,
      username: me.username || null,
      avatar_url: me.profile_picture_url || null,
      access_token: token,
      refresh_token: null,
      token_expires_at: expiresAt,
      meta: { username: me.username || null, account_type: me.account_type || null, permissions: short.permissions || null },
    }];
  },

  /** Renueva el token largo (válido si tiene >24 h y no ha caducado). Devuelve null si aún no toca. */
  async refresh({ account }) {
    // A través de Facebook: el Page token no caduca y no existe ig_refresh_token (se reconecta cada 30 días igual).
    if (viaFacebook(account)) return null;
    const exp = account.token_expires_at ? Date.parse(account.token_expires_at) : null;
    if (exp) {
      if (exp <= Date.now()) {
        throw new ProviderError('Tu token de Instagram ha caducado: reconecta la cuenta en Redes.', { auth: true });
      }
      if (Date.now() - (exp - TOKEN_LIFETIME_MS) < DAY) return null; // tiene menos de 24 h
    }
    const r = await call(`${IG_UNVERSIONED}/refresh_access_token?${qs({
      grant_type: 'ig_refresh_token', access_token: account.access_token,
    })}`, { method: 'GET' });
    return {
      access_token: r.access_token,
      token_expires_at: r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() : new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
    };
  },

  validate({ type, caption, media = [] }) {
    const errs = [];
    const images = media.filter((m) => m.kind === 'image');
    const videos = media.filter((m) => m.kind === 'video');
    if (caption && caption.length > 2200) errs.push('El texto de Instagram admite como máximo 2.200 caracteres.');
    if (hashtags(caption) > 30) errs.push('Instagram admite como máximo 30 hashtags por publicación.');
    if (type === 'post') {
      if (media.length !== 1) errs.push('Instagram necesita una imagen (o un vídeo) para publicar; no admite posts solo de texto.');
    } else if (type === 'carousel') {
      if (media.length < 2 || media.length > MAX_CAROUSEL) errs.push(`Un carrusel de Instagram necesita entre 2 y ${MAX_CAROUSEL} imágenes o vídeos.`);
    } else if (type === 'reel') {
      if (videos.length !== 1 || media.length !== 1) errs.push('Un Reel necesita exactamente 1 vídeo.');
    } else if (type === 'story') {
      if (media.length !== 1) errs.push('Una story de Instagram necesita exactamente 1 imagen o vídeo.');
    }
    if (type === 'reel' || (type === 'post' && videos.length)) videos.forEach((v) => errs.push(...durationErrors(v, { min: 3, max: 900, label: 'los Reels de Instagram' })));
    if (type === 'story') videos.forEach((v) => errs.push(...durationErrors(v, { min: 3, max: 60, label: 'las stories de Instagram' })));
    if ((type === 'post' || type === 'carousel') && images.some(sizeProblem)) {
      errs.push('Instagram solo admite imágenes con proporción entre 4:5 (vertical) y 1,91:1 (horizontal). Recorta la imagen.');
    }
    return errs;
  },

  async publish({ account, type, caption, media = [], options = {}, ctx = {} }) {
    const igId = account.external_id;
    const token = account.access_token;
    if (!token) throw new ProviderError('Tu token de Instagram ha caducado: reconecta la cuenta en Redes.', { auth: true });
    if (!ctx.publicUrl) throw new ProviderError('Instagram necesita un enlace público temporal y no está disponible. Reinicia WillyPost.', { retryable: true });
    const api = apiFor(account); // graph.facebook.com (a través de Facebook) o graph.instagram.com

    // Tamaño máximo de los vídeos (Reel 300 MB, story 100 MB), antes de gastar tiempo en subirlos.
    for (const v of media.filter((m) => m.kind === 'video')) {
      await checkVideoSize(v, { maxBytes: type === 'story' ? STORY_VIDEO_MAX_BYTES : REEL_MAX_BYTES, label: type === 'story' ? 'las stories de Instagram' : 'Instagram' });
    }

    if (type === 'carousel') {
      const children = [];
      for (const [i, item] of media.entries()) {
        const url = await publicMediaUrl(item, ctx);
        const fields = item.kind === 'video'
          ? { media_type: 'VIDEO', video_url: url, is_carousel_item: 'true' }
          : { image_url: url, is_carousel_item: 'true' };
        children.push(await createAndWait(igId, api, fields, ctx, `el elemento ${i + 1} del carrusel`));
        ctx.log?.(`Instagram: elemento ${i + 1}/${media.length} listo`);
      }
      const parent = await createAndWait(igId, api, {
        media_type: 'CAROUSEL', children: children.join(','), caption: caption || undefined,
      }, ctx, 'el carrusel');
      return finish(igId, api, account, parent, ctx);
    }

    const item = media[0];
    const url = await publicMediaUrl(item, ctx);
    let fields;
    let label;
    if (type === 'story') {
      fields = item.kind === 'video' ? { media_type: 'STORIES', video_url: url } : { media_type: 'STORIES', image_url: url };
      label = 'la story';
    } else if (type === 'reel' || item.kind === 'video') {
      // Los vídeos de feed se publican hoy como Reels (media_type=VIDEO está en desuso para el feed).
      fields = {
        media_type: 'REELS', video_url: url, caption: caption || undefined,
        share_to_feed: options.share_to_feed === false ? 'false' : 'true',
      };
      label = 'el Reel';
    } else {
      fields = { image_url: url, caption: caption || undefined, alt_text: options.alt_text };
      label = 'la imagen';
    }
    const id = await createAndWait(igId, api, fields, ctx, label);
    return finish(igId, api, account, id, ctx);
  },
};
