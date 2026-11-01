// Prueba de extremo a extremo del núcleo: arranca un WillyPost real con datos temporales.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4791;
const BASE = `http://localhost:${PORT}`;
let proc;
let dataDir;
let cookie = '';

async function api(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willypost-test-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, WILLYPOST_DATA: dataDir, WILLYPOST_PORT: String(PORT), WILLYPOST_SHARE_PORT: '4792', WILLYPOST_NO_DESKTOP_NOTIFY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`El servidor no arrancó:\n${out}`);
});

after(() => {
  proc?.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows puede tener la DB abierta */ }
});

const tomorrowAt = (h, m = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m).toISOString();
};

test('registro, sesión y ajustes', async () => {
  let r = await api('GET', '/api/auth/state');
  assert.equal(r.body.hasUsers, false);
  r = await api('POST', '/api/auth/register', { name: 'Ana', email: 'ana@test.com', password: 'corta' });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/auth/register', { name: 'Ana', email: 'ana@test.com', password: 'contraseña-larga' });
  assert.equal(r.status, 200);
  assert.match(r.body.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const recovery = r.body.recoveryCode;
  r = await api('GET', '/api/me');
  assert.equal(r.body.user.email, 'ana@test.com');
  assert.equal(r.body.settings.claude_mode, 'draft');
  // Recuperación de contraseña
  r = await api('POST', '/api/auth/reset', { email: 'ana@test.com', recoveryCode: recovery, newPassword: 'otra-contraseña' });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/login', { email: 'ana@test.com', password: 'otra-contraseña' });
  assert.equal(r.status, 200);
});

test('seguridad: bloquea otras webs y hosts raros', async () => {
  let r = await api('POST', '/api/campaigns', { name: 'x' }, { Origin: 'https://malvado.com' });
  assert.equal(r.status, 403);
  // fetch no deja cambiar la cabecera Host: usamos http.request.
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', headers: { Host: 'evil.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('catálogo de redes', async () => {
  const r = await api('GET', '/api/networks');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((n) => n.id), ['facebook', 'instagram', 'tiktok', 'gbp', 'youtube', 'linkedin', 'threads', 'bluesky']);
});

let accId;
let igManualId;
test('cuentas manuales y publicación manual', async () => {
  let r = await api('POST', '/api/accounts/manual', { network: 'tiktok', name: 'Mi TikTok' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'manual');
  accId = r.body.id;
  r = await api('POST', '/api/accounts/manual', { network: 'instagram', name: 'Mi IG' });
  igManualId = r.body.id;

  r = await api('POST', '/api/posts', { type: 'post', caption: 'Hola mundo', targets: [{ account_id: accId }], action: 'publish_now' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id;
  // El scheduler lo pasa a "manual_pending" enseguida.
  let post;
  for (let i = 0; i < 30; i++) {
    post = (await api('GET', `/api/posts/${id}`)).body;
    if (post.status === 'manual') break;
    await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal(post.status, 'manual');
  assert.equal(post.targets[0].status, 'manual_pending');
  r = await api('POST', `/api/targets/${post.targets[0].id}/manual-done`, { url: 'https://tiktok.com/x' });
  assert.equal(r.body.status, 'published');
  r = await api('GET', '/api/notifications');
  assert.ok(r.body.items.some((n) => n.kind === 'manual'));
});

test('límite de 5 al día por red y 10 stories aparte', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/api/posts', { type: 'post', caption: `Post ${i}`, targets: [{ account_id: igManualId }], scheduled_at: tomorrowAt(9 + i), action: 'schedule' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  let r = await api('POST', '/api/posts', { type: 'post', caption: 'Sexto', targets: [{ account_id: igManualId }], scheduled_at: tomorrowAt(20), action: 'schedule' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /máximo es 5/);
  // Un borrador no cuenta
  r = await api('POST', '/api/posts', { type: 'post', caption: 'Borrador', targets: [{ account_id: igManualId }], scheduled_at: tomorrowAt(20), action: 'draft' });
  assert.equal(r.status, 201);
  // Slots
  r = await api('GET', '/api/slots');
  const slot = r.body.find((s) => s.account_id === igManualId);
  assert.equal(slot.feed, 5);
  assert.equal(slot.feedMax, 5);
});

test('Claude en modo borrador: lo programado llega como borrador', async () => {
  const tokenRes = await api('POST', '/api/claude/token', {});
  const token = tokenRes.body.token;
  assert.match(token, /^wp_/);
  const saved = cookie;
  cookie = '';
  let r = await api('POST', '/api/posts', {
    type: 'post', caption: 'Idea de Claude', targets: [{ account_id: accId }], scheduled_at: tomorrowAt(11), action: 'schedule', created_by: 'claude',
  }, { Authorization: `Bearer ${token}` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.created_by, 'claude');
  assert.ok(r.body.warnings.some((w) => /Propuesto por Claude/.test(w.message)));
  const id = r.body.id;
  cookie = saved;
  r = await api('POST', `/api/posts/${id}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'scheduled');
  // Modo "schedule"
  await api('PUT', '/api/settings', { claude_mode: 'schedule' });
  cookie = '';
  r = await api('POST', '/api/posts', {
    type: 'post', caption: 'Directo', targets: [{ account_id: accId }], scheduled_at: tomorrowAt(12), action: 'schedule', created_by: 'claude',
  }, { Authorization: `Bearer ${token}` });
  assert.equal(r.body.status, 'scheduled');
  cookie = saved;
});

test('cola: siguiente hueco libre', async () => {
  await api('PUT', '/api/settings', { queue_times: ['10:00', '18:00'] });
  const r = await api('POST', '/api/posts', { type: 'post', caption: 'En cola', targets: [{ account_id: accId }], action: 'queue' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const d = new Date(r.body.scheduled_at);
  assert.ok([10, 18].includes(d.getHours()));
});

test('validaciones de tipo', async () => {
  let r = await api('POST', '/api/posts', { type: 'carousel', caption: 'x', targets: [{ account_id: accId }], scheduled_at: tomorrowAt(15), action: 'schedule' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /al menos 2/);
  r = await api('POST', '/api/posts', { type: 'post', caption: 'x', targets: [{ account_id: accId }], scheduled_at: '2020-01-01T10:00:00Z', action: 'schedule' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /ya ha pasado/);
});

test('interfaz servida en /', async () => {
  const res = await fetch(`${BASE}/`);
  assert.ok([200, 503].includes(res.status));
});
