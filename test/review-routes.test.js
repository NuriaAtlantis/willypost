// Segunda revisión, por la API real (en el mismo proceso): "Reintentar"/editar mientras una red aún puede
// contestar a la publicación anterior, y extensiones de archivo coherentes con su contenido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rev-routes-'));
const PORT = 20000 + Math.floor(Math.random() * 9000);
Object.assign(process.env, {
  WILLYPOST_DATA: dataDir,
  WILLYPOST_PORT: String(PORT), // nunca el 4747/4748 de la instalación real
  WILLYPOST_SHARE_PORT: String(PORT + 1),
  WILLYPOST_NO_SCHEDULER: '1',
  WILLYPOST_NO_DESKTOP_NOTIFY: '1',
  WILLYPOST_PUBLISH_TIMEOUT_MS: '300',
  APPDATA: path.join(dataDir, 'appdata'),
  LOCALAPPDATA: path.join(dataDir, 'localappdata'),
});

const BASE = `http://localhost:${PORT}`;
const { server } = await import('../server/index.js');
const { run, get, db } = await import('../server/db.js');
const { providers } = await import('../server/providers/index.js');
const { importLocalFile, toJpeg, providerMediaItem } = await import('../server/media.js');
const share = await import('../server/share.js');

const bsky = providers.bluesky;
const originalPublish = bsky.publish;
let cookie = '';
let user;
let acc;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, url, body) {
  const r = await fetch(BASE + url, {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

before(async () => {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
    await wait(100);
  }
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Nuria', email: 'rutas@test.es', password: 'contraseña-larga' }),
  });
  cookie = r.headers.get('set-cookie').split(';')[0];
  user = get('SELECT * FROM users WHERE email = ?', 'rutas@test.es');
  const ts = new Date().toISOString();
  run(
    `INSERT INTO accounts (user_id, network, external_id, name, username, access_token, meta, mode, connected_at, created_at)
     VALUES (?, 'bluesky', 'did:rutas', 'Atlantis', 'atlantis.bsky.social', 'tok', '{}', 'api', ?, ?)`,
    user.id, ts, ts,
  );
  acc = get('SELECT * FROM accounts WHERE user_id = ?', user.id);
});

after(async () => {
  bsky.publish = originalPublish;
  await new Promise((r) => server.close(r));
  try { share.startShareServer().close(); } catch { /* */ }
  try { db.close(); } catch { /* */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

test('"Reintentar" o editar mientras la red aún puede contestar → 409 en español; luego aparece publicada sola', async () => {
  let calls = 0;
  bsky.publish = async () => { calls++; await wait(700); return { external_id: 'tarde' }; };
  const created = await api('POST', '/api/posts', { type: 'post', caption: 'Inmersión nocturna', targets: [{ account_id: acc.id }], action: 'publish_now' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const postId = created.body.id;
  const targetId = created.body.targets[0].id;
  // kick() → tick → la red no contesta en 300 ms → fallido, pero su petición sigue viva.
  for (let i = 0; i < 40 && get('SELECT status FROM post_targets WHERE id = ?', targetId).status !== 'failed'; i++) await wait(25);
  assert.equal(get('SELECT status FROM post_targets WHERE id = ?', targetId).status, 'failed');

  const retry = await api('POST', `/api/targets/${targetId}/retry`);
  assert.equal(retry.status, 409);
  assert.match(retry.body.error, /todavía puede estar terminando/);
  const edit = await api('PUT', `/api/posts/${postId}`, { type: 'post', caption: 'Otra', targets: [{ account_id: acc.id }], action: 'publish_now' });
  assert.equal(edit.status, 409);
  assert.equal(calls, 1);

  await wait(700);
  const after = await api('GET', `/api/posts/${postId}`);
  assert.equal(after.body.status, 'published');
  assert.equal(after.body.targets[0].status, 'published');
  assert.match(after.body.targets[0].warning, /contestó tarde/);
  assert.equal(calls, 1, 'nunca se publicó dos veces');
});

test('medios: el archivo guardado lleva la extensión de su contenido real (.jfif → .jpg, PNG llamado .jpg → .png, .m4v → .mp4)', async () => {
  const src = path.join(dataDir, 'origen con espacios y tildé');
  fs.mkdirSync(src, { recursive: true });
  const jfif = path.join(src, 'foto guardada de Chrome.jfif');
  await sharp({ create: { width: 40, height: 30, channels: 3, background: '#2266aa' } }).jpeg().toFile(jfif);
  const fakeJpg = path.join(src, 'captura.jpg');
  await sharp({ create: { width: 40, height: 30, channels: 4, background: '#ffffff' } }).png().toFile(fakeJpg);
  // MP4 mínimo: caja ftyp + moov con mvhd (lo justo para que WillyPost lo reconozca).
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0])]);
  const mvhdBody = Buffer.alloc(100);
  mvhdBody.writeUInt32BE(1000, 12); // timescale
  mvhdBody.writeUInt32BE(5000, 16); // 5 s
  const mvhd = Buffer.concat([Buffer.from([0, 0, 0, 108]), Buffer.from('mvhd'), mvhdBody]);
  const moov = Buffer.concat([Buffer.from([0, 0, 0, 116]), Buffer.from('moov'), mvhd]);
  const m4v = path.join(src, 'clip.m4v');
  fs.writeFileSync(m4v, Buffer.concat([ftyp, moov]));

  const a = await importLocalFile(user.id, jfif);
  assert.equal(a.mime, 'image/jpeg');
  assert.match(a.filename, /\.jpg$/);
  assert.equal(a.original_name, 'foto guardada de Chrome.jfif', 'el nombre que ve el alumno no cambia');
  const b = await importLocalFile(user.id, fakeJpg);
  assert.equal(b.mime, 'image/png');
  assert.match(b.filename, /\.png$/);
  const c = await importLocalFile(user.id, m4v);
  assert.equal(c.mime, 'video/mp4');
  assert.match(c.filename, /\.mp4$/);
  assert.equal(c.duration, 5);
  for (const m of [a, b, c]) assert.ok(fs.existsSync(path.join(dataDir, 'media', m.filename)), m.filename);
  // La URL pública temporal lleva una extensión que aceptan las redes (y el proxy de medios de TikTok).
  process.env.WILLYPOST_PUBLIC_BASE = 'https://prueba.trycloudflare.com';
  const url = await share.publicUrl({ path: path.join(dataDir, 'media', a.filename), mime: a.mime });
  assert.match(url, /\/media\.jpg$/);
  delete process.env.WILLYPOST_PUBLIC_BASE;
});

test('la misma imagen PNG convertida a JPEG a la vez para varias redes: todas lo consiguen (antes chocaban en el temporal)', async () => {
  const png = path.join(dataDir, 'cartel.png');
  await sharp({ create: { width: 1200, height: 1500, channels: 4, background: '#e0a020' } }).png().toFile(png);
  const m = await importLocalFile(user.id, png);
  const item = providerMediaItem(m);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => toJpeg(item)));
  for (const r of results) assert.equal(r.status, 'fulfilled', String(r.reason?.stack || r.reason));
  const out = results[0].value.path;
  assert.equal((await sharp(out).metadata()).format, 'jpeg');
  assert.deepEqual(fs.readdirSync(path.dirname(out)).filter((f) => f.endsWith('.tmp')), [], 'sin temporales sueltos');
});

test('/api/health dice cuántos envíos se están subiendo (el instalador espera a 0 antes de parar WillyPost)', async () => {
  bsky.publish = async () => { await wait(250); return { external_id: 'ok' }; };
  const h0 = await api('GET', '/api/health');
  assert.equal(h0.body.ok, true);
  assert.equal(h0.body.publishing, 0);
  const created = await api('POST', '/api/posts', { type: 'post', caption: 'Salida en barco', targets: [{ account_id: acc.id }], action: 'publish_now' });
  assert.equal(created.status, 201);
  await wait(120); // kick() arranca el ciclo a los 50 ms
  assert.equal((await api('GET', '/api/health')).body.publishing, 1);
  await wait(400);
  assert.equal((await api('GET', '/api/health')).body.publishing, 0);
  assert.equal((await api('GET', `/api/posts/${created.body.id}`)).body.status, 'published');
});
