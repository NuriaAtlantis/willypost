import { get, run, parseJson, now } from './db.js';
import { RECONNECT_DAYS, RECONNECT_WARN_DAYS } from './config.js';
import { getProvider } from './providers/index.js';
import { centralCredsFor, loadCentralConfig } from './central.js';

const DAY = 86400000;

/** Carné propio guardado por el alumno (o null). */
export function getCreds(userId, family) {
  if (!family) return null;
  const c = get('SELECT * FROM credentials WHERE user_id = ? AND family = ?', userId, family);
  return c ? { client_id: c.client_id, client_secret: c.client_secret, extra: parseJson(c.extra, {}) } : null;
}

/**
 * Credenciales con las que conectar una familia: 1) el carné propio si está guardado; 2) si no, la app
 * central de WillyPost (modo sin carné) si el servidor central la ofrece; 3) si no, null.
 */
export async function resolveCreds(userId, family) {
  if (!family) return null;
  const own = getCreds(userId, family);
  if (own?.client_id) return own;
  await loadCentralConfig();
  return centralCredsFor(family);
}

/** Con qué se conectó una cuenta: 'central' (app de WillyPost) u 'own' (carné propio; también las antiguas). */
export function accountAuthMode(acc) {
  return parseJson(acc?.meta, {})?.auth_mode === 'central' ? 'central' : 'own';
}

/**
 * Credenciales para renovar/usar el token de una cuenta ya conectada. Un token solo lo puede renovar la
 * misma app que lo emitió: una cuenta conectada en modo central sigue usando la app central aunque luego
 * se guarde un carné propio (y al revés).
 */
export async function credsForAccount(acc, family = getProvider(acc.network)?.family) {
  if (!family) return null;
  if (accountAuthMode(acc) === 'central') {
    await loadCentralConfig();
    // Sin conexión con el servidor central y sin copia guardada: los refrescos que pasan por el broker
    // (TikTok) funcionan igual; los de Google avisan ellos mismos de que falta el cliente.
    return centralCredsFor(family) || { client_id: null, extra: {}, central: true };
  }
  return getCreds(acc.user_id, family);
}

export function reconnectDueAt(acc) {
  return new Date(new Date(acc.connected_at).getTime() + RECONNECT_DAYS * DAY).toISOString();
}

export function daysLeft(acc) {
  return Math.ceil((new Date(reconnectDueAt(acc)).getTime() - Date.now()) / DAY);
}

export function accountStatus(acc) {
  if (acc.mode === 'manual') return 'manual';
  if (Date.now() > new Date(reconnectDueAt(acc)).getTime()) return 'expired';
  if (acc.last_error) return 'error';
  if (Date.now() > new Date(acc.connected_at).getTime() + RECONNECT_WARN_DAYS * DAY) return 'expiring';
  return 'ok';
}

export function serializeAccount(acc) {
  return {
    id: acc.id,
    network: acc.network,
    name: acc.name,
    username: acc.username,
    avatar_url: acc.avatar_url,
    mode: acc.mode,
    status: accountStatus(acc),
    connected_at: acc.connected_at,
    reconnect_due_at: acc.mode === 'manual' ? null : reconnectDueAt(acc),
    days_left: acc.mode === 'manual' ? null : Math.max(0, daysLeft(acc)),
    last_error: acc.last_error,
    // 'central' = conectada con la app de WillyPost (sin carné); 'own' = con el carné propio.
    auth_mode: acc.mode === 'manual' ? null : accountAuthMode(acc),
  };
}

/** Objeto cuenta tal y como lo reciben los proveedores. */
export function providerAccount(acc) {
  return {
    id: acc.id,
    external_id: acc.external_id,
    name: acc.name,
    username: acc.username,
    access_token: acc.access_token,
    refresh_token: acc.refresh_token,
    token_expires_at: acc.token_expires_at,
    meta: parseJson(acc.meta, {}),
  };
}

/** Guarda una cuenta conectada (nueva o reconexión) a partir de un Candidate del proveedor. */
export function saveCandidate(userId, network, c) {
  const ts = now();
  run(
    `INSERT INTO accounts (user_id, network, external_id, name, username, avatar_url, access_token, refresh_token,
       token_expires_at, meta, mode, connected_at, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api', ?, NULL, ?)
     ON CONFLICT(user_id, network, external_id) DO UPDATE SET
       name = excluded.name, username = excluded.username, avatar_url = excluded.avatar_url,
       access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       token_expires_at = excluded.token_expires_at, meta = excluded.meta, mode = 'api',
       connected_at = excluded.connected_at, last_error = NULL`,
    userId, network, String(c.external_id), c.name || null, c.username || null, c.avatar_url || null,
    c.access_token || null, c.refresh_token || null, c.token_expires_at || null,
    JSON.stringify(c.meta || {}), ts, ts,
  );
  return get('SELECT * FROM accounts WHERE user_id = ? AND network = ? AND external_id = ?', userId, network, String(c.external_id));
}

// Renovaciones en marcha por cuenta. La publicación y el mantenimiento pueden querer renovar la misma cuenta a
// la vez; algunas redes (TikTok, Google en ciertos casos…) rotan el refresh_token y una segunda petición con el
// antiguo fallaría y marcaría la cuenta como "reconectar" sin motivo.
const refreshing = new Map();

/** Refresca el token si caduca pronto (o si force). Devuelve la fila actualizada. */
export async function ensureFreshToken(acc, { force = false } = {}) {
  const provider = getProvider(acc.network);
  if (!provider?.refresh) return acc;
  if (refreshing.has(acc.id)) {
    await refreshing.get(acc.id);
    return get('SELECT * FROM accounts WHERE id = ?', acc.id) || acc;
  }
  // La fila en memoria puede ser antigua (otra renovación ya guardó un refresh_token nuevo): usamos la guardada.
  const current = (acc.id != null && get('SELECT * FROM accounts WHERE id = ?', acc.id)) || acc;
  const exp = current.token_expires_at ? new Date(current.token_expires_at).getTime() : null;
  const soon = exp !== null && exp < Date.now() + 10 * 60 * 1000;
  if (!force && !soon) return current;
  const job = (async () => {
    const creds = await credsForAccount(current, provider.family);
    const r = await provider.refresh({ account: providerAccount(current), creds });
    if (!r) return current;
    run(
      'UPDATE accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, last_error = NULL WHERE id = ?',
      r.access_token || current.access_token, r.refresh_token || null, r.token_expires_at || current.token_expires_at, current.id,
    );
    return get('SELECT * FROM accounts WHERE id = ?', current.id) || current;
  })();
  refreshing.set(acc.id, job);
  try {
    return await job;
  } finally {
    if (refreshing.get(acc.id) === job) refreshing.delete(acc.id);
  }
}
