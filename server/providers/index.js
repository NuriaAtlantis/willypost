// Registro de proveedores. El orden es el que se muestra en la interfaz.
import { redirectUriFor } from '../config.js';

const MODULES = ['facebook', 'instagram', 'tiktok', 'gbp', 'youtube', 'linkedin', 'threads', 'bluesky'];

export const providers = {};
export const loadErrors = {};

for (const id of MODULES) {
  try {
    const mod = await import(`./${id}.js`);
    providers[id] = mod.default;
  } catch (e) {
    // Un proveedor roto no debe tumbar la app: esa red queda en modo manual.
    loadErrors[id] = String(e?.message || e);
    console.error(`[providers] No se pudo cargar ${id}:`, loadErrors[id]);
  }
}

// Datos mínimos para redes sin módulo cargado (siguen disponibles en modo manual).
const FALLBACK = {
  facebook: { label: 'Facebook', color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  tiktok: { label: 'TikTok', color: '#111111' },
  gbp: { label: 'Google Business Profile', color: '#34A853' },
  youtube: { label: 'YouTube Shorts', color: '#FF0000' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2' },
  threads: { label: 'Threads', color: '#101010' },
  bluesky: { label: 'Bluesky', color: '#1185FE' },
};

export const NETWORK_IDS = MODULES;

export function getProvider(id) {
  return providers[id] || null;
}

/**
 * Datos públicos de una red para la interfaz.
 * - central: true si se puede conectar SIN carné (la app de WillyPost está disponible para esta red).
 * - mode: con qué se conectará al pulsar Conectar: 'own' (carné propio guardado, tiene preferencia),
 *   'central' (sin carné), 'carne' (hace falta configurar un carné), 'password' (Bluesky) o 'manual'.
 */
export function networkInfo(id, configuredFamilies = new Set(), centralFamilies = new Set()) {
  const p = providers[id];
  const fb = FALLBACK[id];
  if (!p) {
    return {
      id, label: fb.label, color: fb.color, family: null, authType: 'manual', redirect: null, redirectUri: null,
      supports: { post: false, carousel: false, reel: false, story: false, textOnly: false },
      limits: { captionMax: 2200 }, needsApproval: null,
      notes: 'Esta red solo está disponible en modo manual en esta versión.',
      credsConfigured: false, guide: `guias/${id}.html`, available: false, central: false, mode: 'manual',
    };
  }
  const isPwd = p.authType === 'apppassword';
  const own = !isPwd && configuredFamilies.has(p.family);
  const central = !isPwd && !!p.family && centralFamilies.has(p.family);
  return {
    id,
    label: p.label || fb.label,
    color: p.color || fb.color,
    family: p.family || null,
    authType: p.authType || 'oauth',
    redirect: p.redirect || null,
    redirectUri: p.authType === 'apppassword' ? null : redirectUriFor(p),
    supports: p.supports,
    limits: p.limits || {},
    needsApproval: (central && !own && p.centralNeedsApproval) || p.needsApproval || null,
    // En modo central se enseñan las notas sin instrucciones de "tu app de desarrollador" (si la red las tiene).
    notes: (central && !own && p.centralNotes) || p.notes || '',
    credsConfigured: isPwd ? true : own,
    guide: `guias/${id}.html`,
    available: true,
    central,
    mode: isPwd ? 'password' : own ? 'own' : central ? 'central' : 'carne',
  };
}

/** ¿La API de esta red puede publicar este tipo? */
export function apiSupports(id, type, hasMedia) {
  const p = providers[id];
  if (!p) return false;
  if (!p.supports?.[type]) return false;
  if (type === 'post' && !hasMedia && !p.supports.textOnly) return false;
  return true;
}
