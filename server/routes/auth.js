import express from 'express';
import { all, get, run, now } from '../db.js';
import {
  HttpError, hashPassword, verifyPassword, newRecoveryCode, createSession, setSessionCookie,
  clearSessionCookie, userFromRequest, publicUser, requireAuth, requireSession, getSettings, setSetting, COOKIE,
  normalizeRecoveryCode,
} from '../auth.js';

export const authRouter = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  if (pw.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga (máximo 200 caracteres).');
  if (!pw.trim()) throw new HttpError(400, 'La contraseña no puede ser solo espacios.');
}

authRouter.get('/api/auth/state', (req, res) => {
  const hasUsers = get('SELECT COUNT(*) AS n FROM users').n > 0;
  res.json({ hasUsers, user: publicUser(userFromRequest(req)) });
});

authRouter.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password;
  if (!name) throw new HttpError(400, 'Escribe tu nombre.');
  if (name.length > 100) throw new HttpError(400, 'El nombre es demasiado largo.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Ese email no parece válido.');
  checkPassword(password);
  if (get('SELECT 1 AS x FROM users WHERE email = ?', email)) {
    throw new HttpError(409, 'Ya existe una cuenta con ese email en este ordenador. Inicia sesión.');
  }
  const recoveryCode = newRecoveryCode();
  const r = run(
    'INSERT INTO users (email, name, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    email, name, hashPassword(password), hashPassword(recoveryCode), now(),
  );
  const user = get('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
  const { token } = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), recoveryCode });
});

authRouter.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!email || !req.body?.password) throw new HttpError(400, 'Escribe tu email y tu contraseña.');
  if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) {
    throw new HttpError(401, 'Email o contraseña incorrectos.');
  }
  const { token } = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

authRouter.post('/api/auth/logout', (req, res) => {
  const cookie = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  if (cookie) run('DELETE FROM sessions WHERE token = ?', cookie.split('=')[1]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/api/auth/reset', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = normalizeRecoveryCode(req.body?.recoveryCode);
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(code, user.recovery_hash)) {
    throw new HttpError(401, 'El email o el código de recuperación no son correctos.');
  }
  checkPassword(req.body?.newPassword);
  const recoveryCode = newRecoveryCode();
  run('UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ?', hashPassword(req.body.newPassword), hashPassword(recoveryCode), user.id);
  // Cierra las sesiones abiertas con la contraseña antigua.
  run('DELETE FROM sessions WHERE user_id = ?', user.id);
  const { token } = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ ok: true, recoveryCode, user: publicUser(user) });
});

authRouter.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), settings: getSettings(req.user.id) });
});

authRouter.put('/api/me', requireSession, (req, res) => {
  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  if (name && name.length > 100) throw new HttpError(400, 'El nombre es demasiado largo.');
  if (name) run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
  if (req.body?.newPassword) {
    if (!verifyPassword(String(req.body.currentPassword || ''), req.user.password_hash)) {
      // 400 y no 401: un 401 hace que la interfaz cierre la sesión (parece que te ha echado).
      throw new HttpError(400, 'La contraseña actual no es correcta.');
    }
    checkPassword(req.body.newPassword);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.newPassword), req.user.id);
  }
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

authRouter.put('/api/settings', requireAuth, (req, res) => {
  const b = req.body || {};
  if (b.claude_mode !== undefined) {
    if (!['draft', 'schedule'].includes(b.claude_mode)) throw new HttpError(400, 'Modo de Claude no válido.');
    // Claude no puede darse permiso a sí mismo para publicar sin tu aprobación.
    if (req.viaApiToken && b.claude_mode !== getSettings(req.user.id).claude_mode) {
      throw new HttpError(403, 'El modo de Claude solo lo puedes cambiar tú, desde WillyPost > Claude.');
    }
    setSetting(req.user.id, 'claude_mode', b.claude_mode);
  }
  if (b.queue_times !== undefined) {
    const times = Array.isArray(b.queue_times) ? b.queue_times : [];
    if (!times.length || times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      throw new HttpError(400, 'Las horas de la cola deben tener el formato 09:30.');
    }
    setSetting(req.user.id, 'queue_times', JSON.stringify([...new Set(times)].sort()));
  }
  if (b.onboarding_done !== undefined) setSetting(req.user.id, 'onboarding_done', b.onboarding_done ? '1' : '0');
  res.json({ settings: getSettings(req.user.id) });
});

export { all };
