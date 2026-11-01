// Tests de los proveedores Meta (Facebook, Instagram, Threads) con fetch simulado: sin red real.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import facebook, { GRAPH_VERSION } from '../server/providers/facebook.js';
import instagram from '../server/providers/instagram.js';
import threads from '../server/providers/threads.js';
import { ProviderError } from '../server/providers/_http.js';

const REDIRECT = 'https://nuriaatlantis.github.io/willypost/callback.html';
const CREDS = { client_id: 'APP123', client_secret: 'SECRET456', extra: {} };

/* ---------- utilidades ---------- */
const realFetch = globalThis.fetch;
let calls;
let tmp;

/** routes: [[regex sobre "METHOD url", handler(url, init) => objeto | {__status, body}]] — se usa el primero que encaje. */
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const u = String(url);
    calls.push({ method, url: u, init, parsed: new URL(u) });
    for (const [re, handler] of routes) {
      if (re.test(`${method} ${u}`)) {
        const out = typeof handler === 'function' ? await handler(u, init) : handler;
        const status = out?.__status ?? 200;
        const body = out?.__status ? out.body : out;
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error(`fetch no simulado: ${method} ${u}`);
  };
}

const formOf = (c) => Object.fromEntries(new URLSearchParams(String(c.init.body)));
const seq = (list) => list.map((c) => `${c.method} ${c.parsed.host}${c.parsed.pathname}`);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-meta-'));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mediaFiles(n, { kind = 'image', mime = 'image/jpeg', ext = 'jpg' } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const p = path.join(tmp, `m${i}.${ext}`);
    fs.writeFileSync(p, Buffer.from(`fake-${i}`));
    return { id: i + 1, path: p, mime, kind, width: 1080, height: 1080, original_name: `m${i}.${ext}` };
  });
}

function makeCtx() {
  const urls = [];
  return {
    urls,
    pollMs: 1,
    log() {},
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2))),
    toJpeg: async (item) => ({ path: item.path, mime: 'image/jpeg' }),
    publicUrl: async (item) => {
      const u = `https://demo.trycloudflare.com/m/tok/${path.basename(item.path)}`;
      urls.push(u);
      return u;
    },
  };
}

/* ======================= metadatos del contrato ======================= */
test('contrato: campos obligatorios y familias', () => {
  for (const [p, family] of [[facebook, 'meta'], [instagram, 'instagram'], [threads, 'threads']]) {
    for (const k of ['id', 'label', 'color', 'family', 'authType', 'redirect', 'supports', 'limits', 'notes']) {
      assert.ok(k in p, `${p.id} sin ${k}`);
    }
    assert.equal(p.family, family);
    assert.equal(p.redirect, 'relay');
    for (const f of ['getAuthUrl', 'exchangeCode', 'refresh', 'validate', 'publish']) assert.equal(typeof p[f], 'function');
  }
  assert.equal(threads.supports.story, false);
  assert.equal(instagram.supports.textOnly, false);
});

/* ======================= Facebook ======================= */
test('facebook: URL de autorización', () => {
  const u = new URL(facebook.getAuthUrl({ creds: CREDS, redirectUri: REDIRECT, state: 'st1' }));
  assert.equal(u.origin + u.pathname, `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  assert.equal(u.searchParams.get('client_id'), 'APP123');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('state'), 'st1');
  assert.equal(u.searchParams.get('response_type'), 'code');
  const scopes = u.searchParams.get('scope').split(',');
  for (const s of ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'publish_video']) assert.ok(scopes.includes(s), s);
});

test('facebook: config_id opcional (Facebook Login for Business) sustituye a scope', () => {
  const u = new URL(facebook.getAuthUrl({ creds: { ...CREDS, extra: { config_id: 'CFG1' } }, redirectUri: REDIRECT, state: 's' }));
  assert.equal(u.searchParams.get('config_id'), 'CFG1');
  assert.equal(u.searchParams.get('scope'), null);
});

test('facebook: exchangeCode → token largo → una candidata por Página', async () => {
  mockFetch([
    [/oauth\/access_token\?.*code=CODE1/, { access_token: 'SHORT', expires_in: 3600 }],
    [/oauth\/access_token\?.*fb_exchange_token=SHORT/, { access_token: 'LONG', expires_in: 5184000 }],
    [/\/me\/accounts/, {
      data: [
        { id: '111', name: 'Página A', access_token: 'PT_A', tasks: ['CREATE_CONTENT', 'MANAGE'], picture: { data: { url: 'https://img/a.jpg' } } },
        { id: '222', name: 'Página B', access_token: 'PT_B', tasks: ['ANALYZE'] }, // sin permiso de publicar: se descarta
        { id: '333', name: 'Página C', access_token: 'PT_C', username: 'paginac' },
      ],
    }],
  ]);
  const cands = await facebook.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'CODE1#_' });
  assert.deepEqual(cands.map((c) => c.external_id), ['111', '333']);
  assert.equal(cands[0].access_token, 'PT_A');
  assert.equal(cands[0].avatar_url, 'https://img/a.jpg');
  assert.equal(cands[1].username, 'paginac');
  // secuencia y parámetros
  assert.deepEqual(seq(calls), [
    `GET graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
    `GET graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
    `GET graph.facebook.com/${GRAPH_VERSION}/me/accounts`,
  ]);
  assert.equal(calls[0].parsed.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(calls[0].parsed.searchParams.get('client_secret'), 'SECRET456');
  assert.equal(calls[0].parsed.searchParams.get('code'), 'CODE1'); // sin "#_"
  assert.equal(calls[1].parsed.searchParams.get('grant_type'), 'fb_exchange_token');
  assert.equal(calls[2].parsed.searchParams.get('access_token'), 'LONG');
});

test('facebook: carrusel = fotos con published=false + /feed con attached_media', async () => {
  let n = 0;
  mockFetch([
    [/POST .*\/777\/photos/, () => ({ id: `PH${++n}` })],
    [/POST .*\/777\/feed/, { id: '777_999' }],
    [/GET .*\/777_999\?.*permalink_url/, { permalink_url: 'https://www.facebook.com/777/posts/999' }],
  ]);
  const media = mediaFiles(3);
  const out = await facebook.publish({
    account: { external_id: '777', access_token: 'PT' }, creds: CREDS,
    type: 'carousel', caption: 'Hola', media, options: {}, ctx: makeCtx(),
  });
  assert.deepEqual(out, { external_id: '777_999', url: 'https://www.facebook.com/777/posts/999' });
  assert.deepEqual(seq(calls).slice(0, 4), [
    `POST graph.facebook.com/${GRAPH_VERSION}/777/photos`,
    `POST graph.facebook.com/${GRAPH_VERSION}/777/photos`,
    `POST graph.facebook.com/${GRAPH_VERSION}/777/photos`,
    `POST graph.facebook.com/${GRAPH_VERSION}/777/feed`,
  ]);
  for (const c of calls.slice(0, 3)) {
    assert.ok(c.init.body instanceof FormData);
    assert.equal(c.init.body.get('published'), 'false');
    assert.ok(c.init.body.get('source'));
    assert.equal(c.init.body.get('access_token'), 'PT');
  }
  const feed = formOf(calls[3]);
  assert.equal(feed.message, 'Hola');
  assert.equal(feed['attached_media[0]'], JSON.stringify({ media_fbid: 'PH1' }));
  assert.equal(feed['attached_media[2]'], JSON.stringify({ media_fbid: 'PH3' }));
});

test('facebook: reel en 3 fases (start → rupload binario → finish)', async () => {
  mockFetch([
    [/POST .*\/777\/video_reels/, (u, init) => (formOf({ init }).upload_phase === 'start'
      ? { video_id: 'VID1', upload_url: 'https://rupload.facebook.com/video-upload/VID1' }
      : { success: true })],
    [/POST https:\/\/rupload\.facebook\.com/, { success: true }],
    [/GET .*\/VID1\?/, { status: { video_status: 'ready', publishing_phase: { status: 'complete' } } }],
  ]);
  const [video] = mediaFiles(1, { kind: 'video', mime: 'video/mp4', ext: 'mp4' });
  const out = await facebook.publish({
    account: { external_id: '777', access_token: 'PT' }, creds: CREDS,
    type: 'reel', caption: 'Mi reel #x', media: [video], options: {}, ctx: makeCtx(),
  });
  assert.equal(out.external_id, 'VID1');
  assert.equal(out.url, 'https://www.facebook.com/reel/VID1');
  assert.equal(calls[0].url.includes('/777/video_reels'), true);
  assert.equal(formOf(calls[0]).upload_phase, 'start');
  const up = calls[1];
  assert.equal(up.parsed.host, 'rupload.facebook.com');
  assert.equal(up.init.headers.Authorization, 'OAuth PT');
  assert.equal(up.init.headers.offset, '0');
  assert.equal(up.init.headers.file_size, String(fs.statSync(video.path).size));
  const fin = formOf(calls[2]);
  assert.equal(fin.upload_phase, 'finish');
  assert.equal(fin.video_state, 'PUBLISHED');
  assert.equal(fin.description, 'Mi reel #x');
  assert.equal(fin.video_id, 'VID1');
});

test('facebook: story rechazada por la API → mensaje "publica esta story a mano"', async () => {
  mockFetch([
    [/POST .*\/777\/photos/, { id: 'PH1' }],
    [/POST .*\/777\/photo_stories/, { __status: 400, body: { error: { message: 'Unsupported post request', code: 100, type: 'GraphMethodException' } } }],
  ]);
  const media = mediaFiles(1);
  await assert.rejects(
    facebook.publish({ account: { external_id: '777', access_token: 'PT' }, creds: CREDS, type: 'story', caption: '', media, options: {}, ctx: makeCtx() }),
    (e) => e instanceof ProviderError && /publica esta story a mano/i.test(e.message) && e.auth === false && e.retryable === false,
  );
});

test('facebook: error 190 → auth:true; código 4 → retryable', async () => {
  mockFetch([[/POST .*\/777\/feed/, { __status: 400, body: { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } } }]]);
  await assert.rejects(
    facebook.publish({ account: { external_id: '777', access_token: 'PT' }, creds: CREDS, type: 'post', caption: 'x', media: [], options: {}, ctx: makeCtx() }),
    (e) => e.auth === true && /reconecta la cuenta en Redes/.test(e.message),
  );
  mockFetch([[/POST .*\/777\/feed/, { __status: 400, body: { error: { message: 'Rate limit', code: 4 } } }]]);
  await assert.rejects(
    facebook.publish({ account: { external_id: '777', access_token: 'PT' }, creds: CREDS, type: 'post', caption: 'x', media: [], options: {}, ctx: makeCtx() }),
    (e) => e.retryable === true && e.auth === false,
  );
});

test('facebook: validate', () => {
  assert.deepEqual(facebook.validate({ type: 'post', caption: 'solo texto', media: [] }), []);
  assert.ok(facebook.validate({ type: 'carousel', caption: '', media: mediaFiles(1) }).length);
  assert.ok(facebook.validate({ type: 'reel', caption: '', media: mediaFiles(1) }).length); // imagen, no vídeo
  assert.deepEqual(facebook.validate({ type: 'reel', caption: '', media: mediaFiles(1, { kind: 'video', mime: 'video/mp4', ext: 'mp4' }) }), []);
});

/* ======================= Instagram ======================= */
test('instagram: URL de autorización', () => {
  const u = new URL(instagram.getAuthUrl({ creds: CREDS, redirectUri: REDIRECT, state: 'st2' }));
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'APP123');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('state'), 'st2');
  assert.equal(u.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish');
});

test('instagram: exchangeCode corto → largo → perfil', async () => {
  mockFetch([
    [/POST https:\/\/api\.instagram\.com\/oauth\/access_token/, { data: [{ access_token: 'IGSHORT', user_id: '1784', permissions: 'a,b' }] }],
    [/GET https:\/\/graph\.instagram\.com\/access_token/, { access_token: 'IGLONG', token_type: 'bearer', expires_in: 5184000 }],
    [/GET https:\/\/graph\.instagram\.com\/v[\d.]+\/me/, { user_id: '1784', username: 'willyseo', profile_picture_url: 'https://img/p.jpg', account_type: 'BUSINESS' }],
  ]);
  const [c] = await instagram.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'IGCODE#_' });
  assert.equal(c.external_id, '1784');
  assert.equal(c.username, 'willyseo');
  assert.equal(c.access_token, 'IGLONG');
  assert.equal(c.avatar_url, 'https://img/p.jpg');
  assert.ok(Date.parse(c.token_expires_at) > Date.now() + 59 * 864e5);
  const first = formOf(calls[0]);
  assert.deepEqual(
    { ...first },
    { client_id: 'APP123', client_secret: 'SECRET456', grant_type: 'authorization_code', redirect_uri: REDIRECT, code: 'IGCODE' },
  );
  assert.equal(calls[1].parsed.searchParams.get('grant_type'), 'ig_exchange_token');
  assert.equal(calls[1].parsed.searchParams.get('access_token'), 'IGSHORT');
  assert.equal(calls[2].parsed.searchParams.get('access_token'), 'IGLONG');
  assert.match(calls[2].parsed.searchParams.get('fields'), /user_id,username/);
});

test('instagram: refresh respeta las 24 h y llama a refresh_access_token', async () => {
  const fresh = { access_token: 'T', token_expires_at: new Date(Date.now() + 60 * 864e5 - 3600e3).toISOString() }; // creado hace 1 h
  assert.equal(await instagram.refresh({ account: fresh, creds: CREDS }), null);
  const old = { access_token: 'T', token_expires_at: new Date(Date.now() + 10 * 864e5).toISOString() };
  mockFetch([[/GET https:\/\/graph\.instagram\.com\/refresh_access_token/, { access_token: 'T2', expires_in: 5184000 }]]);
  const r = await instagram.refresh({ account: old, creds: CREDS });
  assert.equal(r.access_token, 'T2');
  assert.equal(calls[0].parsed.searchParams.get('grant_type'), 'ig_refresh_token');
  const dead = { access_token: 'T', token_expires_at: new Date(Date.now() - 1000).toISOString() };
  await assert.rejects(instagram.refresh({ account: dead, creds: CREDS }), (e) => e.auth === true);
});

test('instagram: carrusel = hijos is_carousel_item → CAROUSEL → media_publish → permalink', async () => {
  let n = 0;
  mockFetch([
    [/POST .*\/1784\/media_publish/, { id: 'MEDIA9' }],
    [/POST .*\/1784\/media$/, () => ({ id: `C${++n}` })],
    [/GET .*\/C\d\?.*status_code/, { status_code: 'FINISHED' }],
    [/GET .*\/MEDIA9\?.*permalink/, { permalink: 'https://www.instagram.com/p/ABC/' }],
  ]);
  const ctx = makeCtx();
  const media = mediaFiles(3, { mime: 'image/png', ext: 'png' });
  const out = await instagram.publish({
    account: { external_id: '1784', access_token: 'IGLONG', meta: {} }, creds: CREDS,
    type: 'carousel', caption: 'Texto', media, options: {}, ctx,
  });
  assert.deepEqual(out, { external_id: 'MEDIA9', url: 'https://www.instagram.com/p/ABC/' });
  assert.equal(ctx.urls.length, 3);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 5); // 3 hijos + padre + media_publish
  for (const c of posts.slice(0, 3)) {
    const f = formOf(c);
    assert.equal(f.is_carousel_item, 'true');
    assert.match(f.image_url, /^https:\/\/demo\.trycloudflare\.com\//);
    assert.equal(f.access_token, 'IGLONG');
  }
  const parent = formOf(posts[3]);
  assert.equal(parent.media_type, 'CAROUSEL');
  assert.equal(parent.children, 'C1,C2,C3');
  assert.equal(parent.caption, 'Texto');
  assert.ok(posts[3].url.startsWith('https://graph.instagram.com/'));
  assert.equal(formOf(posts[4]).creation_id, 'C4');
  assert.ok(posts[4].url.endsWith('/1784/media_publish'));
  // orden exacto: cada contenedor se crea y se consulta antes de seguir; media_publish va el último
  const kinds = calls.map((c) => (c.method === 'GET' ? (c.url.includes('permalink') ? 'permalink' : 'status') : c.url.includes('media_publish') ? 'publish' : 'create'));
  assert.deepEqual(kinds, ['create', 'status', 'create', 'status', 'create', 'status', 'create', 'status', 'publish', 'permalink']);
});

test('instagram: reel con polling hasta FINISHED y error de contenedor', async () => {
  let polls = 0;
  mockFetch([
    [/POST .*\/1784\/media_publish/, { id: 'R1' }],
    [/POST .*\/1784\/media$/, { id: 'CR1' }],
    [/GET .*\/CR1\?/, () => (++polls < 3 ? { status_code: 'IN_PROGRESS' } : { status_code: 'FINISHED' })],
    [/GET .*\/R1\?/, { permalink: 'https://www.instagram.com/reel/XYZ/' }],
  ]);
  const [video] = mediaFiles(1, { kind: 'video', mime: 'video/mp4', ext: 'mp4' });
  const out = await instagram.publish({
    account: { external_id: '1784', access_token: 'T', meta: {} }, creds: CREDS, type: 'reel', caption: 'c', media: [video], options: {}, ctx: makeCtx(),
  });
  assert.equal(out.url, 'https://www.instagram.com/reel/XYZ/');
  const create = formOf(calls.find((c) => c.method === 'POST'));
  assert.equal(create.media_type, 'REELS');
  assert.equal(create.share_to_feed, 'true');
  assert.match(create.video_url, /m0\.mp4$/);
  assert.equal(polls, 3);

  mockFetch([
    [/POST .*\/1784\/media$/, { id: 'CR2' }],
    [/GET .*\/CR2\?/, { status_code: 'ERROR', status: 'Error: Media upload has failed' }],
  ]);
  await assert.rejects(
    instagram.publish({ account: { external_id: '1784', access_token: 'T', meta: {} }, creds: CREDS, type: 'reel', caption: '', media: [video], options: {}, ctx: makeCtx() }),
    (e) => e instanceof ProviderError && /Media upload has failed/.test(e.message),
  );
});

test('instagram: story y post usan image_url JPEG', async () => {
  mockFetch([
    [/POST .*\/1784\/media_publish/, { id: 'S1' }],
    [/POST .*\/1784\/media$/, { id: 'CS1' }],
    [/GET .*\/CS1\?/, { status_code: 'FINISHED' }],
    [/GET .*\/S1\?/, { permalink: 'https://www.instagram.com/stories/x/1/' }],
  ]);
  const media = mediaFiles(1);
  await instagram.publish({ account: { external_id: '1784', access_token: 'T', meta: {} }, creds: CREDS, type: 'story', caption: 'ignorado', media, options: {}, ctx: makeCtx() });
  const f = formOf(calls.find((c) => c.method === 'POST'));
  assert.equal(f.media_type, 'STORIES');
  assert.ok(f.image_url);
  assert.equal(f.caption, undefined);
});

test('instagram: validate', () => {
  assert.ok(instagram.validate({ type: 'post', caption: 'x', media: [] }).length, 'sin medios');
  assert.ok(instagram.validate({ type: 'post', caption: 'x'.repeat(2201), media: mediaFiles(1) }).length);
  assert.ok(instagram.validate({ type: 'post', caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), media: mediaFiles(1) }).length);
  assert.ok(instagram.validate({ type: 'carousel', caption: '', media: mediaFiles(1) }).length);
  assert.ok(instagram.validate({ type: 'carousel', caption: '', media: mediaFiles(21) }).length);
  assert.deepEqual(instagram.validate({ type: 'carousel', caption: '', media: mediaFiles(20) }), []); // la doc actual admite 20
  assert.ok(instagram.validate({ type: 'reel', caption: '', media: mediaFiles(1) }).length, 'reel con imagen');
  assert.ok(instagram.validate({ type: 'story', caption: '', media: mediaFiles(2) }).length);
  assert.deepEqual(instagram.validate({ type: 'story', caption: '', media: mediaFiles(1) }), []);
});

/* ======================= Threads ======================= */
test('threads: URL de autorización', () => {
  const u = new URL(threads.getAuthUrl({ creds: CREDS, redirectUri: REDIRECT, state: 'st3' }));
  assert.equal(u.origin + u.pathname, 'https://threads.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'APP123');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('scope'), 'threads_basic,threads_content_publish');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('state'), 'st3');
});

test('threads: exchangeCode corto → th_exchange_token → perfil', async () => {
  mockFetch([
    [/POST https:\/\/graph\.threads\.com\/oauth\/access_token/, { access_token: 'THSHORT', user_id: '55' }],
    [/GET https:\/\/graph\.threads\.com\/access_token/, { access_token: 'THLONG', token_type: 'bearer', expires_in: 5183944 }],
    [/GET https:\/\/graph\.threads\.com\/v1\.0\/me/, { id: '55', username: 'willy', threads_profile_picture_url: 'https://img/t.jpg' }],
  ]);
  const [c] = await threads.exchangeCode({ creds: CREDS, redirectUri: REDIRECT, code: 'TCODE#_' });
  assert.equal(c.external_id, '55');
  assert.equal(c.username, 'willy');
  assert.equal(c.access_token, 'THLONG');
  assert.equal(c.avatar_url, 'https://img/t.jpg');
  assert.equal(formOf(calls[0]).code, 'TCODE');
  assert.equal(formOf(calls[0]).grant_type, 'authorization_code');
  assert.equal(calls[1].parsed.searchParams.get('grant_type'), 'th_exchange_token');
  assert.equal(calls[1].parsed.searchParams.get('client_secret'), 'SECRET456');
});

test('threads: refresh usa th_refresh_token', async () => {
  mockFetch([[/GET https:\/\/graph\.threads\.com\/refresh_access_token/, { access_token: 'TH2', expires_in: 5183944 }]]);
  const r = await threads.refresh({ account: { access_token: 'TH', token_expires_at: new Date(Date.now() + 20 * 864e5).toISOString() }, creds: CREDS });
  assert.equal(r.access_token, 'TH2');
  assert.equal(calls[0].parsed.searchParams.get('grant_type'), 'th_refresh_token');
});

test('threads: carrusel = hijos is_carousel_item → CAROUSEL → threads_publish → permalink', async () => {
  let n = 0;
  mockFetch([
    [/POST .*\/55\/threads_publish/, { id: 'TP1' }],
    [/POST .*\/55\/threads$/, () => ({ id: `TC${++n}` })],
    [/GET .*\/TC\d\?.*status/, { status: 'FINISHED' }],
    [/GET .*\/TP1\?.*permalink/, { permalink: 'https://www.threads.com/@willy/post/AAA' }],
  ]);
  const ctx = makeCtx();
  const media = mediaFiles(2);
  const out = await threads.publish({
    account: { external_id: '55', access_token: 'THLONG', meta: {} }, creds: CREDS,
    type: 'carousel', caption: 'Hola Threads', media, options: {}, ctx,
  });
  assert.deepEqual(out, { external_id: 'TP1', url: 'https://www.threads.com/@willy/post/AAA' });
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 4); // 2 hijos + padre + publish
  assert.equal(formOf(posts[0]).is_carousel_item, 'true');
  assert.equal(formOf(posts[0]).media_type, 'IMAGE');
  assert.match(formOf(posts[0]).image_url, /^https:\/\/demo\.trycloudflare\.com\//);
  const parent = formOf(posts[2]);
  assert.equal(parent.media_type, 'CAROUSEL');
  assert.equal(parent.children, 'TC1,TC2');
  assert.equal(parent.text, 'Hola Threads');
  assert.equal(formOf(posts[3]).creation_id, 'TC3');
  assert.ok(posts[3].url.endsWith('/55/threads_publish'));
});

test('threads: texto solo y límites', async () => {
  mockFetch([
    [/POST .*\/55\/threads_publish/, { id: 'T9' }],
    [/POST .*\/55\/threads$/, { id: 'TX1' }],
    [/GET .*\/T9\?/, { permalink: 'https://www.threads.com/@w/post/Z' }],
  ]);
  const out = await threads.publish({ account: { external_id: '55', access_token: 'T', meta: {} }, creds: CREDS, type: 'post', caption: 'hola', media: [], options: {}, ctx: makeCtx() });
  assert.equal(out.external_id, 'T9');
  assert.equal(formOf(calls[0]).media_type, 'TEXT');
  assert.equal(formOf(calls[0]).text, 'hola');

  assert.ok(threads.validate({ type: 'post', caption: 'x'.repeat(501), media: [] }).length);
  assert.deepEqual(threads.validate({ type: 'post', caption: 'x'.repeat(500), media: [] }), []);
  assert.ok(threads.validate({ type: 'carousel', caption: '', media: mediaFiles(1) }).length);
  assert.ok(threads.validate({ type: 'carousel', caption: '', media: mediaFiles(21) }).length);
  assert.deepEqual(threads.validate({ type: 'carousel', caption: '', media: mediaFiles(20) }), []);
});

test('threads: story no soportada y error 190 → auth', async () => {
  await assert.rejects(
    threads.publish({ account: { external_id: '55', access_token: 'T', meta: {} }, creds: CREDS, type: 'story', caption: '', media: mediaFiles(1), options: {}, ctx: makeCtx() }),
    (e) => e instanceof ProviderError,
  );
  mockFetch([[/POST .*\/55\/threads$/, { __status: 400, body: { error: { message: 'Invalid OAuth access token', code: 190 } } }]]);
  await assert.rejects(
    threads.publish({ account: { external_id: '55', access_token: 'T', meta: {} }, creds: CREDS, type: 'post', caption: 'x', media: [], options: {}, ctx: makeCtx() }),
    (e) => e.auth === true && /Threads ha caducado/.test(e.message),
  );
});
