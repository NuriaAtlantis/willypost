// Tests de las correcciones de la revisión final: duplicados al publicar, límites de medios, mensajes en español.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import facebook from '../server/providers/facebook.js';
import instagram from '../server/providers/instagram.js';
import threads, { threadsLength } from '../server/providers/threads.js';
import youtube from '../server/providers/youtube.js';
import gbp from '../server/providers/gbp.js';
import { ProviderError, ambiguousPublish, fetchJson } from '../server/providers/_http.js';
import { fitImage, checkVideoSize } from '../server/providers/_media.js';

const realFetch = globalThis.fetch;
let calls;
let routes;
let tmp;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
/** routes: [[regex sobre "METHOD url", respuesta | (url, init) => respuesta | lanza]] */
function mock(list) {
  routes = list;
}
beforeEach(() => {
  calls = [];
  routes = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-fix-'));
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const u = String(url);
    calls.push({ method, url: u, init });
    for (const [re, h] of routes) {
      if (re.test(`${method} ${u}`)) {
        const out = typeof h === 'function' ? await h(u, init) : h;
        if (out instanceof Response) return out;
        if (out?.__status) return json(out.body, out.__status);
        return json(out);
      }
    }
    throw new Error(`fetch no simulado: ${method} ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ctx = () => ({
  pollMs: 1,
  log() {},
  sleep: async () => {},
  toJpeg: async (item) => ({ path: item.path, mime: 'image/jpeg' }),
  publicUrl: async (item) => `https://demo.trycloudflare.com/m/tok/${path.basename(item.path)}`,
});
const img = (name = 'a.jpg') => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, Buffer.from('fake'));
  return { id: 1, path: p, mime: 'image/jpeg', kind: 'image', width: 1080, height: 1080, original_name: name };
};
const vid = (name = 'v.mp4') => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, Buffer.alloc(2000, 1));
  return { id: 2, path: p, mime: 'video/mp4', kind: 'video', original_name: name };
};

/* ---------------- _http: duplicados y errores ---------------- */

test('ambiguousPublish: red caída o 5xx al crear el post → NO reintentable y con instrucciones; 429/auth se respetan', () => {
  const net = new ProviderError('No se pudo contactar', { retryable: true });
  const out = ambiguousPublish(net, 'Instagram');
  assert.equal(out.retryable, false);
  assert.match(out.message, /Instagram/);
  assert.match(out.message, /Reintentar/);
  const rl = new ProviderError('límite', { retryable: true, rateLimited: true });
  assert.equal(ambiguousPublish(rl, 'X'), rl);
  const au = new ProviderError('token', { auth: true });
  assert.equal(ambiguousPublish(au, 'X'), au);
  const plain = new ProviderError('rechazado');
  assert.equal(ambiguousPublish(plain, 'X'), plain);
});

test('fetchJson: 5xx y 429 salen en español y son reintentables; un 400 con "session" ya no se toma por token caducado', async () => {
  mock([[/GET https:\/\/x\/5xx/, () => json({ error: 'boom' }, 502)], [/GET https:\/\/x\/429/, () => json({}, 429)], [/GET https:\/\/x\/400/, () => json({ message: 'Invalid parameter: session_id missing' }, 400)]]);
  await assert.rejects(fetchJson('https://x/5xx', { label: 'Foo' }), (e) => e.retryable && /problemas ahora mismo/.test(e.message));
  await assert.rejects(fetchJson('https://x/429', { label: 'Foo' }), (e) => e.retryable && e.rateLimited && /más despacio/.test(e.message));
  await assert.rejects(fetchJson('https://x/400', { label: 'Foo' }), (e) => !e.auth && !e.retryable);
});

/* ---------------- _media ---------------- */

test('fitImage: no toca lo que ya cabe; reduce lo que pesa de más y deja una copia JPEG', async () => {
  const small = img();
  assert.equal(await fitImage(small, { maxBytes: 8 * 1024 * 1024, label: 'Instagram' }), small);
  const sharp = (await import('sharp')).default;
  const bigPath = path.join(tmp, 'big.png');
  await sharp({ create: { width: 1800, height: 1800, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 80 } } }).png().toFile(bigPath);
  const size = fs.statSync(bigPath).size;
  assert.ok(size > 2 * 1024 * 1024);
  const out = await fitImage({ id: 7, path: bigPath, mime: 'image/png', kind: 'image', original_name: 'big.png' }, { maxBytes: 2 * 1024 * 1024, label: 'Instagram' });
  assert.notEqual(out.path, bigPath);
  assert.equal(out.mime, 'image/jpeg');
  assert.ok(fs.statSync(out.path).size <= 2 * 1024 * 1024);
  fs.rmSync(out.path, { force: true });
});

test('checkVideoSize: vídeo demasiado grande → error en español con el límite', async () => {
  const v = vid();
  await assert.rejects(checkVideoSize(v, { maxBytes: 1000, label: 'Instagram' }), /pesa .* MB y Instagram admite como máximo/);
  assert.equal(await checkVideoSize(v, { maxBytes: 5000, label: 'Instagram' }), 2000);
});

/* ---------------- Instagram ---------------- */

const IG_ACC = { external_id: '17841', access_token: 'IGT', meta: { username: 'atlantis' } };

test('instagram: contenedor en ERROR con subcódigo 2207026 → explica el formato de vídeo en español', async () => {
  mock([
    [/POST .*graph\.instagram\.com\/v26\.0\/17841\/media$/, { id: 'C1' }],
    [/GET .*\/C1\?/, { status_code: 'ERROR', status: 'Error: Media upload has failed with error code 2207026' }],
  ]);
  await assert.rejects(
    instagram.publish({ account: IG_ACC, type: 'reel', caption: 'x', media: [vid()], ctx: ctx() }),
    (e) => /Formato de vídeo no admitido/.test(e.message) && /el Reel/.test(e.message),
  );
});

test('instagram: si media_publish se corta por la red NO se reintenta solo; si es límite de ritmo (código 4) sí', async () => {
  const base = [
    [/POST .*\/17841\/media$/, { id: 'C1' }],
    [/GET .*\/C1\?/, { status_code: 'FINISHED' }],
  ];
  mock([...base, [/POST .*\/17841\/media_publish$/, () => { throw new Error('ECONNRESET'); }]]);
  await assert.rejects(instagram.publish({ account: IG_ACC, type: 'post', caption: 'x', media: [img()], ctx: ctx() }), (e) => e.retryable === false && /no podemos saber si tu publicación ha salido/.test(e.message));
  mock([...base, [/POST .*\/17841\/media_publish$/, () => json({ error: { code: 4, message: 'Application request limit reached' } }, 400)]]);
  await assert.rejects(instagram.publish({ account: IG_ACC, type: 'post', caption: 'x', media: [img()], ctx: ctx() }), (e) => e.retryable === true && /limitado temporalmente/.test(e.message));
});

test('instagram: cuenta personal → pide pasarla a profesional; ID/secreto mal → explica qué revisar', async () => {
  mock([
    [/POST https:\/\/api\.instagram\.com\/oauth\/access_token/, { data: [{ access_token: 'S', user_id: 5, permissions: 'x' }] }],
    [/GET https:\/\/graph\.instagram\.com\/access_token\?/, { access_token: 'L', expires_in: 5184000 }],
    [/GET .*\/me\?/, { user_id: '5', username: 'ana', account_type: 'PERSONAL' }],
  ]);
  await assert.rejects(instagram.exchangeCode({ creds: { client_id: 'a', client_secret: 'b' }, redirectUri: 'https://r', code: 'c' }), /cuenta profesional/);
  mock([[/POST https:\/\/api\.instagram\.com\/oauth\/access_token/, () => json({ error_type: 'OAuthException', code: 400, error_message: 'Invalid client_secret' }, 400)]]);
  await assert.rejects(instagram.exchangeCode({ creds: { client_id: 'a', client_secret: 'b' }, redirectUri: 'https://r', code: 'c' }), (e) => /ID y el secreto/.test(e.message) && /redirecci/.test(e.message));
});

test('instagram: carrusel de 20 elementos permitido (la doc actual sube el máximo de 10 a 20)', () => {
  const m = Array.from({ length: 20 }, (_, i) => ({ ...img(`c${i}.jpg`), id: i }));
  assert.deepEqual(instagram.validate({ type: 'carousel', caption: '', media: m }), []);
  assert.equal(instagram.limits.carouselMax, 20);
});

/* ---------------- Threads ---------------- */

test('threads: los emojis cuentan por sus bytes UTF-8 (límite de 500 de la doc)', () => {
  assert.equal(threadsLength('a'.repeat(500)), 500);
  assert.equal(threadsLength('🐠'), 4);
  assert.deepEqual(threads.validate({ type: 'post', caption: '🐠'.repeat(125), media: [] }), []);
  assert.ok(threads.validate({ type: 'post', caption: '🐠'.repeat(126), media: [] }).length);
  assert.equal(threadsLength('Año'), 3, 'las tildes cuentan 1');
});

test('threads: error de vídeo INVALID_DURATION → mensaje claro; threads_publish cortado no duplica', async () => {
  const TH = { external_id: '99', access_token: 'TT', meta: { username: 'ana' } };
  mock([
    [/POST .*\/99\/threads$/, { id: 'K1' }],
    [/GET .*\/K1\?/, { status: 'ERROR', error_message: 'INVALID_DURATION' }],
  ]);
  await assert.rejects(threads.publish({ account: TH, type: 'reel', caption: 'x', media: [vid()], ctx: ctx() }), /duración del vídeo no es válida para Threads/);
  mock([
    [/POST .*\/99\/threads$/, { id: 'K2' }],
    [/GET .*\/K2\?/, { status: 'FINISHED' }],
    [/POST .*\/99\/threads_publish$/, () => json({ error: { message: 'boom' } }, 500)],
  ]);
  await assert.rejects(threads.publish({ account: TH, type: 'post', caption: 'hola', media: [], ctx: ctx() }), (e) => e.retryable === false && /Threads/.test(e.message) && /Reintentar/.test(e.message));
});

test('threads: el texto espera a que el contenedor esté FINISHED antes de publicar', async () => {
  const TH = { external_id: '99', access_token: 'TT', meta: { username: 'ana' } };
  let polls = 0;
  mock([
    [/POST .*\/99\/threads$/, { id: 'K3' }],
    [/GET .*\/K3\?/, () => json({ status: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' })],
    [/POST .*\/99\/threads_publish$/, { id: 'P1' }],
    [/GET .*\/P1\?/, { permalink: 'https://www.threads.com/@ana/post/P1' }],
  ]);
  const r = await threads.publish({ account: TH, type: 'post', caption: 'hola', media: [], ctx: ctx() });
  assert.equal(polls, 3);
  assert.equal(r.url, 'https://www.threads.com/@ana/post/P1');
});

/* ---------------- Facebook ---------------- */

const FB_ACC = { external_id: 'PAGE1', access_token: 'PT' };

test('facebook: vídeo del Reel con video_status=upload_failed falla enseguida con explicación (antes esperaba 4 min)', async () => {
  mock([
    [/POST .*\/PAGE1\/video_reels$/, (_u, init) => json(String(init.body).includes('upload_phase=start') ? { video_id: 'V1', upload_url: 'https://rupload.facebook.com/video-upload/v26.0/V1' } : { success: true })],
    [/POST https:\/\/rupload\.facebook\.com/, { success: true }],
    [/GET .*\/V1\?/, { status: { video_status: 'upload_failed' } }],
  ]);
  await assert.rejects(facebook.publish({ account: FB_ACC, type: 'reel', caption: 'x', media: [vid()], ctx: ctx() }), /subida del vídeo a Facebook ha fallado/);
});

test('facebook: publicar texto con 500 no se reintenta solo; código 368 (bloqueo por spam) tampoco', async () => {
  mock([[/POST .*\/PAGE1\/feed$/, () => json({ error: { code: 2, message: 'Service temporarily unavailable' } }, 500)]]);
  await assert.rejects(facebook.publish({ account: FB_ACC, type: 'post', caption: 'x', media: [], ctx: ctx() }), (e) => e.retryable === false && /no podemos saber/.test(e.message));
  mock([[/POST .*\/PAGE1\/feed$/, () => json({ error: { code: 368, message: 'blocked' } }, 400)]]);
  await assert.rejects(facebook.publish({ account: FB_ACC, type: 'post', caption: 'x', media: [], ctx: ctx() }), (e) => !e.retryable && /bloqueado temporalmente/.test(e.message));
});

test('facebook: si ve Páginas pero sin permiso para crear contenido, lo explica (en vez de "no hay Páginas")', async () => {
  mock([
    [/GET .*oauth\/access_token\?.*code=/, { access_token: 'S' }],
    [/GET .*oauth\/access_token\?.*fb_exchange_token/, { access_token: 'L', expires_in: 5000000 }],
    [/GET .*\/me\/accounts/, { data: [{ id: '1', name: 'P', access_token: 'x', tasks: ['ANALYZE'] }] }],
  ]);
  await assert.rejects(facebook.exchangeCode({ creds: { client_id: 'a', client_secret: 'b' }, redirectUri: 'https://r', code: 'c' }), /Administrador/);
});

test('facebook: varias Páginas en varias hojas de /me/accounts se juntan todas', async () => {
  mock([
    [/GET .*oauth\/access_token\?.*code=/, { access_token: 'S' }],
    [/GET .*oauth\/access_token\?.*fb_exchange_token/, { access_token: 'L' }],
    [/GET .*\/me\/accounts\?(?!.*after=)/, { data: [{ id: '1', name: 'A', access_token: 't1', tasks: ['CREATE_CONTENT'] }], paging: { next: 'https://graph.facebook.com/v26.0/me/accounts?after=X&access_token=L' } }],
    [/GET .*\/me\/accounts\?.*after=X/, { data: [{ id: '2', name: 'B', access_token: 't2', tasks: ['CREATE_CONTENT', 'MANAGE'] }] }],
  ]);
  const c = await facebook.exchangeCode({ creds: { client_id: 'a', client_secret: 'b' }, redirectUri: 'https://r', code: 'c' });
  assert.deepEqual(c.map((x) => x.external_id), ['1', '2']);
});

/* ---------------- YouTube / GBP ---------------- */

test('youtube: exige también el permiso de lectura del canal (si el alumno desmarca la casilla, error claro)', async () => {
  mock([[/POST https:\/\/oauth2\.googleapis\.com\/token/, { access_token: 'a', expires_in: 10, refresh_token: 'r', scope: 'https://www.googleapis.com/auth/youtube.upload' }]]);
  await assert.rejects(youtube.exchangeCode({ creds: { client_id: 'a', client_secret: 'b' }, redirectUri: 'http://localhost:4747/oauth/callback', code: 'c' }), /casillas/);
});

test('gbp: red cortada al crear la publicación no se reintenta sola; foto de >5 MB se reduce', async () => {
  const loc = 'accounts/1/locations/2';
  mock([[/POST https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/1\/locations\/2\/localPosts/, () => { throw new Error('ECONNRESET'); }]]);
  await assert.rejects(gbp.publish({ account: { external_id: loc, access_token: 'g' }, type: 'post', caption: 'hola', media: [], ctx: ctx() }), (e) => e.retryable === false && /Google Business Profile/.test(e.message));
  const sharp = (await import('sharp')).default;
  const big = path.join(tmp, 'big.png');
  await sharp({ create: { width: 2400, height: 2400, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 90 } } }).png().toFile(big);
  assert.ok(fs.statSync(big).size > 5 * 1024 * 1024, 'la foto de prueba debe pasar de 5 MB');
  let sent;
  mock([[/POST https:\/\/mybusiness\.googleapis\.com/, (_u, init) => { sent = JSON.parse(init.body); return json({ name: `${loc}/localPosts/9`, searchUrl: 'https://g.co/x' }); }]]);
  const c = ctx();
  const urls = [];
  c.publicUrl = async (item) => { urls.push(fs.statSync(item.path).size); return 'https://demo.trycloudflare.com/m/t/media.jpg'; };
  await gbp.publish({ account: { external_id: loc, access_token: 'g' }, type: 'post', caption: 'foto', media: [{ id: 5, path: big, mime: 'image/png', kind: 'image', width: 2400, height: 2400 }], ctx: c });
  assert.ok(urls[0] <= 5 * 1024 * 1024, `se expuso un fichero de ${urls[0]} bytes`);
  assert.equal(sent.media[0].mediaFormat, 'PHOTO');
});
