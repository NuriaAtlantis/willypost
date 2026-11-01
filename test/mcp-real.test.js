// Integración real: Claude (cliente MCP) → mcp/server.js → WillyPost de verdad (datos temporales).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4793;
const BASE = `http://localhost:${PORT}`;
let proc;
let dataDir;
let client;
let cookie = '';

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return res.json();
}

const text = (r) => r.content.map((c) => c.text).join('\n');

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'willypost-mcp-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, WILLYPOST_DATA: dataDir, WILLYPOST_PORT: String(PORT), WILLYPOST_SHARE_PORT: '4794', WILLYPOST_NO_DESKTOP_NOTIFY: '1', WILLYPOST_NO_SCHEDULER: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  await api('POST', '/api/auth/register', { name: 'Willy', email: 'willy@test.com', password: 'contraseña-larga' });
  await api('POST', '/api/accounts/manual', { network: 'instagram', name: 'Mi Instagram' });
  await api('POST', '/api/accounts/manual', { network: 'tiktok', name: 'Mi TikTok' });
  const { token } = await api('POST', '/api/claude/token', {});
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'mcp', 'server.js')],
    env: { ...process.env, WILLYPOST_URL: BASE, WILLYPOST_TOKEN: token },
  }));
});

after(async () => {
  await client?.close();
  proc?.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
});

function isoLocal(daysAhead, hour) {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysAhead, hour, 0, 0);
  const off = -t.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(hour)}:00:00${sign}${hh}:${mm}`;
}

test('Claude ve el estado y crea una campaña en el WillyPost real', async () => {
  const status = text(await client.callTool({ name: 'willypost_status', arguments: {} }));
  assert.match(status, /Instagram/i);
  const r = await client.callTool({
    name: 'create_campaign',
    arguments: {
      name: 'Black Friday',
      description: 'Prueba',
      posts: [
        { type: 'post', caption: 'Llega el Black Friday', networks: ['instagram', 'tiktok'], scheduled_at: isoLocal(2, 10),
          captions_by_network: { tiktok: 'Black Friday 🔥 #seo' } },
        { type: 'post', caption: 'Último día', networks: ['instagram'], scheduled_at: isoLocal(3, 18) },
      ],
    },
  });
  assert.ok(!r.isError, text(r));
  const posts = await api('GET', '/api/posts');
  const bf = posts.filter((p) => p.campaign?.name === 'Black Friday');
  assert.equal(bf.length, 2);
  // Modo por defecto: borradores "Propuesto por Claude"
  assert.ok(bf.every((p) => p.status === 'draft' && p.created_by === 'claude'));
  const first = bf.find((p) => p.caption === 'Llega el Black Friday');
  assert.equal(first.targets.length, 2);
  assert.equal(first.targets.find((t) => t.network === 'tiktok').caption, 'Black Friday 🔥 #seo');
  assert.equal(new Date(first.scheduled_at).getHours(), 10);
});

// 1x1 PNG válido
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('upload_media sube desde rutas con tildes y espacios (y una carpeta) a la biblioteca real', async () => {
  const dir = path.join(dataDir, 'Fotos de la Campaña ñ');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Imagen número 1.png'), PNG);
  fs.writeFileSync(path.join(dir, 'imagen 2.png'), PNG);
  const one = await client.callTool({ name: 'upload_media', arguments: { path: path.join(dir, 'Imagen número 1.png') } });
  assert.ok(!one.isError, text(one));
  assert.match(text(one), /media_id \d+/);
  const folder = await client.callTool({ name: 'upload_media', arguments: { path: dir } });
  assert.ok(!folder.isError, text(folder));
  assert.match(text(folder), /2 archivos subidos/);
  const media = await api('GET', '/api/media');
  assert.ok(media.some((m) => m.original_name === 'Imagen número 1.png'), 'conserva el nombre con tildes');
  const missing = await client.callTool({ name: 'upload_media', arguments: { path: path.join(dir, 'no-existe.png') } });
  assert.equal(missing.isError, true);
});

test('límite diario: Claude lo comprueba antes de crear y create_campaign no pasa de 5 por cuenta y día', async () => {
  await api('PUT', '/api/settings', { claude_mode: 'schedule' });
  const when = (h) => isoLocal(6, h);
  const r = await client.callTool({
    name: 'create_campaign',
    arguments: {
      name: 'Límites',
      posts: Array.from({ length: 7 }, (_, i) => ({ type: 'post', caption: `Límite ${i}`, networks: ['instagram'], scheduled_at: when(8 + i) })),
    },
  });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /5 piezas creadas, 2 con incidencias/);
  const posts = (await api('GET', '/api/posts')).filter((p) => p.campaign?.name === 'Límites');
  assert.equal(posts.length, 5);
  assert.ok(posts.every((p) => p.status === 'scheduled'), 'en modo "schedule" Claude programa directamente');
  const one = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'Una más', networks: ['instagram'], scheduled_at: when(20) } });
  assert.equal(one.isError, true);
  assert.match(text(one), /máximo 5 al día/);
  await api('PUT', '/api/settings', { claude_mode: 'draft' });
});

test('update_post y delete_post sobre el WillyPost real', async () => {
  const created = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'Para editar', networks: ['tiktok'], scheduled_at: isoLocal(9, 11) } });
  assert.ok(!created.isError, text(created));
  const id = Number(/Pieza #(\d+)/.exec(text(created))[1]);
  const upd = await client.callTool({ name: 'update_post', arguments: { id, caption: 'Editado', scheduled_at: isoLocal(10, 12) } });
  assert.ok(!upd.isError, text(upd));
  const post = await api('GET', `/api/posts/${id}`);
  assert.equal(post.caption, 'Editado');
  assert.equal(new Date(post.scheduled_at).getHours(), 12);
  const past = await client.callTool({ name: 'update_post', arguments: { id, scheduled_at: '2020-01-01T10:00:00+01:00' } });
  assert.equal(past.isError, true);
  assert.match(text(past), /ya ha pasado/);
  const del = await client.callTool({ name: 'delete_post', arguments: { id } });
  assert.ok(!del.isError, text(del));
  assert.equal((await api('GET', '/api/posts')).some((p) => p.id === id), false);
});

test('get_calendar y get_free_slots funcionan con la API real', async () => {
  const cal = await client.callTool({ name: 'get_calendar', arguments: { from: isoLocal(0, 0).slice(0, 10), to: isoLocal(30, 0).slice(0, 10) } });
  assert.ok(!cal.isError, text(cal));
  assert.match(text(cal), /Black Friday/);
  const slots = await client.callTool({ name: 'get_free_slots', arguments: { from: isoLocal(0, 0).slice(0, 10), to: isoLocal(30, 0).slice(0, 10) } });
  assert.ok(!slots.isError, text(slots));
  assert.match(text(slots), /LLENO/);
});
