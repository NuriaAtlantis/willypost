import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, now } from '../db.js';
import { HttpError, requireAuth, requireSession, sha256 } from '../auth.js';
import { ROOT, APP_URL, VERSION } from '../config.js';

export const miscRouter = express.Router();

miscRouter.get('/api/health', (_req, res) => res.json({ ok: true, app: 'willypost', version: VERSION }));

// ---------- Campañas ----------
const PALETTE = ['#5881B9', '#E1306C', '#F5A623', '#16A34A', '#8B5CF6', '#0EA5E9', '#EF4444', '#203046'];

miscRouter.get('/api/campaigns', requireAuth, (req, res) => {
  res.json(all(
    `SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.campaign_id = c.id) AS posts_count
     FROM campaigns c WHERE c.user_id = ? ORDER BY c.id DESC`, req.user.id,
  ));
});

const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
const cleanColor = (c, fallback) => (typeof c === 'string' && COLOR_RE.test(c.trim()) ? c.trim() : fallback);

miscRouter.post('/api/campaigns', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new HttpError(400, 'Ponle un nombre a la campaña.');
  if (name.length > 120) throw new HttpError(400, 'El nombre de la campaña es demasiado largo.');
  const count = get('SELECT COUNT(*) AS n FROM campaigns WHERE user_id = ?', req.user.id).n;
  const r = run(
    'INSERT INTO campaigns (user_id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)',
    req.user.id, name, req.body?.description || null, cleanColor(req.body?.color, PALETTE[count % PALETTE.length]), now(),
  );
  res.status(201).json(get('SELECT * FROM campaigns WHERE id = ?', Number(r.lastInsertRowid)));
});

miscRouter.put('/api/campaigns/:id', requireAuth, (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!c) throw new HttpError(404, 'Esa campaña no existe.');
  const name = req.body?.name != null ? String(req.body.name).trim() : c.name;
  if (!name) throw new HttpError(400, 'Ponle un nombre a la campaña.');
  run('UPDATE campaigns SET name = ?, description = ?, color = ? WHERE id = ?',
    name.slice(0, 120), req.body?.description ?? c.description, cleanColor(req.body?.color, c.color), c.id);
  res.json(get('SELECT * FROM campaigns WHERE id = ?', c.id));
});

miscRouter.delete('/api/campaigns/:id', requireAuth, (req, res) => {
  run('DELETE FROM campaigns WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- Snippets (hashtags y textos guardados) ----------
miscRouter.get('/api/snippets', requireAuth, (req, res) => {
  res.json(all('SELECT * FROM snippets WHERE user_id = ? ORDER BY name', req.user.id));
});

miscRouter.post('/api/snippets', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!name || !text) throw new HttpError(400, 'Pon un nombre y el texto.');
  const r = run('INSERT INTO snippets (user_id, name, text, created_at) VALUES (?, ?, ?, ?)', req.user.id, name, text, now());
  res.status(201).json(get('SELECT * FROM snippets WHERE id = ?', Number(r.lastInsertRowid)));
});

miscRouter.delete('/api/snippets/:id', requireAuth, (req, res) => {
  run('DELETE FROM snippets WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ---------- Notificaciones ----------
miscRouter.get('/api/notifications', requireAuth, (req, res) => {
  const items = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id)
    .map((n) => ({ ...n, read: !!n.read }));
  res.json({ items, unread: items.filter((n) => !n.read).length });
});

miscRouter.post('/api/notifications/read-all', requireAuth, (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

// ---------- Claude (MCP) ----------
const MCP_SCRIPT = path.join(ROOT, 'mcp', 'server.js');
const MCP_ARGS = ['--disable-warning=ExperimentalWarning', MCP_SCRIPT];

function desktopConfigPaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const out = [path.join(roaming, 'Claude', 'claude_desktop_config.json')];
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
    try {
      for (const d of fs.readdirSync(pkgs)) {
        if (/^Claude_/i.test(d)) out.push(path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
      }
    } catch { /* no hay versión de la Microsoft Store */ }
    return out;
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
  return [path.join(home, '.config', 'Claude', 'claude_desktop_config.json')];
}

const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

function claudeCodeCommand(token) {
  return `claude mcp add willypost --scope user -e WILLYPOST_TOKEN=${token} -e WILLYPOST_URL=${APP_URL} -- ${q(process.execPath)} ${MCP_ARGS.map(q).join(' ')}`;
}

function newApiToken(userId, label) {
  const token = `wp_${crypto.randomBytes(24).toString('hex')}`;
  run('INSERT INTO api_tokens (user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)', userId, sha256(token), label, now());
  return token;
}

/** Lee un JSON tolerando el BOM que añade el Bloc de notas. null si no existe o está vacío; lanza si está roto. */
function readJsonStrict(p) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function readJson(p) {
  try { return readJsonStrict(p); } catch { return null; }
}

/** Escribe sin dejar nunca el archivo a medias (primero a un temporal y luego se renombra). */
function writeFileAtomic(p, text) {
  const tmp = `${p}.willypost-tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch {
    // En Windows, si otro programa tiene el archivo abierto, el renombrado puede fallar: escritura directa.
    try { fs.writeFileSync(p, text, 'utf8'); } finally { fs.rmSync(tmp, { force: true }); }
  }
}

/** Añade WillyPost a un claude_desktop_config.json sin tocar nada más. */
export function installInDesktopConfig(p, entry) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let cfg = null;
  let original = null;
  try {
    original = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    cfg = readJsonStrict(p);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new HttpError(409, `La configuración de Claude Desktop (${p}) tiene un error y no la queremos estropear. Ábrela con el Bloc de notas, corrígela (o bórrala si no la usas) y vuelve a pulsar el botón.`);
    }
    throw e;
  }
  if (cfg !== null && (typeof cfg !== 'object' || Array.isArray(cfg))) {
    throw new HttpError(409, `La configuración de Claude Desktop (${p}) no tiene el formato esperado. Revísala con el Bloc de notas y vuelve a intentarlo.`);
  }
  cfg = cfg || {};
  if (original != null && original.trim()) fs.writeFileSync(`${p}.bak-willypost`, original, 'utf8');
  const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' && !Array.isArray(cfg.mcpServers) ? cfg.mcpServers : {};
  cfg.mcpServers = { ...servers, willypost: entry };
  writeFileAtomic(p, `${JSON.stringify(cfg, null, 2)}\n`);
}

miscRouter.get('/api/claude', requireAuth, (req, res) => {
  const paths = desktopConfigPaths();
  const installed = paths.some((p) => readJson(p)?.mcpServers?.willypost);
  res.json({
    hasToken: get('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?', req.user.id).n > 0,
    mcp: { command: process.execPath, args: MCP_ARGS, env: { WILLYPOST_URL: APP_URL, WILLYPOST_TOKEN: '<TU_TOKEN>' } },
    claudeCodeCommand: claudeCodeCommand('<TU_TOKEN>'),
    desktopConfigPath: paths.find((p) => fs.existsSync(path.dirname(p))) || paths[0],
    desktopInstalled: installed,
  });
});

miscRouter.post('/api/claude/token', requireSession, (req, res) => {
  const token = newApiToken(req.user.id, String(req.body?.label || 'Claude').slice(0, 60));
  res.json({
    token,
    claudeCodeCommand: claudeCodeCommand(token),
    mcpJson: { mcpServers: { willypost: { command: process.execPath, args: MCP_ARGS, env: { WILLYPOST_URL: APP_URL, WILLYPOST_TOKEN: token } } } },
  });
});

miscRouter.post('/api/claude/install-desktop', requireSession, (req, res) => {
  const all_ = desktopConfigPaths();
  let targets = all_.filter((p) => fs.existsSync(path.dirname(p)));
  if (!targets.length) targets = [all_[0]];
  const token = newApiToken(req.user.id, 'Claude Desktop');
  const entry = { command: process.execPath, args: MCP_ARGS, env: { WILLYPOST_URL: APP_URL, WILLYPOST_TOKEN: token } };
  const written = [];
  try {
    for (const p of targets) {
      installInDesktopConfig(p, entry);
      written.push(p);
    }
  } catch (e) {
    if (!written.length) run('DELETE FROM api_tokens WHERE token_hash = ?', sha256(token));
    if (e instanceof HttpError) throw e;
    console.error('[claude] install-desktop', e);
    throw new HttpError(500, `No hemos podido guardar la configuración de Claude Desktop (${e.code || 'error'}). Cierra Claude Desktop del todo y vuelve a intentarlo.`);
  }
  // Los tokens de instalaciones anteriores ya no los usa nadie: los revocamos.
  run(`DELETE FROM api_tokens WHERE user_id = ? AND label = 'Claude Desktop' AND token_hash <> ?`, req.user.id, sha256(token));
  res.json({ ok: true, path: written[0], paths: written, message: 'Listo. Cierra Claude Desktop del todo (también de la bandeja del sistema) y vuelve a abrirlo.' });
});

// Revoca todos los tokens de Claude (por ejemplo, si has compartido uno sin querer).
miscRouter.delete('/api/claude/token', requireSession, (req, res) => {
  const r = run('DELETE FROM api_tokens WHERE user_id = ?', req.user.id);
  res.json({ ok: true, revoked: Number(r.changes) });
});
