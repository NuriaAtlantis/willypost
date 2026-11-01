// Tests de LinkedIn y Bluesky con fetch simulado (sin red real).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import linkedin, { escapeLittle, LINKEDIN_VERSION } from '../server/providers/linkedin.js';
import bluesky, { buildFacets, graphemeLength } from '../server/providers/bluesky.js';

const realFetch = globalThis.fetch;
let calls;
let handler;
let tmp;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  calls = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-lb-'));
  globalThis.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: (init.method || 'GET').toUpperCase(), headers: { ...(init.headers || {}) }, body: init.body };
    calls.push(rec);
    return handler(rec);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ctx = { log() {}, sleep: async () => {}, pollMs: 1 };
const file = (name, size, fill = 7) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, Buffer.alloc(size, fill));
  return p;
};

/* ============================ LinkedIn ============================ */

const LI_CREDS = { client_id: 'LIID', client_secret: 'LISECRET' };
const LI_ACC = { access_token: 'LITOKEN', external_id: 'abc123', meta: { urn: 'urn:li:person:abc123' } };

test('linkedin: la versión de API es la última documentada (202610) y la 202511 (que se retira el 16-nov-2026) no se usa', () => {
  assert.equal(LINKEDIN_VERSION, '202610');
});

test('linkedin: URL de autorización con relé, state y scopes de perfil personal', () => {
  const u = new URL(linkedin.getAuthUrl({ creds: LI_CREDS, redirectUri: 'https://x.github.io/willypost/callback.html', state: 'ST' }));
  assert.equal(u.origin + u.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('state'), 'ST');
  assert.equal(u.searchParams.get('scope'), 'openid profile w_member_social');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.github.io/willypost/callback.html');
});

test('linkedin: exchangeCode canjea el código y lee el perfil OIDC', async () => {
  handler = (r) => {
    if (r.url === 'https://www.linkedin.com/oauth/v2/accessToken') return json({ access_token: 'AT', expires_in: 5184000, scope: 'openid,profile,w_member_social' });
    if (r.url === 'https://api.linkedin.com/v2/userinfo') return json({ sub: 'abc123', name: 'Ana Pérez', picture: 'https://p/x.jpg', email: 'ana@x.com' });
    throw new Error('url inesperada ' + r.url);
  };
  const [c] = await linkedin.exchangeCode({ creds: LI_CREDS, redirectUri: 'https://r', code: 'CODE' });
  assert.equal(new URLSearchParams(calls[0].body).get('client_secret'), 'LISECRET');
  assert.equal(c.external_id, 'abc123');
  assert.equal(c.meta.urn, 'urn:li:person:abc123');
  assert.ok(Date.parse(c.token_expires_at) > Date.now() + 59 * 86400000);
});

test('linkedin: código rechazado → mensaje en español que dice qué revisar', async () => {
  handler = () => json({ error: 'invalid_redirect_uri', error_description: 'bad' }, 400);
  await assert.rejects(linkedin.exchangeCode({ creds: LI_CREDS, redirectUri: 'https://r', code: 'X' }), (e) => /Client Secret/.test(e.message) && /redirecci/.test(e.message) && e.auth);
});

test('linkedin: escapeLittle escapa lo reservado pero deja los hashtags', () => {
  assert.equal(escapeLittle('Hola (mundo) #buceo_lanzarote 100% [ok] a_b'), 'Hola \\(mundo\\) #buceo_lanzarote 100% \\[ok\\] a\\_b');
  assert.equal(escapeLittle('email@x.com <b>'), 'email\\@x.com \\<b\\>');
});

test('linkedin: post de texto → /rest/posts con cabeceras de versión y urn en x-restli-id', async () => {
  handler = () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:777' } });
  const r = await linkedin.publish({ account: LI_ACC, type: 'post', caption: 'Hola (equipo) #buceo', media: [], ctx });
  assert.equal(r.external_id, 'urn:li:share:777');
  assert.match(r.url, /linkedin\.com\/feed\/update\/urn:li:share:777/);
  const c = calls[0];
  assert.equal(c.url, 'https://api.linkedin.com/rest/posts');
  assert.equal(c.headers['Linkedin-Version'], '202610');
  assert.equal(c.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.equal(c.headers.Authorization, 'Bearer LITOKEN');
  const b = JSON.parse(c.body);
  assert.equal(b.author, 'urn:li:person:abc123');
  assert.equal(b.commentary, 'Hola \\(equipo\\) #buceo');
  assert.equal(b.lifecycleState, 'PUBLISHED');
  assert.equal(b.visibility, 'PUBLIC');
});

test('linkedin: imagen = initializeUpload → PUT binario → post con content.media.id', async () => {
  const img = { id: 1, path: file('a.png', 2000), mime: 'image/png', kind: 'image', original_name: 'a.png' };
  handler = (r) => {
    if (r.url.includes('/rest/images?action=initializeUpload')) return json({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/IMG', image: 'urn:li:image:I1' } });
    if (r.url === 'https://www.linkedin.com/dms-uploads/IMG') return new Response(null, { status: 201 });
    if (r.url.endsWith('/rest/posts')) return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } });
    throw new Error('url inesperada ' + r.url);
  };
  await linkedin.publish({ account: LI_ACC, type: 'post', caption: 'x', media: [img], options: { altText: 'Un buceador' }, ctx });
  assert.equal(JSON.parse(calls[0].body).initializeUploadRequest.owner, 'urn:li:person:abc123');
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].headers['Content-Type'], 'image/png');
  const post = JSON.parse(calls[2].body);
  assert.deepEqual(post.content, { media: { id: 'urn:li:image:I1', altText: 'Un buceador' } });
});

test('linkedin: carrusel = multiImage con 2+ imágenes', async () => {
  const imgs = [1, 2].map((i) => ({ id: i, path: file(`i${i}.jpg`, 500), mime: 'image/jpeg', kind: 'image', original_name: `i${i}.jpg` }));
  let n = 0;
  handler = (r) => {
    if (r.url.includes('initializeUpload')) { n++; return json({ value: { uploadUrl: `https://www.linkedin.com/dms-uploads/${n}`, image: `urn:li:image:I${n}` } }); }
    if (r.url.startsWith('https://www.linkedin.com/dms-uploads/')) return new Response(null, { status: 201 });
    return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:2' } });
  };
  await linkedin.publish({ account: LI_ACC, type: 'carousel', caption: '', media: imgs, ctx });
  const post = JSON.parse(calls.at(-1).body);
  assert.deepEqual(post.content.multiImage.images.map((i) => i.id), ['urn:li:image:I1', 'urn:li:image:I2']);
});

test('linkedin: vídeo en trozos de 4 MB con ETag → finalizeUpload → espera AVAILABLE → post', async () => {
  const size = 5 * 1024 * 1024;
  const vid = { id: 9, path: file('v.mp4', size), mime: 'video/mp4', kind: 'video', original_name: 'v.mp4' };
  let putN = 0;
  handler = (r) => {
    if (r.url.includes('/rest/videos?action=initializeUpload')) {
      return json({ value: { video: 'urn:li:video:V1', uploadToken: 'TOK', uploadInstructions: [
        { firstByte: 0, lastByte: 4194303, uploadUrl: 'https://www.linkedin.com/dms-uploads/p1' },
        { firstByte: 4194304, lastByte: size - 1, uploadUrl: 'https://www.linkedin.com/dms-uploads/p2' },
      ] } });
    }
    if (r.method === 'PUT') { putN++; return new Response(null, { status: 200, headers: { etag: `"etag${putN}"` } }); }
    if (r.url.includes('action=finalizeUpload')) return new Response(null, { status: 200 });
    if (r.url.includes('/rest/videos/urn%3Ali%3Avideo%3AV1')) return json({ status: 'AVAILABLE' });
    if (r.url.endsWith('/rest/posts')) return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:3' } });
    throw new Error('url inesperada ' + r.url);
  };
  const r = await linkedin.publish({ account: LI_ACC, type: 'reel', caption: 'Vídeo', media: [vid], ctx });
  assert.equal(r.external_id, 'urn:li:share:3');
  const init = JSON.parse(calls[0].body).initializeUploadRequest;
  assert.equal(init.fileSizeBytes, size);
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].body.length, 4194304);
  assert.equal(puts[1].body.length, size - 4194304);
  assert.equal(puts[0].headers.Authorization, undefined, 'el PUT de vídeo no lleva Authorization');
  const fin = JSON.parse(calls.find((c) => c.url.includes('finalizeUpload')).body).finalizeUploadRequest;
  assert.deepEqual(fin.uploadedPartIds, ['etag1', 'etag2']);
  assert.equal(fin.uploadToken, 'TOK');
  assert.equal(JSON.parse(calls.at(-1).body).content.media.id, 'urn:li:video:V1');
});

test('linkedin: errores — 401 reconectar, 429 reintentable, 426 versión retirada, 5xx al publicar NO se reintenta solo (evita duplicados)', async () => {
  handler = () => json({ message: 'Invalid access token' }, 401);
  await assert.rejects(linkedin.publish({ account: LI_ACC, type: 'post', caption: 'x', ctx }), (e) => e.auth && /Reconecta/.test(e.message));
  handler = () => json({ message: 'rate' }, 429);
  await assert.rejects(linkedin.publish({ account: LI_ACC, type: 'post', caption: 'x', ctx }), (e) => e.retryable && !e.auth);
  handler = () => json({ message: 'NONEXISTENT_VERSION' }, 426);
  await assert.rejects(linkedin.publish({ account: LI_ACC, type: 'post', caption: 'x', ctx }), (e) => /Actualiza WillyPost/.test(e.message));
  handler = () => json({ message: 'boom' }, 503);
  await assert.rejects(linkedin.publish({ account: LI_ACC, type: 'post', caption: 'x', ctx }), (e) => e.retryable === false && /no podemos saber si tu publicación ha salido/.test(e.message));
});

test('linkedin: validate (3000 caracteres, mezcla, vídeo mp4, carrusel)', () => {
  assert.ok(linkedin.validate({ type: 'post', caption: 'x'.repeat(3001), media: [] }).length);
  assert.deepEqual(linkedin.validate({ type: 'post', caption: 'hola', media: [] }), []);
  assert.ok(linkedin.validate({ type: 'carousel', caption: 'x', media: [{ kind: 'image', mime: 'image/png' }] }).length);
  assert.ok(linkedin.validate({ type: 'reel', caption: 'x', media: [{ kind: 'video', mime: 'video/quicktime' }] }).length, 'mov no vale');
  assert.deepEqual(linkedin.validate({ type: 'reel', caption: 'x', media: [{ kind: 'video', mime: 'video/mp4' }] }), []);
  assert.ok(linkedin.validate({ type: 'post', caption: 'x', media: [{ kind: 'image', mime: 'image/png' }, { kind: 'video', mime: 'video/mp4' }] }).length);
});

/* ============================ Bluesky ============================ */

const jwt = (expSec) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b({ exp: expSec })}.sig`;
};
const BS_ACC = {
  access_token: 'ACCESS', refresh_token: 'REFRESH', username: 'ana.bsky.social',
  meta: { did: 'did:plc:ana', pds: 'https://bsky.social', handle: 'ana.bsky.social' },
};

test('bluesky: graphemeLength cuenta emojis compuestos como 1 y validate usa 300 grafemas', () => {
  assert.equal(graphemeLength('👨‍👩‍👧‍👦'), 1);
  assert.equal(graphemeLength('é'), 1);
  assert.deepEqual(bluesky.validate({ type: 'post', caption: '👨‍👩‍👧‍👦'.repeat(100), media: [] }), []); // 100 grafemas = 2500 bytes
  assert.ok(bluesky.validate({ type: 'post', caption: '👨‍👩‍👧‍👦'.repeat(150), media: [] }).length, 'el límite de 3000 BYTES de Bluesky también cuenta');
  assert.ok(bluesky.validate({ type: 'post', caption: 'a'.repeat(301), media: [] }).length);
  assert.ok(bluesky.validate({ type: 'post', caption: 'x', media: Array.from({ length: 5 }, () => ({ kind: 'image', mime: 'image/png' })) }).length, 'máx. 4 imágenes');
});

test('bluesky: buildFacets usa offsets en BYTES UTF-8 (emojis y tildes antes del enlace)', async () => {
  const text = 'Año 🐠 mira https://atlantislanzarote.com/buceo. #Buceo';
  const facets = await buildFacets(text, { resolveMention: async () => null });
  const link = facets.find((f) => f.features[0].$type.endsWith('#link'));
  const bytes = Buffer.from(text, 'utf8');
  assert.equal(bytes.slice(link.index.byteStart, link.index.byteEnd).toString(), 'https://atlantislanzarote.com/buceo');
  const tag = facets.find((f) => f.features[0].$type.endsWith('#tag'));
  assert.equal(bytes.slice(tag.index.byteStart, tag.index.byteEnd).toString(), '#Buceo');
  assert.equal(tag.features[0].tag, 'Buceo');
});

test('bluesky: connectWithPassword rechaza la contraseña normal sin llamar a la red', async () => {
  handler = () => { throw new Error('no debe llamar a la red'); };
  await assert.rejects(bluesky.connectWithPassword({ handle: 'ana.bsky.social', appPassword: 'MiContraseña123' }), /contraseña de aplicación/);
  assert.equal(calls.length, 0);
});

test('bluesky: connectWithPassword crea sesión, guarda tokens (nunca la contraseña) y caducidad del JWT', async () => {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  handler = (r) => {
    if (r.url === 'https://bsky.social/xrpc/com.atproto.server.createSession') {
      return json({ did: 'did:plc:ana', handle: 'ana.bsky.social', accessJwt: jwt(exp), refreshJwt: 'R', didDoc: { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.host.bsky.network' }] } });
    }
    if (r.url.startsWith('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile')) return json({ displayName: 'Ana', avatar: 'https://a/b.jpg', handle: 'ana.bsky.social' });
    throw new Error('url inesperada ' + r.url);
  };
  const c = await bluesky.connectWithPassword({ handle: '@Ana.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' });
  assert.deepEqual(JSON.parse(calls[0].body), { identifier: 'ana.bsky.social', password: 'abcd-efgh-ijkl-mnop' });
  assert.equal(c.external_id, 'did:plc:ana');
  assert.equal(c.refresh_token, 'R');
  assert.equal(c.token_expires_at, new Date(exp * 1000).toISOString());
  assert.ok(!JSON.stringify(c).includes('abcd-efgh'), 'la contraseña no se guarda');
});

test('bluesky: usuario/contraseña incorrectos → mensaje en español', async () => {
  handler = () => json({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }, 401);
  await assert.rejects(bluesky.connectWithPassword({ handle: 'ana.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' }), /no ha aceptado ese usuario/);
});

test('bluesky: refresh rota refreshJwt; si falla, pide la contraseña de aplicación otra vez', async () => {
  const exp = Math.floor(Date.now() / 1000) + 7200;
  handler = () => json({ accessJwt: jwt(exp), refreshJwt: 'R2' });
  const r = await bluesky.refresh({ account: BS_ACC });
  assert.equal(r.refresh_token, 'R2');
  assert.equal(calls[0].headers.Authorization, 'Bearer REFRESH');
  handler = () => json({ error: 'ExpiredToken', message: 'Token has expired' }, 400);
  await assert.rejects(bluesky.refresh({ account: BS_ACC }), (e) => e.auth && /contraseña de aplicación/.test(e.message));
});

test('bluesky: post con enlace y hashtag → createRecord con facets y langs', async () => {
  handler = () => json({ uri: 'at://did:plc:ana/app.bsky.feed.post/3kabc', cid: 'c' });
  const r = await bluesky.publish({ account: BS_ACC, type: 'post', caption: 'Mira https://atlantislanzarote.com #buceo', media: [], options: { langs: ['es'] }, ctx });
  const b = JSON.parse(calls[0].body);
  assert.equal(b.repo, 'did:plc:ana');
  assert.equal(b.collection, 'app.bsky.feed.post');
  assert.equal(b.record.facets.length, 2);
  assert.deepEqual(b.record.langs, ['es']);
  assert.equal(r.url, 'https://bsky.app/profile/ana.bsky.social/post/3kabc');
});

test('bluesky: imagen de más de 1 MB se comprime por debajo del límite (950 KB) antes de subirla', async () => {
  const sharp = (await import('sharp')).default;
  const big = path.join(tmp, 'big.jpg');
  await sharp({ create: { width: 2000, height: 1500, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 70 } } }).jpeg({ quality: 95 }).toFile(big);
  assert.ok(fs.statSync(big).size > 1_000_000, 'la imagen de prueba debe pasar de 1 MB');
  let uploaded;
  handler = (r) => {
    if (r.url.endsWith('com.atproto.repo.uploadBlob')) { uploaded = r; return json({ blob: { $type: 'blob', ref: { $link: 'bafk' }, mimeType: 'image/jpeg', size: r.body.length } }); }
    return json({ uri: 'at://did:plc:ana/app.bsky.feed.post/3k', cid: 'c' });
  };
  await bluesky.publish({ account: BS_ACC, type: 'post', caption: 'foto', media: [{ id: 1, path: big, mime: 'image/jpeg', kind: 'image', width: 2000, height: 1500, original_name: 'big.jpg' }], options: { altText: 'Mar' }, ctx });
  assert.ok(uploaded.body.length <= 950 * 1024, `subió ${uploaded.body.length} bytes`);
  assert.equal(uploaded.headers['Content-Type'], 'image/jpeg');
  const rec = JSON.parse(calls.at(-1).body).record;
  assert.equal(rec.embed.$type, 'app.bsky.embed.images');
  assert.equal(rec.embed.images[0].alt, 'Mar');
  assert.ok(rec.embed.images[0].aspectRatio.width > 0);
});

test('bluesky: fallo de red justo al crear el post → no se reintenta solo (evita duplicado) y explica qué hacer', async () => {
  handler = () => { throw new Error('socket hang up'); };
  await assert.rejects(bluesky.publish({ account: BS_ACC, type: 'post', caption: 'x', media: [], ctx }), (e) => e.retryable === false && /Reintentar/.test(e.message));
});

test('bluesky: sesión caducada al publicar → auth:true con mensaje en español', async () => {
  handler = () => json({ error: 'ExpiredToken', message: 'Token has expired' }, 400);
  await assert.rejects(bluesky.publish({ account: BS_ACC, type: 'post', caption: 'x', media: [], ctx }), (e) => e.auth && /sesión de Bluesky ha caducado/.test(e.message));
});
