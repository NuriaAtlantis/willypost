// Proveedor Google Business Profile (publicaciones locales) — familia de credenciales 'google'.
//
// Documentación consultada (nov 2026):
//  - Requisitos y formulario de acceso: https://developers.google.com/my-business/content/prereqs
//  - Configuración básica (APIs a activar): https://developers.google.com/my-business/content/basic-setup
//  - Crear posts locales (v4):  https://developers.google.com/my-business/content/posts-data
//  - Recurso LocalPost:         https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts
//  - Cuentas (v1):              https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list
//  - Fichas (v1):               https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list
//  - OAuth 2.0 Google:          https://developers.google.com/identity/protocols/oauth2/web-server
//
// NO VERIFICADO en la doc: longitud máxima del summary (usamos 1500, valor habitual) y requisitos de la foto
// (usamos JPG/PNG; el sourceUrl debe ser accesible públicamente, por eso se usa ctx.publicUrl).
import { ProviderError, fetchJson, addSeconds, ambiguousPublish } from './_http.js';
import { fitImage, MAX_IMAGE_BYTES } from './_media.js';
import { googleAuthUrl, googleExchange, googleRefresh } from './youtube.js';

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const LOCATIONS_URL = (acc) => `https://mybusinessbusinessinformation.googleapis.com/v1/${acc}/locations`;
const POSTS_URL = (loc) => `https://mybusiness.googleapis.com/v4/${loc}/localPosts`;

const CTA_TYPES = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'];
const APPROVAL_MSG =
  'Google todavía no te ha dado acceso a la API de Business Profile. Hay que pedirlo con el formulario "Application for Basic API Access" ' +
  '(ficha verificada con más de 60 días y web en la ficha) y activar después las APIs en tu proyecto de Google Cloud. ' +
  'Mientras tanto, esta red se publica en modo manual.';

/** ¿Es el error típico de "API sin aprobar" (cuota 0 / API no activada)? */
export function isApprovalError(e, { anyQuota = false } = {}) {
  if (!(e instanceof ProviderError)) return false;
  if (e.status !== 403 && e.status !== 429) return false;
  const blob = typeof e.raw === 'string' ? e.raw : JSON.stringify(e.raw || {});
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured|not been enabled/i.test(blob)) return true;
  if (/quota_limit_value\\?["']?\s*[:=]\s*\\?["']?0\b/i.test(blob) || /limit_value[^0-9]{0,6}0\b/i.test(blob)) return true;
  if (anyQuota && /RESOURCE_EXHAUSTED|Quota exceeded/i.test(blob)) return true;
  return false;
}

function approvalError(e) {
  const err = new ProviderError(APPROVAL_MSG, { status: e.status, raw: e.raw }); // no auth, no retryable
  err.manual = true; // el core lo pasa a "Para publicar a mano"
  return err;
}

async function gget(url, token) {
  return fetchJson(url, { headers: { Authorization: `Bearer ${token}` }, label: 'Google Business Profile' });
}

function addressSummary(a) {
  if (!a) return null;
  const parts = [a.addressLines?.[0], a.locality].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function firstUrl(text) {
  const m = /https?:\/\/[^\s)>\]"']+/i.exec(text || '');
  return m ? m[0].replace(/[.,;:!?]+$/, '') : null;
}

export default {
  id: 'gbp',
  label: 'Google Business Profile',
  color: '#4285F4',
  family: 'google',
  authType: 'oauth',
  redirect: 'local',
  supports: { post: true, carousel: false, reel: false, story: false, textOnly: true },
  limits: { captionMax: 1500, carouselMax: 1, videoMaxSec: 0 },
  needsApproval:
    'Google tiene que aprobar el acceso a su API (ficha verificada con más de 60 días). Mientras tanto, se publica en modo manual.',
  notes:
    'Publica novedades en tu ficha de Google (texto o 1 foto, con botón opcional). Usa las mismas credenciales de Google que YouTube.',
  optionsSchema: [
    { key: 'cta', label: 'Botón', type: 'cta', actionTypes: CTA_TYPES },
  ],

  getAuthUrl({ creds, redirectUri, state }) {
    return googleAuthUrl({ creds, redirectUri, state, scopes: [GBP_SCOPE] });
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const tok = await googleExchange({ creds, redirectUri, code, requiredScopes: [GBP_SCOPE] });
    const common = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      token_expires_at: addSeconds(tok.expires_in),
    };

    // 1) Cuentas
    const accounts = [];
    try {
      let pageToken = '';
      for (let i = 0; i < 10; i++) {
        const q = new URLSearchParams({ pageSize: '20' });
        if (pageToken) q.set('pageToken', pageToken);
        const r = await gget(`${ACCOUNTS_URL}?${q}`, tok.access_token);
        accounts.push(...(r.accounts || []));
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
    } catch (e) {
      if (isApprovalError(e, { anyQuota: true })) throw approvalError(e);
      throw e;
    }

    // 2) Fichas de cada cuenta
    const out = [];
    for (const acc of accounts) {
      let pageToken = '';
      for (let i = 0; i < 20; i++) {
        const q = new URLSearchParams({ readMask: 'title,name,storefrontAddress,websiteUri', pageSize: '100' });
        if (pageToken) q.set('pageToken', pageToken);
        let r;
        try {
          r = await gget(`${LOCATIONS_URL(acc.name)}?${q}`, tok.access_token);
        } catch (e) {
          if (isApprovalError(e, { anyQuota: true })) throw approvalError(e);
          if (e.status === 403 || e.status === 404) break; // cuenta sin fichas accesibles: seguir con la siguiente
          throw e;
        }
        for (const loc of r.locations || []) {
          out.push({
            external_id: `${acc.name}/${loc.name}`, // accounts/x/locations/y
            name: loc.title || 'Ficha sin nombre',
            username: addressSummary(loc.storefrontAddress),
            avatar_url: null,
            ...common,
            meta: {
              account: acc.name,
              location: loc.name,
              account_name: acc.accountName || null,
              website: loc.websiteUri || null,
            },
          });
        }
        pageToken = r.nextPageToken;
        if (!pageToken) break;
      }
    }
    if (!out.length) {
      throw new ProviderError(
        'Tu cuenta de Google no gestiona ninguna ficha de Google Business Profile. Conecta con la cuenta que es propietaria o gestora de la ficha.',
      );
    }
    return out;
  },

  async refresh({ account, creds }) {
    return googleRefresh({ account, creds });
  },

  validate({ type, caption, media = [], options = {} }) {
    if (type !== 'post') return []; // carrusel/reel/story → el core lo marca manual
    const errs = [];
    const text = (caption || '').trim();
    if (!text && !media.length) errs.push('Escribe un texto o añade una foto para la ficha de Google.');
    if (text.length > 1500) errs.push('El texto de Google Business Profile no puede pasar de 1500 caracteres.');
    if (media.length > 1) errs.push('Google Business Profile admite una sola foto por publicación.');
    if (media.some((m) => m.kind !== 'image')) errs.push('Google Business Profile solo admite fotos (no vídeo) en publicaciones.');
    const m = media[0];
    if (m?.width && m?.height && (m.width < 250 || m.height < 250)) errs.push('La foto es demasiado pequeña (mínimo 250×250 px).');
    const cta = options.cta;
    if (cta) {
      if (!CTA_TYPES.includes(cta.actionType)) errs.push(`El botón debe ser uno de: ${CTA_TYPES.join(', ')}.`);
      else if (cta.actionType !== 'CALL' && !/^https?:\/\//i.test(cta.url || '')) errs.push('El botón necesita una dirección web que empiece por https://');
    }
    return errs;
  },

  async publish({ account, type, caption, media = [], options = {}, ctx = {} }) {
    if (type !== 'post') throw new ProviderError('Google Business Profile solo admite publicaciones de texto o con 1 foto.');
    const loc = account.external_id; // accounts/x/locations/y
    if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(loc || '')) {
      throw new ProviderError('La ficha conectada no es válida. Vuelve a conectar Google Business Profile.', { auth: true });
    }
    const body = {
      languageCode: options.languageCode || 'es',
      summary: String(caption || '').trim().slice(0, 1500),
      topicType: 'STANDARD',
    };

    // Botón: options.cta, o LEARN_MORE con el primer enlace del texto (o la web de la ficha).
    const cta = options.cta;
    if (cta && cta.actionType) {
      body.callToAction = cta.actionType === 'CALL' ? { actionType: 'CALL' } : { actionType: cta.actionType, url: cta.url };
    } else if (cta !== null && cta !== false) {
      const link = firstUrl(caption);
      if (link) body.callToAction = { actionType: 'LEARN_MORE', url: link };
    }

    if (media[0]) {
      if (!ctx.publicUrl) throw new ProviderError('No hay forma de crear una dirección pública para la foto.');
      let item = media[0];
      if (!/^image\/(jpe?g|png)$/i.test(item.mime || '') && ctx.toJpeg) {
        const j = await ctx.toJpeg(item);
        item = { ...item, path: j.path, mime: j.mime };
      }
      // Las fotos de Google Business admiten hasta 5 MB (JPG/PNG): si pesa más, se reduce.
      item = await fitImage(item, { maxBytes: MAX_IMAGE_BYTES.gbp, label: 'Google Business Profile', log: ctx.log });
      const sourceUrl = await ctx.publicUrl(item);
      body.media = [{ mediaFormat: 'PHOTO', sourceUrl }];
    }

    let res;
    try {
      res = await fetchJson(POSTS_URL(loc), {
        method: 'POST',
        json: body,
        headers: { Authorization: `Bearer ${account.access_token}` },
        label: 'Google Business Profile',
      });
    } catch (e) {
      if (isApprovalError(e)) throw approvalError(e);
      if (e instanceof ProviderError && e.status === 403) {
        throw new ProviderError(
          'Google no te deja publicar en esta ficha. Comprueba que eres propietario o gestor y que la ficha está verificada.',
          { status: 403, raw: e.raw, auth: /token|scope|insufficient/i.test(JSON.stringify(e.raw || {})) },
        );
      }
      throw ambiguousPublish(e, 'Google Business Profile');
    }
    return { external_id: res.name || loc, url: res.searchUrl || 'https://business.google.com/' };
  },
};
