import { get, run, parseJson, now } from './db.js';
import { RECONNECT_DAYS, RECONNECT_WARN_DAYS } from './config.js';
import { getProvider } from './providers/index.js';

const DAY = 86400000;

export function getCreds(userId, family) {
  if (!family) return null;
  const c = get('SELECT * FROM credentials WHERE user_id = ? AND family = ?', userId, family);
  return c ? { client_id: c.client_id, client_secret: c.client_secret, extra: parseJson(c.extra, {}) } : null;
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

/** Refresca el token si caduca pronto (o si force). Devuelve la fila actualizada. */
export async function ensureFreshToken(acc, { force = false } = {}) {
  const provider = getProvider(acc.network);
  if (!provider?.refresh) return acc;
  const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : null;
  const soon = exp !== null && exp < Date.now() + 10 * 60 * 1000;
  if (!force && !soon) return acc;
  const creds = getCreds(acc.user_id, provider.family);
  const r = await provider.refresh({ account: providerAccount(acc), creds });
  if (!r) return acc;
  run(
    'UPDATE accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, last_error = NULL WHERE id = ?',
    r.access_token || acc.access_token, r.refresh_token || null, r.token_expires_at || acc.token_expires_at, acc.id,
  );
  return get('SELECT * FROM accounts WHERE id = ?', acc.id);
}
