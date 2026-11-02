// GET /api/accounts/:id/tiktok/creator-info y POST /api/posts con el token de Claude.
// Express en el propio proceso (puerto aleatorio, datos temporales) y la red de TikTok simulada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-compliance-api-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_NO_DESKTOP_NOTIFY = '1';
process.env.WILLYPOST_BROKER = 'off';

const express = (await import('express')).default;
const { run, get, db } = await import('../server/db.js');
const { createSession, COOKIE, sha256 } = await import('../server/auth.js');
const { postsRouter } = await import('../server/routes/posts.js');

const realFetch = globalThis.fetch;
let tiktokReply = null; // (url) => Response
let tiktokCalls = [];
let server;
let base;
let cookie;
let bearer;
let tt;
let ig;
let otherTt;
let video;

before(async () => {
  const ts = new Date().toISOString();
  const later = new Date(Date.now() + 48 * 3600e3).toISOString();
  const u = Number(run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', 'api@test.com', 'A', 'x', ts).lastInsertRowid);
  const u2 = Number(run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', 'otra@test.com', 'B', 'x', ts).lastInsertRowid);
  const acc = (user, network, ext) => Number(run(
    `INSERT INTO accounts (user_id, network, external_id, name, username, avatar_url, access_token, refresh_token, token_expires_at, meta, mode, connected_at, created_at)
     VALUES (?, ?, ?, 'Mi cuenta', 'mia', NULL, 'SECRET-ACCESS', 'SECRET-REFRESH', ?, '{}', 'api', ?, ?)`,
    user, network, ext, later, ts, ts,
  ).lastInsertRowid);
  tt = acc(u, 'tiktok', 'open-a');
  ig = acc(u, 'instagram', 'ig-a');
  otherTt = acc(u2, 'tiktok', 'open-b');
  run(`INSERT INTO media (user_id, filename, original_name, mime, kind, size, width, height, duration, created_at)
       VALUES (?, 'v.mp4', 'v.mp4', 'video/mp4', 'video', 1000, 1080, 1920, 20, ?)`, u, ts);
  video = get('SELECT id FROM media WHERE user_id = ?', u).id;
  cookie = `${COOKIE}=${createSession(u).token}`;
  const raw = 'wp_' + crypto.randomBytes(16).toString('hex');
  run('INSERT INTO api_tokens (user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)', u, sha256(raw), 'Claude', ts);
  bearer = `Bearer ${raw}`;

  const app = express();
  app.use(express.json());
  app.use(postsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, details: err.details }));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  // Solo se simula TikTok; las peticiones al servidor de prueba van por la red local real.
  globalThis.fetch = async (url, init = {}) => {
    const u2s = String(url);
    if (u2s.startsWith('https://open.tiktokapis.com/')) {
      tiktokCalls.push({ url: u2s, headers: init.headers });
      return tiktokReply(u2s);
    }
    if (u2s.startsWith(base)) return realFetch(url, init);
    throw new Error('Llamada de red no permitida en las pruebas: ' + u2s);
  };
});

after(() => {
  globalThis.fetch = realFetch;
  server?.close();
  try { db.close(); } catch { /* */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
async function call(method, url, { body, auth = cookie } = {}) {
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}) };
  if (auth.startsWith('Bearer ')) headers.Authorization = auth; else headers.Cookie = auth;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

test('creator-info: devuelve un subconjunto seguro (sin tokens) y consulta TikTok con el token de la cuenta', async () => {
  tiktokCalls = [];
  tiktokReply = () => json({
    data: {
      creator_nickname: 'Willy Buceo', creator_username: 'willybuceo', creator_avatar_url: 'https://p16-sign.tiktokcdn.com/av.jpg',
      privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      comment_disabled: true, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 180, extra_field: 'x',
    },
    error: { code: 'ok', message: '' },
  });
  const r = await call('GET', `/api/accounts/${tt}/tiktok/creator-info`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    nickname: 'Willy Buceo', username: 'willybuceo', avatar_url: 'https://p16-sign.tiktokcdn.com/av.jpg',
    privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    comment_disabled: true, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 180,
    can_post: true, reason: null,
  });
  assert.ok(!JSON.stringify(r.body).includes('SECRET'));
  assert.equal(tiktokCalls[0].url, 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
  assert.equal(tiktokCalls[0].headers.Authorization, 'Bearer SECRET-ACCESS');
});

test('creator-info recién consultado: no deja programar una privacidad que el creador no tiene', async () => {
  const body = {
    type: 'reel', caption: 'Vídeo', media_ids: [video], action: 'schedule', scheduled_at: new Date(Date.now() + 5 * 3600e3).toISOString(),
    targets: [{ account_id: tt, options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE' } }],
  };
  let r = await call('POST', '/api/posts', { body });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /ya no permite «Todo el mundo»/);
  body.targets[0].options.tiktok_privacy = 'FOLLOWER_OF_CREATOR';
  r = await call('POST', '/api/posts', { body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'scheduled');
});

test('creator-info: si el creador no puede publicar ahora, can_post=false con el motivo en español', async () => {
  tiktokReply = () => json({ data: {}, error: { code: 'spam_risk_too_many_posts', message: 'daily cap', log_id: 'l' } });
  const r = await call('GET', `/api/accounts/${tt}/tiktok/creator-info`);
  assert.equal(r.status, 200);
  assert.equal(r.body.can_post, false);
  assert.match(r.body.reason, /límite diario de publicaciones de TikTok/);
  assert.deepEqual(r.body.privacy_level_options, []);
  assert.equal(r.body.nickname, 'Mi cuenta');
});

test('creator-info: errores en español (token caducado, otra red, cuenta ajena)', async () => {
  tiktokReply = () => json({ error: { code: 'access_token_invalid', message: 'bad', log_id: 'l' } }, 401);
  let r = await call('GET', `/api/accounts/${tt}/tiktok/creator-info`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Reconecta tu cuenta/);
  r = await call('GET', `/api/accounts/${ig}/tiktok/creator-info`);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no es de TikTok/);
  r = await call('GET', `/api/accounts/${otherTt}/tiktok/creator-info`);
  assert.equal(r.status, 404);
  assert.match(r.body.error, /no existe/);
  tiktokReply = () => { throw new TypeError('fetch failed'); };
  r = await call('GET', `/api/accounts/${tt}/tiktok/creator-info`);
  assert.ok(r.status >= 500);
  assert.match(r.body.error, /TikTok/);
});

test('Claude (token de la API) no puede fijar la privacidad ni la publicidad de TikTok', async () => {
  const r = await call('POST', '/api/posts', {
    auth: bearer,
    body: {
      type: 'reel', caption: 'Propuesta', media_ids: [video], action: 'schedule', scheduled_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
      targets: [{ account_id: tt, options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY', commercial: true, brand_content: true, allow_comment: true } }],
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.created_by, 'claude');
  assert.deepEqual(r.body.targets[0].options, { tiktok_mode: 'direct' });
  assert.ok(r.body.warnings.some((w) => /Claude no puede marcarlos/.test(w.message)));
});
