// Reglas obligatorias de TikTok y YouTube para publicar desde una app de terceros.
//
//  - TikTok, Content Sharing Guidelines (Direct Post):
//    https://developers.tiktok.com/doc/content-sharing-guidelines
//    · Privacidad elegida a mano entre las que permite el creador (creator_info), SIN valor por defecto.
//    · Comentarios / Dúo / Stitch desactivados por defecto (el alumno los activa); Dúo y Stitch no existen en fotos.
//    · Divulgación de contenido comercial: interruptor apagado por defecto; si se enciende hay que marcar
//      «Tu marca», «Contenido de marca» o las dos; el contenido de marca no puede ser «Solo yo».
//  - YouTube, Required Minimum Functionality (subidas):
//    https://developers.google.com/youtube/terms/required-minimum-functionality
//    · Título y descripción los pone el usuario; privacidad pública / no listada / privada a elegir.
//
// Este módulo es puro (sin red): lo usan savePost (al programar/aprobar) y las pruebas.

export const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
export const TIKTOK_PRIVACY_LABEL = {
  PUBLIC_TO_EVERYONE: 'Todo el mundo',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (seguidores a los que tú también sigues)',
  FOLLOWER_OF_CREATOR: 'Tus seguidores',
  SELF_ONLY: 'Solo yo',
};
export const YOUTUBE_PRIVACY = ['public', 'unlisted', 'private'];

/** Opciones de TikTok que SOLO puede elegir la persona (nunca Claude ni un valor por defecto). */
export const TIKTOK_HUMAN_KEYS = [
  'tiktok_privacy', 'allow_comment', 'allow_duet', 'allow_stitch',
  'commercial', 'brand_organic', 'brand_content',
  // nombres antiguos (antes de estas reglas): también los decide la persona
  'disable_comment', 'disable_duet', 'disable_stitch',
];

export const isTikTokPhoto = (type) => type === 'post' || type === 'carousel';
export const tiktokMode = (options = {}) => (options.tiktok_mode === 'direct' ? 'direct' : 'inbox');

const BOOL_KEYS = ['allow_comment', 'allow_duet', 'allow_stitch', 'commercial', 'brand_organic', 'brand_content', 'is_aigc'];

/** Limpia las opciones guardadas de un destino (tipos correctos; sin Dúo/Stitch en fotos). */
export function normalizeOptions(network, type, options) {
  const o = options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : {};
  if (network === 'tiktok') {
    for (const k of BOOL_KEYS) if (k in o) o[k] = o[k] === true || o[k] === 'true' || o[k] === 1;
    if (o.tiktok_privacy === '' || o.tiktok_privacy == null) delete o.tiktok_privacy;
    if (isTikTokPhoto(type)) { delete o.allow_duet; delete o.allow_stitch; delete o.disable_duet; delete o.disable_stitch; }
    if (!o.commercial) { delete o.brand_organic; delete o.brand_content; }
  }
  if (network === 'youtube') {
    if (o.title != null) o.title = String(o.title);
    if (o.privacy === '' || o.privacy == null) delete o.privacy;
  }
  return o;
}

/**
 * Claude (MCP) no puede elegir la privacidad ni la publicidad de TikTok: se quitan sus valores y se
 * conservan los que la persona ya hubiera elegido antes en esa misma publicación.
 * Devuelve { options, stripped } (stripped = true si Claude intentó fijar alguno).
 */
export function protectHumanChoices(network, incoming, previous) {
  if (network !== 'tiktok') return { options: incoming, stripped: false };
  const out = { ...incoming };
  let stripped = false;
  for (const k of TIKTOK_HUMAN_KEYS) {
    const had = previous && Object.prototype.hasOwnProperty.call(previous, k);
    if (Object.prototype.hasOwnProperty.call(out, k) && (!had || previous[k] !== out[k])) stripped = true;
    delete out[k];
    if (had) out[k] = previous[k];
  }
  return { options: out, stripped };
}

/** Quita lo que la persona tiene que volver a elegir en cada publicación (al duplicar). */
export function withoutHumanChoices(network, options) {
  if (network !== 'tiktok') return options || {};
  const out = { ...(options || {}) };
  for (const k of TIKTOK_HUMAN_KEYS) delete out[k];
  return out;
}

/**
 * Lo que falta o no cuadra para poder programar/aprobar este destino (lista de mensajes en español).
 * creator: último creator_info conocido de esa cuenta de TikTok (opcional).
 */
export function complianceErrors(network, { type, options = {}, creator = null } = {}) {
  const errs = [];
  if (network === 'tiktok' && tiktokMode(options) === 'direct') {
    const privacy = options.tiktok_privacy;
    if (!privacy) {
      errs.push('Elige quién puede ver la publicación (no hay ninguna opción marcada por defecto).');
    } else if (!TIKTOK_PRIVACY.includes(privacy)) {
      errs.push('Esa privacidad no existe en TikTok. Elige una de la lista.');
    } else if (creator?.privacy_level_options?.length && !creator.privacy_level_options.includes(privacy)) {
      errs.push(`Tu cuenta de TikTok ya no permite «${TIKTOK_PRIVACY_LABEL[privacy]}». Elige otra opción de la lista.`);
    }
    if (options.commercial && !options.brand_organic && !options.brand_content) {
      errs.push('Has activado «Divulgar contenido comercial»: indica si tu contenido te promociona a ti, a un tercero o a ambos («Tu marca», «Contenido de marca» o las dos).');
    }
    if (options.commercial && options.brand_content && privacy === 'SELF_ONLY') {
      errs.push('El contenido de marca no puede ser privado («Solo yo»). Elige otra visibilidad.');
    }
  }
  if (network === 'youtube' && type === 'reel') {
    if (!String(options.title || '').trim()) errs.push('Escribe el título del vídeo.');
    if (!options.privacy) errs.push('Elige la visibilidad del vídeo: público, no listado o privado.');
    else if (!YOUTUBE_PRIVACY.includes(options.privacy)) errs.push('La visibilidad debe ser pública, no listada o privada.');
  }
  return errs;
}

/* ---- Último creator_info conocido por cuenta (en memoria; se renueva al abrir el compositor y al publicar) ---- */
const CREATOR_TTL_MS = 2 * 60 * 60 * 1000; // el avatar de TikTok caduca a las 2 h: mismo plazo
const creatorCache = new Map();

export function rememberCreatorInfo(accountId, info) {
  if (accountId && info) creatorCache.set(Number(accountId), { info, at: Date.now() });
}

export function knownCreatorInfo(accountId) {
  const c = creatorCache.get(Number(accountId));
  if (!c || Date.now() - c.at > CREATOR_TTL_MS) return null;
  return c.info;
}
