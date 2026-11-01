import crypto from 'node:crypto';
import { all, get, run, now } from './db.js';
import { DEFAULT_QUEUE_TIMES } from './config.js';

const SESSION_DAYS = 30;
export const COOKIE = 'wp_session';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

/** Normaliza el código de recuperación tal y como lo teclea el alumno (minúsculas, espacios, sin guiones…). */
export function normalizeRecoveryCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 16) return String(input || '').trim().toUpperCase();
  return raw.match(/.{4}/g).join('-');
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires);
  return { token, expires };
}

export function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function publicUser(u) {
  return u ? { id: u.id, email: u.email, name: u.name, created_at: u.created_at } : null;
}

/** Devuelve el usuario de la petición (cookie o Bearer) o null. */
export function userFromRequest(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const row = get(
      'SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?',
      sha256(auth.slice(7).trim()),
    );
    if (row) req.viaApiToken = true;
    return row || null;
  }
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = get(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
    token, now(),
  );
  return row || null;
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) {
    const msg = req.headers.authorization?.startsWith('Bearer ')
      ? 'El token de Claude no es válido o se ha revocado. Genera uno nuevo en WillyPost > Claude.'
      : 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
    return res.status(401).json({ error: msg });
  }
  req.user = user;
  next();
}

/** Solo el alumno (con su sesión en el navegador), no Claude con su token. */
export function requireSession(req, res, next) {
  requireAuth(req, res, () => {
    if (req.viaApiToken) return res.status(403).json({ error: 'Esto solo lo puedes hacer tú desde WillyPost, no Claude.' });
    next();
  });
}

// ---------- Ajustes ----------
const DEFAULT_SETTINGS = {
  claude_mode: 'draft',
  queue_times: JSON.stringify(DEFAULT_QUEUE_TIMES),
  onboarding_done: '0',
};

export function getSettings(userId) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of all('SELECT key, value FROM settings WHERE user_id = ?', userId)) out[r.key] = r.value;
  let queue = [];
  try { queue = JSON.parse(out.queue_times); } catch { queue = DEFAULT_QUEUE_TIMES; }
  return {
    claude_mode: out.claude_mode === 'schedule' ? 'schedule' : 'draft',
    queue_times: Array.isArray(queue) ? queue : DEFAULT_QUEUE_TIMES,
    onboarding_done: out.onboarding_done === '1' || out.onboarding_done === 'true',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function setSetting(userId, key, value) {
  run(
    'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
    userId, key, value == null ? null : String(value),
  );
}
