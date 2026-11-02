// Tests unitarios de tiktok.js, youtube.js y gbp.js con fetch simulado (sin red).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import tiktok, { toHexChallenge, planChunks, _tuning as ttTuning } from '../server/providers/tiktok.js';
import youtube, { deriveTitle, _tuning as ytTuning } from '../server/providers/youtube.js';
import gbp from '../server/providers/gbp.js';
import { ProviderError } from '../server/providers/_http.js';

/* ---------------- infraestructura de mocks ---------------- */

const realFetch = globalThis.fetch;
let calls;
let handler;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) }, body: init.body };
    calls.push(rec);
    return handler(rec);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const tmpFiles = [];
function tmpFile(size, name = 'v.mp4') {
  const p = path.join(os.tmpdir(), `wp-test-${process.pid}-${tmpFiles.length}-${name}`);
  fs.writeFileSync(p, Buffer.alloc(size, 7));
  tmpFiles.push(p);
  return p;
}
test.after(() => tmpFiles.forEach((f) => fs.rmSync(f, { force: true })));

const bodyJson = (rec) => JSON.parse(rec.body);
const bodyForm = (rec) => Object.fromEntries(new URLSearchParams(rec.body));
const REDIRECT = 'http://localhost:4747/oauth/callback';
const ctx = { pollInterval: 1, sleep: async () => {}, log: () => {} };

/* ---------------- TikTok ---------------- */

test('tiktok: URL de autorización con PKCE en hexadecimal y client_key', () => {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const b64 = crypto.createHash('sha256').update(verifier).digest('base64url');
  const hex = crypto.createHash('sha256').update(verifier).digest('hex');
  const url = new URL(tiktok.getAuthUrl({ creds: { client_id: 'ck123', client_secret: 's' }, redirectUri: REDIRECT, state: 'st', codeChallenge: b64 }));
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'), 'ck123');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.upload,video.publish');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('code_challenge'), hex);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  // si el core ya pasa hex, se respeta
  assert.equal(toHexChallenge(hex), hex);
  assert.equal(tiktok.pkceMethod, 'tiktok-hex');
  assert.equal(tiktok.redirect, 'local');
});

test('tiktok: exchangeCode envía code_verifier y consulta user/info', async () => {
  handler = (r) => {
    if (r.url.endsWith('/v2/oauth/token/')) {
      return json({ open_id: 'oid1', scope: 'user.info.basic,video.upload,video.publish', access_token: 'at1', expires_in: 86400, refresh_token: 'rt1', refresh_expires_in: 31536000, token_type: 'Bearer' });
    }
    if (r.url.startsWith('https://open.tiktokapis.com/v2/user/info/')) {
      return json({ data: { user: { open_id: 'oid1', display_name: 'Willy', avatar_url: 'https://a/x.jpg' } }, error: { code: 'ok', message: '', log_id: 'l' } });
    }
    throw new Error('url inesperada ' + r.url);
  };
  const [c] = await tiktok.exchangeCode({ creds: { client_id: 'ck', client_secret: 'cs' }, redirectUri: REDIRECT, code: 'abc', codeVerifier: 'ver'.padEnd(43, 'x') });
  const form = bodyForm(calls[0]);
  assert.equal(form.client_key, 'ck');
  assert.equal(form.client_secret, 'cs');
  assert.equal(form.grant_type, 'authorization_code');
  assert.equal(form.redirect_uri, REDIRECT);
  assert.equal(form.code, 'abc');
  assert.equal(form.code_verifier, 'ver'.padEnd(43, 'x'));
  assert.match(calls[1].url, /fields=open_id,avatar_url,display_name$/);
  assert.equal(calls[1].headers.Authorization, 'Bearer at1');
  assert.equal(c.external_id, 'oid1');
  assert.equal(c.name, 'Willy');
  assert.equal(c.avatar_url, 'https://a/x.jpg');
  assert.equal(c.refresh_token, 'rt1');
  assert.ok(Date.parse(c.token_expires_at) > Date.now());
});

test('tiktok: refresh guarda el refresh_token rotado', async () => {
  handler = () => json({ access_token: 'at2', expires_in: 86400, refresh_token: 'rt2', refresh_expires_in: 31536000 });
  const r = await tiktok.refresh({ account: { refresh_token: 'rt1' }, creds: { client_id: 'ck', client_secret: 'cs' } });
  const form = bodyForm(calls[0]);
  assert.equal(form.grant_type, 'refresh_token');
  assert.equal(form.refresh_token, 'rt1');
  assert.equal(r.access_token, 'at2');
  assert.equal(r.refresh_token, 'rt2');
});

test('tiktok: error de token con HTTP 200 se convierte en error de autenticación', async () => {
  handler = () => json({ error: 'invalid_grant', error_description: 'Authorization code is expired.' });
  await assert.rejects(
    tiktok.refresh({ account: { refresh_token: 'x' }, creds: { client_id: 'a', client_secret: 'b' } }),
    (e) => e instanceof ProviderError && e.auth === true,
  );
});

test('tiktok: planChunks respeta las reglas (<=64MB un trozo; último absorbe resto)', () => {
  assert.deepEqual(planChunks(3_000_000), { chunkSize: 3_000_000, count: 1, ranges: [[0, 2_999_999]] });
  const MB = 1024 * 1024;
  const size = 100 * MB + 123;
  const p = planChunks(size);
  assert.equal(p.chunkSize, 32 * MB);
  assert.equal(p.count, 3);
  assert.equal(p.ranges[2][1], size - 1);
  const last = p.ranges[2][1] - p.ranges[2][0] + 1;
  assert.ok(last >= p.chunkSize && last <= 128 * MB);
});

test('tiktok: publish en modo bandeja (por defecto) = init inbox → PUT → status', async () => {
  const file = tmpFile(2048);
  let polls = 0;
  handler = (r) => {
    if (r.url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'pub1', upload_url: 'https://upload.tiktok/u1' }, error: { code: 'ok' } });
    if (r.url === 'https://upload.tiktok/u1') return new Response(null, { status: 201 });
    if (r.url.endsWith('/status/fetch/')) {
      return json({ data: { status: ++polls < 2 ? 'PROCESSING_UPLOAD' : 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
    }
    throw new Error('url inesperada ' + r.url);
  };
  const res = await tiktok.publish({
    account: { access_token: 'tok', meta: {} }, creds: {}, type: 'reel', caption: 'hola',
    media: [{ id: 1, path: file, mime: 'video/mp4', kind: 'video', width: 1080, height: 1920, original_name: 'v.mp4' }],
    options: {}, ctx,
  });
  assert.deepEqual(calls.map((c) => c.url.replace('https://open.tiktokapis.com', '')), [
    '/v2/post/publish/inbox/video/init/', 'https://upload.tiktok/u1', '/v2/post/publish/status/fetch/', '/v2/post/publish/status/fetch/',
  ]);
  assert.deepEqual(bodyJson(calls[0]).source_info, { source: 'FILE_UPLOAD', video_size: 2048, chunk_size: 2048, total_chunk_count: 1 });
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].headers['Content-Range'], 'bytes 0-2047/2048');
  assert.equal(calls[1].headers['Content-Type'], 'video/mp4');
  assert.equal(bodyJson(calls[2]).publish_id, 'pub1');
  assert.equal(res.external_id, 'pub1');
  assert.match(res.warning, /bandeja de TikTok/);
});

test('tiktok: publish directo con trozos, creator_info y privacidad SELF_ONLY', async () => {
  const saved = { ...ttTuning };
  Object.assign(ttTuning, { singleMax: 10, chunk: 4 });
  try {
    const file = tmpFile(14); // 3 trozos: 0-3, 4-7, 8-13 (el último absorbe el resto)
    handler = (r) => {
      if (r.url.endsWith('/creator_info/query/')) {
        return json({ data: { creator_username: 'willy', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
      }
      if (r.url.endsWith('/post/publish/video/init/')) return json({ data: { publish_id: 'pub2', upload_url: 'https://upload.tiktok/u2' }, error: { code: 'ok' } });
      if (r.url === 'https://upload.tiktok/u2') return new Response(null, { status: r.headers['Content-Range'].startsWith('bytes 8') ? 201 : 206 });
      if (r.url.endsWith('/status/fetch/')) {
        // texto crudo: el ID int64 no cabe en un number de JS
        return new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7000000000000000001]},"error":{"code":"ok"}}', { status: 200 });
      }
      throw new Error('url inesperada ' + r.url);
    };
    const res = await tiktok.publish({
      account: { access_token: 'tok', meta: {} }, creds: {}, type: 'reel', caption: 'Mi vídeo #seo',
      media: [{ id: 1, path: file, mime: 'video/quicktime', kind: 'video', original_name: 'v.mov' }],
      // La privacidad la elige siempre la persona (reglas de TikTok: sin valor por defecto).
      options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY' }, ctx,
    });
    const init = bodyJson(calls[1]);
    assert.equal(init.post_info.privacy_level, 'SELF_ONLY');
    assert.equal(init.post_info.title, 'Mi vídeo #seo');
    assert.equal(init.post_info.disable_duet, true); // respeta lo que el creador tiene desactivado
    assert.deepEqual(init.source_info, { source: 'FILE_UPLOAD', video_size: 14, chunk_size: 4, total_chunk_count: 3 });
    const puts = calls.filter((c) => c.url === 'https://upload.tiktok/u2');
    assert.deepEqual(puts.map((p) => p.headers['Content-Range']), ['bytes 0-3/14', 'bytes 4-7/14', 'bytes 8-13/14']);
    assert.deepEqual(puts.map((p) => p.body.length), [4, 4, 6]);
    assert.equal(puts[0].headers['Content-Type'], 'video/quicktime');
    assert.equal(res.url, 'https://www.tiktok.com/@willy/video/7000000000000000001');
    assert.match(res.warning, /Solo yo/);
  } finally {
    Object.assign(ttTuning, saved);
  }
});

test('tiktok: modo directo con app sin auditar cae a la bandeja con aviso', async () => {
  const file = tmpFile(100);
  handler = (r) => {
    if (r.url.endsWith('/creator_info/query/')) return json({ data: { creator_username: 'w', privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } });
    if (r.url.endsWith('/post/publish/video/init/')) return json({ error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'x', log_id: 'l' } }, 403);
    if (r.url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'p3', upload_url: 'https://upload.tiktok/u3' }, error: { code: 'ok' } });
    if (r.url === 'https://upload.tiktok/u3') return new Response(null, { status: 201 });
    if (r.url.endsWith('/status/fetch/')) return json({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } });
    throw new Error('url inesperada ' + r.url);
  };
  const res = await tiktok.publish({
    account: { access_token: 't', meta: {} }, creds: {}, type: 'reel', caption: 'c',
    media: [{ path: file, mime: 'video/mp4', kind: 'video' }], options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY' }, ctx,
  });
  assert.match(res.warning, /no está auditada/);
  assert.match(res.warning, /bandeja/);
  assert.ok(calls.some((c) => c.url.endsWith('/inbox/video/init/')));
});

test('tiktok: FAILED en el estado produce un error en español', async () => {
  const file = tmpFile(100);
  handler = (r) => {
    if (r.url.endsWith('/inbox/video/init/')) return json({ data: { publish_id: 'p', upload_url: 'https://upload.tiktok/u4' }, error: { code: 'ok' } });
    if (r.url === 'https://upload.tiktok/u4') return new Response(null, { status: 201 });
    return json({ data: { status: 'FAILED', fail_reason: 'file_format_check_failed' }, error: { code: 'ok' } });
  };
  await assert.rejects(
    tiktok.publish({ account: { access_token: 't' }, creds: {}, type: 'reel', caption: '', media: [{ path: file, kind: 'video' }], options: {}, ctx }),
    /formato del vídeo/,
  );
});

test('tiktok: access_token_invalid → auth:true', async () => {
  const file = tmpFile(100);
  handler = () => json({ error: { code: 'access_token_invalid', message: 'bad', log_id: 'l' } }, 401);
  await assert.rejects(
    tiktok.publish({ account: { access_token: 't' }, creds: {}, type: 'reel', caption: '', media: [{ path: file, kind: 'video' }], options: {}, ctx }),
    (e) => e.auth === true,
  );
});

test('tiktok: validate', () => {
  assert.deepEqual(tiktok.validate({ type: 'reel', caption: 'x', media: [{ kind: 'video' }], options: {} }), []);
  assert.equal(tiktok.validate({ type: 'reel', caption: 'x', media: [{ kind: 'image' }], options: {} }).length, 1);
  assert.equal(tiktok.validate({ type: 'reel', caption: 'x'.repeat(2201), media: [{ kind: 'video' }], options: {} }).length, 1);
  assert.deepEqual(tiktok.validate({ type: 'carousel', caption: '', media: [], options: {} }), []); // manual lo decide el core
});

/* ---------------- YouTube ---------------- */

const CREDS = { client_id: 'gid.apps.googleusercontent.com', client_secret: 'gsecret' };

test('youtube: URL de autorización (offline + consent + scopes)', () => {
  const u = new URL(youtube.getAuthUrl({ creds: CREDS, redirectUri: REDIRECT, state: 'S', codeChallenge: 'zzz' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), CREDS.client_id);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('state'), 'S');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
  assert.equal(youtube.family, 'google');
  assert.equal(youtube.redirect, 'local');
});

test('youtube: exchangeCode devuelve el canal', async () => {
  handler = (r) => {
    if (r.url === 'https://oauth2.googleapis.com/token') {
      return json({ access_token: 'ya29', expires_in: 3599, refresh_token: '1//r', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', token_type: 'Bearer' });
    }
    if (r.url.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
      return json({ items: [{ id: 'UC123', snippet: { title: 'Mi canal', customUrl: '@mican', thumbnails: { default: { url: 'https://yt/a.jpg' } } } }] });
    }
    throw new Error('url inesperada ' + r.url);
  };
  const [c] = await youtube.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'CODE', codeVerifier: 'v' });
  const form = bodyForm(calls[0]);
  assert.equal(form.grant_type, 'authorization_code');
  assert.equal(form.code, 'CODE');
  assert.equal(form.client_secret, 'gsecret');
  assert.equal(form.redirect_uri, REDIRECT);
  assert.match(calls[1].url, /part=snippet&mine=true/);
  assert.equal(c.external_id, 'UC123');
  assert.equal(c.name, 'Mi canal');
  assert.equal(c.username, '@mican');
  assert.equal(c.avatar_url, 'https://yt/a.jpg');
  assert.equal(c.refresh_token, '1//r');
});

test('youtube: si falta el permiso de subida o el refresh_token, error claro', async () => {
  handler = () => json({ access_token: 'a', expires_in: 10, scope: 'https://www.googleapis.com/auth/youtube.readonly', refresh_token: 'r' });
  await assert.rejects(youtube.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'c' }), /casillas/i);
  handler = () => json({ access_token: 'a', expires_in: 10, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' });
  await assert.rejects(youtube.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'c' }), /permiso duradero/);
});

test('youtube: refresh y invalid_grant', async () => {
  handler = () => json({ access_token: 'new', expires_in: 3599 });
  const r = await youtube.refresh({ account: { refresh_token: 'rt' }, creds: CREDS });
  assert.equal(bodyForm(calls[0]).grant_type, 'refresh_token');
  assert.equal(r.access_token, 'new');
  handler = () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
  await assert.rejects(youtube.refresh({ account: { refresh_token: 'rt' }, creds: CREDS }), (e) => e.auth === true && /7 días/.test(e.message));
});

test('youtube: deriveTitle y validate', () => {
  assert.equal(deriveTitle({ title: ' Hola <b> ' }, 'x'), 'Hola b');
  assert.equal(deriveTitle({}, '\n\nPrimera línea\nsegunda'), 'Primera línea');
  assert.equal(Array.from(deriveTitle({}, 'a'.repeat(300))).length, 100);
  assert.equal(deriveTitle({}, '', [{ original_name: 'mi-video.mp4' }]), 'mi-video');
  assert.deepEqual(youtube.validate({ type: 'reel', caption: 'x', media: [{ kind: 'video', width: 1080, height: 1920 }], options: {} }), []);
  assert.equal(youtube.validate({ type: 'reel', caption: '', media: [], options: {} }).length, 1);
  assert.equal(youtube.validate({ type: 'reel', caption: '', media: [{ kind: 'video' }, { kind: 'video' }], options: {} }).length, 1);
  assert.equal(youtube.warnings({ type: 'reel', media: [{ width: 1920, height: 1080 }] }).length, 1);
  assert.equal(youtube.warnings({ type: 'reel', media: [{ width: 1080, height: 1920 }] }).length, 0);
});

test('youtube: publish = sesión resumible → PUT por trozos (308) → lectura de estado', async () => {
  const saved = { ...ytTuning };
  ytTuning.chunk = 262144;
  try {
    const size = 262144 * 2 + 1000;
    const file = tmpFile(size);
    let put = 0;
    handler = (r) => {
      if (r.url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable')) {
        return new Response('{}', { status: 200, headers: { Location: 'https://upload.google/session1' } });
      }
      if (r.url === 'https://upload.google/session1') {
        put++;
        if (put === 1) return new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } });
        if (put === 2) return new Response(null, { status: 308, headers: { Range: 'bytes=0-524287' } });
        return json({ id: 'VID123', status: { privacyStatus: 'public' } }, 200);
      }
      if (r.url.startsWith('https://www.googleapis.com/youtube/v3/videos?part=status')) {
        return json({ items: [{ id: 'VID123', status: { privacyStatus: 'private', uploadStatus: 'uploaded' } }] });
      }
      throw new Error('url inesperada ' + r.url);
    };
    const res = await youtube.publish({
      account: { access_token: 'ya29' }, creds: CREDS, type: 'reel', caption: 'Título del short\nDescripción #seo',
      media: [{ path: file, mime: 'video/mp4', kind: 'video', width: 1080, height: 1920, original_name: 'a.mp4' }],
      options: {}, ctx,
    });
    const init = calls[0];
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-Upload-Content-Length'], String(size));
    assert.equal(init.headers['X-Upload-Content-Type'], 'video/mp4');
    assert.equal(init.headers.Authorization, 'Bearer ya29');
    const meta = bodyJson(init);
    assert.equal(meta.snippet.title, 'Título del short');
    assert.equal(meta.snippet.description, 'Título del short\nDescripción #seo');
    assert.equal(meta.snippet.categoryId, '22');
    assert.equal(meta.status.privacyStatus, 'public');
    assert.equal(meta.status.selfDeclaredMadeForKids, false);
    const puts = calls.filter((c) => c.url === 'https://upload.google/session1');
    assert.deepEqual(puts.map((p) => p.headers['Content-Range']), [
      `bytes 0-262143/${size}`, `bytes 262144-524287/${size}`, `bytes 524288-${size - 1}/${size}`,
    ]);
    assert.equal(res.external_id, 'VID123');
    assert.equal(res.url, 'https://youtube.com/shorts/VID123');
    assert.equal(res.warning, 'YouTube ha dejado el vídeo en privado porque tu proyecto de Google no está verificado.');
  } finally {
    Object.assign(ytTuning, saved);
  }
});

test('youtube: subida de un solo PUT sin aviso si queda público', async () => {
  const file = tmpFile(5000);
  handler = (r) => {
    if (r.url.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { Location: 'https://upload.google/s2' } });
    if (r.url === 'https://upload.google/s2') return json({ id: 'V2' }, 201);
    return json({ items: [{ status: { privacyStatus: 'public', uploadStatus: 'uploaded' } }] });
  };
  const res = await youtube.publish({
    account: { access_token: 't' }, creds: CREDS, type: 'reel', caption: 'x',
    media: [{ path: file, mime: 'video/mp4', kind: 'video', width: 720, height: 1280 }], options: { privacy: 'public' }, ctx,
  });
  assert.equal(res.warning, undefined);
  assert.equal(calls.filter((c) => c.url === 'https://upload.google/s2').length, 1);
});

test('youtube: reanuda tras un 503 consultando el estado', async () => {
  const file = tmpFile(5000);
  let n = 0;
  handler = (r) => {
    if (r.url.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { Location: 'https://upload.google/s3' } });
    if (r.url === 'https://upload.google/s3') {
      n++;
      if (n === 1) return json({ error: { message: 'backend' } }, 503);
      if (n === 2) return new Response(null, { status: 308 }); // consulta de estado: nada recibido
      return json({ id: 'V3' }, 200);
    }
    return json({ items: [{ status: { privacyStatus: 'public' } }] });
  };
  const res = await youtube.publish({
    account: { access_token: 't' }, creds: CREDS, type: 'reel', caption: 'x',
    media: [{ path: file, mime: 'video/mp4', kind: 'video' }], options: {}, ctx,
  });
  assert.equal(res.external_id, 'V3');
  const puts = calls.filter((c) => c.url === 'https://upload.google/s3');
  assert.equal(puts[1].headers['Content-Range'], 'bytes */5000');
});

test('youtube: cuota agotada → mensaje en español', async () => {
  const file = tmpFile(100);
  handler = () => json({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, 403);
  await assert.rejects(
    youtube.publish({ account: { access_token: 't' }, creds: CREDS, type: 'reel', caption: 'x', media: [{ path: file, kind: 'video' }], options: {}, ctx }),
    /límite diario/,
  );
});

/* ---------------- Google Business Profile ---------------- */

test('gbp: URL de autorización pide business.manage', () => {
  const u = new URL(gbp.getAuthUrl({ creds: CREDS, redirectUri: REDIRECT, state: 's' }));
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/business.manage');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(gbp.family, 'google');
  assert.match(gbp.needsApproval, /Google tiene que aprobar/);
});

test('gbp: exchangeCode lista cuentas y fichas (una candidata por ficha)', async () => {
  handler = (r) => {
    if (r.url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'a', expires_in: 3599, refresh_token: 'r', scope: 'https://www.googleapis.com/auth/business.manage' });
    if (r.url.startsWith('https://mybusinessaccountmanagement.googleapis.com/v1/accounts')) return json({ accounts: [{ name: 'accounts/111', accountName: 'Mi negocio', type: 'PERSONAL' }] });
    if (r.url.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations')) {
      return json({ locations: [
        { name: 'locations/1', title: 'Tienda Centro', storefrontAddress: { addressLines: ['Calle Mayor 1'], locality: 'Madrid' }, websiteUri: 'https://tienda.es' },
        { name: 'locations/2', title: 'Tienda Norte' },
      ] });
    }
    throw new Error('url inesperada ' + r.url);
  };
  const cands = await gbp.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'c' });
  assert.equal(cands.length, 2);
  assert.equal(cands[0].external_id, 'accounts/111/locations/1');
  assert.equal(cands[0].name, 'Tienda Centro');
  assert.equal(cands[0].username, 'Calle Mayor 1, Madrid');
  assert.equal(cands[0].meta.website, 'https://tienda.es');
  assert.equal(cands[1].external_id, 'accounts/111/locations/2');
  assert.match(calls[2].url, /readMask=title%2Cname%2CstorefrontAddress/);
});

test('gbp: API sin aprobar (cuota 0) → error explicativo, no de autenticación', async () => {
  handler = (r) => {
    if (r.url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'a', expires_in: 3599, refresh_token: 'r', scope: 'https://www.googleapis.com/auth/business.manage' });
    return json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'Requests'", details: [{ metadata: { quota_limit_value: '0' } }] } }, 429);
  };
  await assert.rejects(
    gbp.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'c' }),
    (e) => e instanceof ProviderError && e.auth === false && e.retryable === false && /Application for Basic API Access/.test(e.message),
  );
});

test('gbp: publish con foto, botón por defecto LEARN_MORE con el enlace del texto', async () => {
  handler = (r) => {
    if (r.url === 'https://mybusiness.googleapis.com/v4/accounts/111/locations/1/localPosts') {
      return json({ name: 'accounts/111/locations/1/localPosts/999', searchUrl: 'https://local.google.com/place?id=1', state: 'LIVE' });
    }
    throw new Error('url inesperada ' + r.url);
  };
  const item = { id: 5, path: '/x.jpg', mime: 'image/jpeg', kind: 'image', width: 1080, height: 1080 };
  const res = await gbp.publish({
    account: { external_id: 'accounts/111/locations/1', access_token: 'tok' }, creds: CREDS, type: 'post',
    caption: 'Novedad en la tienda. Reserva en https://tienda.es/reservas.', media: [item], options: {},
    ctx: { publicUrl: async (m) => `https://tunnel.trycloudflare.com/m/tok/${m.id}.jpg`, ...ctx },
  });
  const body = bodyJson(calls[0]);
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(body.topicType, 'STANDARD');
  assert.equal(body.summary, 'Novedad en la tienda. Reserva en https://tienda.es/reservas.');
  assert.deepEqual(body.callToAction, { actionType: 'LEARN_MORE', url: 'https://tienda.es/reservas' });
  assert.deepEqual(body.media, [{ mediaFormat: 'PHOTO', sourceUrl: 'https://tunnel.trycloudflare.com/m/tok/5.jpg' }]);
  assert.equal(res.external_id, 'accounts/111/locations/1/localPosts/999');
  assert.equal(res.url, 'https://local.google.com/place?id=1');
});

test('gbp: publish solo texto con CTA explícita CALL (sin url) y sin foto', async () => {
  handler = () => json({ name: 'accounts/1/locations/2/localPosts/1' });
  await gbp.publish({
    account: { external_id: 'accounts/1/locations/2', access_token: 't' }, creds: CREDS, type: 'post',
    caption: 'Llámanos', media: [], options: { cta: { actionType: 'CALL' } }, ctx,
  });
  const body = bodyJson(calls[0]);
  assert.deepEqual(body.callToAction, { actionType: 'CALL' });
  assert.equal(body.media, undefined);
});

test('gbp: 403 por API desactivada en publish → error de aprobación (no auth)', async () => {
  handler = () => json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'My Business API has not been used in project 123 before or it is disabled.' } }, 403);
  await assert.rejects(
    gbp.publish({ account: { external_id: 'accounts/1/locations/2', access_token: 't' }, creds: CREDS, type: 'post', caption: 'x', media: [], options: {}, ctx }),
    (e) => e.auth === false && /acceso a la API de Business Profile/.test(e.message),
  );
});

test('gbp: validate', () => {
  assert.deepEqual(gbp.validate({ type: 'post', caption: 'hola', media: [], options: {} }), []);
  assert.equal(gbp.validate({ type: 'post', caption: '', media: [], options: {} }).length, 1);
  assert.equal(gbp.validate({ type: 'post', caption: 'x'.repeat(1501), media: [], options: {} }).length, 1);
  assert.equal(gbp.validate({ type: 'post', caption: 'x', media: [{ kind: 'image' }, { kind: 'image' }], options: {} }).length, 1);
  assert.equal(gbp.validate({ type: 'post', caption: 'x', media: [{ kind: 'video' }], options: {} }).length, 1);
  assert.equal(gbp.validate({ type: 'post', caption: 'x', media: [], options: { cta: { actionType: 'BOOK', url: 'ftp://x' } } }).length, 1);
  assert.deepEqual(gbp.validate({ type: 'reel', caption: '', media: [], options: {} }), []);
});
