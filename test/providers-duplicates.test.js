// Duplicados al reintentar, duración desconocida (null) y reconexión con otra cuenta.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-dup-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_PORT = '4827';
process.env.WILLYPOST_SHARE_PORT = '4828';

const tiktok = (await import('../server/providers/tiktok.js')).default;
const youtube = (await import('../server/providers/youtube.js')).default;
const { _tuning: ytTuning } = await import('../server/providers/youtube.js');
const instagram = (await import('../server/providers/instagram.js')).default;
const facebook = (await import('../server/providers/facebook.js')).default;
const threads = (await import('../server/providers/threads.js')).default;
const linkedin = (await import('../server/providers/linkedin.js')).default;
const bluesky = (await import('../server/providers/bluesky.js')).default;
const { knownDuration, durationErrors } = await import('../server/providers/_media.js');
const { run, get } = await import('../server/db.js');
const oauth = await import('../server/oauth.js');

const realFetch = globalThis.fetch;
let handler;
let calls;
let tmp;
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
beforeEach(() => {
  calls = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-dup2-'));
  globalThis.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: (init.method || 'GET').toUpperCase(), headers: { ...(init.headers || {}) }, body: init.body };
    calls.push(rec);
    return handler(rec);
  };
});
afterEach(() => { globalThis.fetch = realFetch; fs.rmSync(tmp, { recursive: true, force: true }); });
after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ } });

const ctx = { pollInterval: 1, pollMs: 1, sleep: async () => {}, log() {} };
const vfile = (size = 3000) => { const p = path.join(tmp, 'v.mp4'); fs.writeFileSync(p, Buffer.alloc(size, 3)); return p; };

/* ---------- TikTok ---------- */

test('tiktok: si falla la red al sondear el estado DESPUÉS de subir el vídeo, no se reintenta solo', async () => {
  const file = vfile();
  handler = (r) => {
    if (r.url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'p', upload_url: 'https://up.tiktok/u' }, error: { code: 'ok' } });
    if (r.url === 'https://up.tiktok/u') return new Response(null, { status: 201 });
    throw new Error('ECONNRESET'); // status/fetch
  };
  await assert.rejects(
    tiktok.publish({ account: { access_token: 't', meta: {} }, type: 'reel', caption: 'x', media: [{ id: 1, path: file, mime: 'video/mp4', kind: 'video' }], options: {}, ctx }),
    (e) => e.retryable === false && /TikTok/.test(e.message) && /Reintentar/.test(e.message),
  );
});

test('tiktok: un fallo ANTES de enviar el último trozo sí es reintentable (aún no existe ningún post)', async () => {
  const file = vfile();
  handler = (r) => {
    if (r.url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'p', upload_url: 'https://up.tiktok/u' }, error: { code: 'ok' } });
    return json({ error: 'boom' }, 503);
  };
  await assert.rejects(
    tiktok.publish({ account: { access_token: 't', meta: {} }, type: 'reel', caption: 'x', media: [{ id: 1, path: file, mime: 'video/mp4', kind: 'video' }], options: {}, ctx }),
    (e) => e.retryable === true,
  );
});

test('tiktok: FAILED con motivo "internal" sigue siendo reintentable (TikTok confirma que no publicó)', async () => {
  const file = vfile();
  handler = (r) => {
    if (r.url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'p', upload_url: 'https://up.tiktok/u' }, error: { code: 'ok' } });
    if (r.url === 'https://up.tiktok/u') return new Response(null, { status: 201 });
    return json({ data: { status: 'FAILED', fail_reason: 'internal' }, error: { code: 'ok' } });
  };
  await assert.rejects(
    tiktok.publish({ account: { access_token: 't', meta: {} }, type: 'reel', caption: 'x', media: [{ id: 1, path: file, mime: 'video/mp4', kind: 'video' }], options: {}, ctx }),
    (e) => e.retryable === true,
  );
});

/* ---------- YouTube ---------- */

test('youtube: último trozo sin confirmar tras agotar los reintentos → NO reintentable (YouTube pudo crear el vídeo)', async () => {
  const file = vfile(5000);
  const old = ytTuning.maxRetries; ytTuning.maxRetries = 1;
  handler = (r) => {
    if (r.url.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { Location: 'https://up.google/s' } });
    if (r.url === 'https://up.google/s') return json({ error: { message: 'backend' } }, 503);
    throw new Error('url inesperada');
  };
  try {
    await assert.rejects(
      youtube.publish({ account: { access_token: 't' }, creds: {}, type: 'reel', caption: 'x', media: [{ path: file, mime: 'video/mp4', kind: 'video' }], options: {}, ctx }),
      (e) => e.retryable === false && /YouTube/.test(e.message) && /Reintentar/.test(e.message),
    );
  } finally { ytTuning.maxRetries = old; }
});

test('youtube: si la sesión ni siquiera se crea, el 5xx sigue siendo reintentable', async () => {
  handler = () => json({ error: { message: 'x' } }, 503);
  await assert.rejects(
    youtube.publish({ account: { access_token: 't' }, creds: {}, type: 'reel', caption: 'x', media: [{ path: vfile(), mime: 'video/mp4', kind: 'video' }], options: {}, ctx }),
    (e) => e.retryable === true,
  );
});

/* ---------- duración null = desconocida ---------- */

test('duración: null/0/undefined/NaN se tratan como "desconocida" y nunca dan error', () => {
  for (const d of [null, undefined, 0, NaN, 'abc']) {
    assert.equal(knownDuration({ duration: d }), null);
    assert.deepEqual(durationErrors({ duration: d }, { min: 3, max: 60, label: 'X' }), []);
  }
  assert.deepEqual(durationErrors(undefined, { max: 60, label: 'X' }), []);
  assert.equal(durationErrors({ duration: 2 }, { min: 3, label: 'X' }).length, 1);
  assert.match(durationErrors({ duration: 61 }, { max: 60, label: 'las stories' })[0], /61 s .* máximo 60 s/);
});

test('duración: cada red valida con sus límites cuando se conoce, y deja pasar cuando no', () => {
  const v = (d) => ({ kind: 'video', mime: 'video/mp4', duration: d });
  const unknownOk = (p, type) => assert.deepEqual(p.validate({ type, caption: 'x', media: [v(null)] }), [], `${p.id} con duración desconocida`);
  unknownOk(instagram, 'reel'); unknownOk(instagram, 'story'); unknownOk(facebook, 'reel'); unknownOk(facebook, 'story');
  unknownOk(threads, 'reel'); unknownOk(linkedin, 'reel'); unknownOk(bluesky, 'reel'); unknownOk(tiktok, 'reel');
  assert.ok(instagram.validate({ type: 'story', caption: '', media: [v(75)] }).length, 'story IG > 60 s');
  assert.ok(instagram.validate({ type: 'reel', caption: '', media: [v(2)] }).length, 'reel IG < 3 s');
  assert.deepEqual(instagram.validate({ type: 'reel', caption: '', media: [v(600)] }), []);
  assert.ok(facebook.validate({ type: 'reel', caption: '', media: [v(100)] }).length, 'reel FB > 90 s');
  assert.ok(facebook.validate({ type: 'story', caption: '', media: [v(61)] }).length);
  assert.ok(threads.validate({ type: 'reel', caption: '', media: [v(400)] }).length, 'Threads > 5 min');
  assert.ok(bluesky.validate({ type: 'reel', caption: '', media: [v(200)] }).length);
  assert.ok(linkedin.validate({ type: 'reel', caption: 'x', media: [v(2000)] }).length);
  assert.ok(tiktok.validate({ type: 'reel', caption: '', media: [v(700)] }).length);
  assert.ok(youtube.warnings({ type: 'reel', media: [{ ...v(200), width: 1080, height: 1920 }] }).some((w) => /3 minutos/.test(w)));
  assert.deepEqual(youtube.warnings({ type: 'reel', media: [{ ...v(null), width: 1080, height: 1920 }] }), []);
});

/* ---------- reconexión con otra cuenta ---------- */

test('oauth: reconectar mientras se está en OTRA cuenta de la red NO crea una cuenta nueva y lo explica', async () => {
  const ts = new Date().toISOString();
  run("INSERT INTO users (email, name, password_hash, recovery_hash, created_at) VALUES ('r@t.es', 'R', 'x', 'y', ?)", ts);
  const userId = get("SELECT id FROM users WHERE email = 'r@t.es'").id;
  run("INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, 'tiktok', 'CK', 'CS', '{}', ?)", userId, ts);
  run(`INSERT INTO accounts (user_id, network, external_id, name, username, access_token, meta, mode, connected_at, created_at)
       VALUES (?, 'tiktok', 'OLD', 'Cuenta Vieja', 'vieja', 'T', '{}', 'api', ?, ?)`, userId, ts, ts);
  const accId = get("SELECT id FROM accounts WHERE external_id = 'OLD'").id;
  const tokenJson = (open) => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 86400, scope: 'user.info.basic,video.upload', open_id: open });
  const mockTikTok = (open) => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/v2/oauth/token/')) return json(tokenJson(open));
      if (u.includes('/v2/user/info/')) return json({ data: { user: { open_id: open, display_name: `N-${open}` } }, error: { code: 'ok' } });
      throw new Error('url inesperada ' + u);
    };
  };

  // 1) otra cuenta distinta
  let { authUrl } = oauth.startOAuth({ id: userId }, 'tiktok', accId);
  let st = new URL(authUrl).searchParams.get('state');
  mockTikTok('NEW');
  const r1 = await oauth.handleCallback({ code: 'c', state: st });
  const msg = decodeURIComponent(r1.split('error=')[1]);
  assert.match(msg, /con otra cuenta/);
  assert.match(msg, /Cuenta Vieja \(vieja\)/);
  assert.match(msg, /Cierra sesión en TikTok/);
  assert.equal(get("SELECT COUNT(*) AS n FROM accounts WHERE network = 'tiktok'").n, 1, 'no se añadió una cuenta nueva');
  assert.equal(get('SELECT access_token AS t FROM accounts WHERE id = ?', accId).t, 'T', 'la cuenta antigua no se tocó');
  assert.equal(get('SELECT COUNT(*) AS n FROM oauth_pending WHERE state = ?', st).n, 0);

  // 2) la misma cuenta: sí se actualiza
  ({ authUrl } = oauth.startOAuth({ id: userId }, 'tiktok', accId));
  st = new URL(authUrl).searchParams.get('state');
  mockTikTok('OLD');
  assert.equal(await oauth.handleCallback({ code: 'c', state: st }), '/#/redes?ok=tiktok');
  assert.equal(get('SELECT access_token AS t FROM accounts WHERE id = ?', accId).t, 'AT');
  assert.equal(get("SELECT COUNT(*) AS n FROM accounts WHERE network = 'tiktok'").n, 1);

  // 3) conexión normal (sin reconectar) de una cuenta distinta sigue añadiéndola
  ({ authUrl } = oauth.startOAuth({ id: userId }, 'tiktok'));
  st = new URL(authUrl).searchParams.get('state');
  mockTikTok('OTRA');
  assert.equal(await oauth.handleCallback({ code: 'c', state: st }), '/#/redes?ok=tiktok');
  assert.equal(get("SELECT COUNT(*) AS n FROM accounts WHERE network = 'tiktok'").n, 2);
});
