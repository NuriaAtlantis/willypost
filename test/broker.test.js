// Tests del servidor central (broker/worker.js) con fetch simulado: sin red real.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import worker, { GRAPH_VERSION } from '../broker/worker.js';
import { GRAPH_VERSION as APP_GRAPH_VERSION } from '../server/providers/facebook.js';

const RELAY = 'https://willypost.com/callback.html';
const AUTH = 'https://auth.willypost.com';
const MEDIA = 'https://media.willypost.com';

const FULL_ENV = {
  META_APP_ID: 'meta-id',
  META_APP_SECRET: 'meta-SECRET',
  META_CONFIG_ID: 'meta-config',
  IG_APP_ID: 'ig-id',
  IG_APP_SECRET: 'ig-SECRET',
  THREADS_APP_ID: 'th-id',
  THREADS_APP_SECRET: 'th-SECRET',
  TIKTOK_CLIENT_KEY: 'tt-key',
  TIKTOK_CLIENT_SECRET: 'tt-SECRET',
  LINKEDIN_CLIENT_ID: 'li-id',
  LINKEDIN_CLIENT_SECRET: 'li-SECRET',
  GOOGLE_CLIENT_ID: 'g-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'g-desktop-secret',
};

/* ---------- utilidades ---------- */
const realFetch = globalThis.fetch;
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const realConsole = {};
let calls;
let logged;
let ipSeq = 0;

beforeEach(() => {
  calls = [];
  logged = [];
  for (const m of consoleMethods) {
    realConsole[m] = console[m];
    console[m] = (...a) => logged.push([m, ...a]);
  }
  globalThis.fetch = async () => {
    throw new Error('fetch no simulado');
  };
});

afterEach(() => {
  for (const m of consoleMethods) console[m] = realConsole[m];
  globalThis.fetch = realFetch;
  assert.deepEqual(logged, [], 'el broker no debe escribir nada en la consola');
});

/** handler(url, init) → Response */
function mockFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, method: (init.method || 'GET').toUpperCase() });
    return handler(String(url), init);
  };
}

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } });

const newIp = () => `203.0.113.${++ipSeq % 250}-${ipSeq}`;

function tokenReq(family, op, body, { method = 'POST', ctype = 'application/json', ip = newIp(), raw } = {}) {
  const init = { method, headers: { 'CF-Connecting-IP': ip } };
  if (ctype) init.headers['Content-Type'] = ctype;
  if (method !== 'GET' && method !== 'HEAD') init.body = raw ?? JSON.stringify(body);
  return new Request(`${AUTH}/token/${family}/${op}`, init);
}

const run = (req, env = FULL_ENV) => worker.fetch(req, env, {});
const formOf = (c) => Object.fromEntries(new URLSearchParams(String(c.init.body)));

/* ---------- /config y /health ---------- */

test('la versión de Graph API del broker coincide con la de la app', () => {
  assert.equal(GRAPH_VERSION, APP_GRAPH_VERSION);
});

test('/config sin variables: sin redes y con los valores por defecto', async () => {
  const res = await run(new Request(`${AUTH}/config`), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { version: 1, relay: RELAY, media: MEDIA, networks: {} });
});

test('/config solo lista las redes configuradas y no filtra secretos (salvo el de escritorio de Google)', async () => {
  const env = { META_APP_ID: 'meta-id', META_APP_SECRET: 'meta-SECRET', IG_APP_ID: 'ig-id', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs', TIKTOK_CLIENT_KEY: ' tt ', TIKTOK_CLIENT_SECRET: 'tt-SECRET\n' };
  const res = await run(new Request(`${AUTH}/config`), env);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body.networks).sort(), ['google', 'meta', 'tiktok']);
  assert.deepEqual(body.networks.meta, { client_id: 'meta-id' });
  assert.deepEqual(body.networks.tiktok, { client_id: 'tt' });
  assert.deepEqual(body.networks.google, { client_id: 'g', client_secret: 'gs' });
  assert.ok(!text.includes('SECRET'));
});

test('/config con todo: config_id de Meta y ningún secreto salvo Google', async () => {
  const res = await run(new Request(`${AUTH}/config`));
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body.networks).sort(), ['google', 'instagram', 'linkedin', 'meta', 'threads', 'tiktok']);
  assert.deepEqual(body.networks.meta, { client_id: 'meta-id', config_id: 'meta-config' });
  assert.equal(body.networks.google.client_secret, 'g-desktop-secret');
  for (const [k, val] of Object.entries(FULL_ENV)) {
    if (k.endsWith('SECRET') && !k.startsWith('GOOGLE')) assert.ok(!text.includes(val), `${k} se ha filtrado`);
  }
});

test('/config respeta RELAY y MEDIA del entorno', async () => {
  const res = await run(new Request(`${AUTH}/config`), { RELAY: 'https://otro.com/cb.html', MEDIA: 'https://m.otro.com' });
  const body = await res.json();
  assert.equal(body.relay, 'https://otro.com/cb.html');
  assert.equal(body.media, 'https://m.otro.com');
});

test('/health', async () => {
  const res = await run(new Request(`${AUTH}/health`), { LINKEDIN_CLIENT_ID: 'a', LINKEDIN_CLIENT_SECRET: 'b', IG_APP_ID: 'solo-id' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { ok: true, networks: ['linkedin'] });
});

test('avisos de Meta: desautorizar y borrar datos sin guardar nada', async () => {
  const form = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'signed_request=abc.def' };
  const d = await run(new Request(`${AUTH}/meta/deauthorize`, form));
  assert.equal(d.status, 200);
  assert.deepEqual(await d.json(), { ok: true });
  const del = await run(new Request(`${AUTH}/meta/delete`, form));
  assert.equal(del.status, 200);
  assert.equal(del.headers.get('cache-control'), 'no-store');
  const body = await del.json();
  assert.equal(body.url, 'https://willypost.com/borrar-datos.html');
  assert.match(body.confirmation_code, /^[0-9a-f]{16}$/);
  const get = await run(new Request(`${AUTH}/meta/delete`));
  assert.equal(get.status, 405);
});

test('/config con POST → 405; ruta desconocida → 404 en JSON', async () => {
  const r1 = await run(new Request(`${AUTH}/config`, { method: 'POST' }));
  assert.equal(r1.status, 405);
  const r2 = await run(new Request(`${AUTH}/nada`));
  assert.equal(r2.status, 404);
  assert.equal((await r2.json()).error, 'willypost_no_encontrado');
});

/* ---------- /token: cada operación de la lista cerrada ---------- */

const CASES = [
  {
    name: 'meta/code',
    family: 'meta', op: 'code',
    body: { code: 'C0DE', redirect_uri: RELAY },
    method: 'GET',
    check: (c) => {
      const u = new URL(c.url);
      assert.equal(`${u.origin}${u.pathname}`, `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
      assert.deepEqual(Object.fromEntries(u.searchParams), { client_id: 'meta-id', client_secret: 'meta-SECRET', redirect_uri: RELAY, code: 'C0DE' });
      assert.equal(c.init.body, undefined);
    },
  },
  {
    name: 'meta/long_lived',
    family: 'meta', op: 'long_lived',
    body: { access_token: 'SHORT' },
    method: 'GET',
    check: (c) => {
      const u = new URL(c.url);
      assert.equal(`${u.origin}${u.pathname}`, `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
      assert.deepEqual(Object.fromEntries(u.searchParams), { grant_type: 'fb_exchange_token', client_id: 'meta-id', client_secret: 'meta-SECRET', fb_exchange_token: 'SHORT' });
    },
  },
  {
    name: 'instagram/code',
    family: 'instagram', op: 'code',
    body: { code: 'IGC', redirect_uri: RELAY },
    method: 'POST',
    check: (c) => {
      assert.equal(c.url, 'https://api.instagram.com/oauth/access_token');
      assert.equal(c.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.deepEqual(formOf(c), { client_id: 'ig-id', client_secret: 'ig-SECRET', grant_type: 'authorization_code', redirect_uri: RELAY, code: 'IGC' });
    },
  },
  {
    name: 'instagram/long_lived',
    family: 'instagram', op: 'long_lived',
    body: { access_token: 'IGSHORT' },
    method: 'GET',
    check: (c) => {
      const u = new URL(c.url);
      assert.equal(`${u.origin}${u.pathname}`, 'https://graph.instagram.com/access_token');
      assert.deepEqual(Object.fromEntries(u.searchParams), { grant_type: 'ig_exchange_token', client_secret: 'ig-SECRET', access_token: 'IGSHORT' });
    },
  },
  {
    name: 'threads/code',
    family: 'threads', op: 'code',
    body: { code: 'THC', redirect_uri: RELAY },
    method: 'POST',
    check: (c) => {
      assert.equal(c.url, 'https://graph.threads.com/oauth/access_token');
      assert.deepEqual(formOf(c), { client_id: 'th-id', client_secret: 'th-SECRET', code: 'THC', grant_type: 'authorization_code', redirect_uri: RELAY });
    },
  },
  {
    name: 'threads/long_lived',
    family: 'threads', op: 'long_lived',
    body: { access_token: 'THSHORT' },
    method: 'GET',
    check: (c) => {
      const u = new URL(c.url);
      assert.equal(`${u.origin}${u.pathname}`, 'https://graph.threads.com/access_token');
      assert.deepEqual(Object.fromEntries(u.searchParams), { grant_type: 'th_exchange_token', client_secret: 'th-SECRET', access_token: 'THSHORT' });
    },
  },
  {
    name: 'tiktok/code',
    family: 'tiktok', op: 'code',
    body: { code: 'TTC', redirect_uri: RELAY, code_verifier: 'v'.repeat(64) },
    method: 'POST',
    check: (c) => {
      assert.equal(c.url, 'https://open.tiktokapis.com/v2/oauth/token/');
      assert.deepEqual(formOf(c), {
        client_key: 'tt-key', client_secret: 'tt-SECRET', code: 'TTC', grant_type: 'authorization_code', redirect_uri: RELAY, code_verifier: 'v'.repeat(64),
      });
    },
  },
  {
    name: 'tiktok/refresh',
    family: 'tiktok', op: 'refresh',
    body: { refresh_token: 'RT' },
    method: 'POST',
    check: (c) => {
      assert.equal(c.url, 'https://open.tiktokapis.com/v2/oauth/token/');
      assert.deepEqual(formOf(c), { client_key: 'tt-key', client_secret: 'tt-SECRET', grant_type: 'refresh_token', refresh_token: 'RT' });
    },
  },
  {
    name: 'linkedin/code',
    family: 'linkedin', op: 'code',
    body: { code: 'LIC', redirect_uri: RELAY },
    method: 'POST',
    check: (c) => {
      assert.equal(c.url, 'https://www.linkedin.com/oauth/v2/accessToken');
      assert.deepEqual(formOf(c), { grant_type: 'authorization_code', code: 'LIC', client_id: 'li-id', client_secret: 'li-SECRET', redirect_uri: RELAY });
    },
  },
];

for (const tc of CASES) {
  test(`token ${tc.name}: llamada oficial exacta y respuesta tal cual`, async () => {
    mockFetch(() => jsonRes({ access_token: 'NEW', expires_in: 3600 }));
    const res = await run(tokenReq(tc.family, tc.op, { ...tc.body, extra: 'se ignora' }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.deepEqual(await res.json(), { access_token: 'NEW', expires_in: 3600 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, tc.method);
    assert.equal(calls[0].init.redirect, 'manual');
    assert.ok(!calls[0].url.includes('extra') && !String(calls[0].init.body || '').includes('extra'));
    tc.check(calls[0]);
  });
}

test('token: el error de la red se devuelve con su mismo código y JSON', async () => {
  const err = { error: { message: 'Invalid verification code format.', type: 'OAuthException', code: 100 } };
  mockFetch(() => jsonRes(err, 400));
  const res = await run(tokenReq('meta', 'code', { code: 'X', redirect_uri: RELAY }));
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), err);
});

test('token: respuesta que no es JSON → 502', async () => {
  mockFetch(() => new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'text/html' } }));
  const res = await run(tokenReq('linkedin', 'code', { code: 'X', redirect_uri: RELAY }));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'willypost_respuesta_no_valida');
});

test('token: la red redirige → 502', async () => {
  mockFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
  const res = await run(tokenReq('linkedin', 'code', { code: 'X', redirect_uri: RELAY }));
  assert.equal(res.status, 502);
});

test('token: la red no responde (tiempo agotado) → 502 en español', async () => {
  mockFetch(() => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  });
  const res = await run(tokenReq('tiktok', 'refresh', { refresh_token: 'RT' }));
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'willypost_red_no_responde');
  assert.match(body.message, /tardado demasiado/);
});

test('token: fallo de red → 502', async () => {
  mockFetch(() => { throw new TypeError('fetch failed'); });
  const res = await run(tokenReq('tiktok', 'refresh', { refresh_token: 'RT' }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).message, /No se ha podido contactar/);
});

/* ---------- /token: validaciones ---------- */

test('redirect_uri distinta del relay → 400 sin llamar a la red', async () => {
  mockFetch(() => jsonRes({}));
  const res = await run(tokenReq('meta', 'code', { code: 'X', redirect_uri: 'https://evil.example/callback.html' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'willypost_redirect_uri_no_valida');
  assert.equal(calls.length, 0);
});

test('redirect_uri con RELAY propio del entorno', async () => {
  mockFetch(() => jsonRes({ ok: 1 }));
  const env = { ...FULL_ENV, RELAY: 'https://otro.com/cb.html' };
  const bad = await run(tokenReq('meta', 'code', { code: 'X', redirect_uri: RELAY }), env);
  assert.equal(bad.status, 400);
  const good = await run(tokenReq('meta', 'code', { code: 'X', redirect_uri: 'https://otro.com/cb.html' }), env);
  assert.equal(good.status, 200);
});

test('operación o familia desconocida → 404', async () => {
  for (const [f, op] of [['meta', 'refresh'], ['google', 'code'], ['nada', 'code'], ['meta', 'constructor'], ['__proto__', 'code'], ['linkedin', 'refresh']]) {
    const res = await run(tokenReq(f, op, { code: 'X', redirect_uri: RELAY }));
    assert.equal(res.status, 404, `${f}/${op}`);
    assert.equal((await res.json()).error, 'willypost_operacion_desconocida');
  }
  assert.equal(calls.length, 0);
});

test('familia sin variables → 404 willypost_no_configurada', async () => {
  const res = await run(tokenReq('tiktok', 'refresh', { refresh_token: 'RT' }), { TIKTOK_CLIENT_KEY: 'solo-key' });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'willypost_no_configurada');
  assert.equal(typeof body.message, 'string');
});

test('cuerpo de más de 16 KB → 413 (por Content-Length y leyendo el cuerpo)', async () => {
  const big = JSON.stringify({ code: 'x'.repeat(17 * 1024), redirect_uri: RELAY });
  const r1 = await run(tokenReq('meta', 'code', null, { raw: big }));
  assert.equal(r1.status, 413);
  assert.equal((await r1.json()).error, 'willypost_demasiado_grande');

  // Sin Content-Length fiable (cuerpo en streaming)
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(big));
      c.close();
    },
  });
  const req = new Request(`${AUTH}/token/meta/code`, {
    method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': newIp() },
  });
  const r2 = await run(req);
  assert.equal(r2.status, 413);
});

test('campo de más de 4 KB → 400', async () => {
  const res = await run(tokenReq('meta', 'code', { code: 'x'.repeat(4097), redirect_uri: RELAY }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'willypost_campo_demasiado_largo');
});

test('método distinto de POST → 405', async () => {
  const res = await run(tokenReq('meta', 'code', null, { method: 'GET' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('Content-Type distinto de JSON → 400', async () => {
  for (const ctype of ['application/x-www-form-urlencoded', 'text/plain', null]) {
    const res = await run(tokenReq('meta', 'code', { code: 'X', redirect_uri: RELAY }, { ctype }));
    assert.equal(res.status, 400, String(ctype));
    assert.equal((await res.json()).error, 'willypost_tipo_no_valido');
  }
  const ok = await run(tokenReq('meta', 'code', { code: 'X', redirect_uri: RELAY }, { ctype: 'application/json; charset=utf-8' }));
  assert.notEqual(ok.status, 400); // pasa la validación (luego falla el fetch simulado → 502)
});

test('JSON mal formado, no objeto o campos que faltan → 400', async () => {
  const bad = [
    ['{nope', 'willypost_json_no_valido'],
    ['[1,2]', 'willypost_json_no_valido'],
    ['null', 'willypost_json_no_valido'],
    [JSON.stringify({ redirect_uri: RELAY }), 'willypost_falta_campo'],
    [JSON.stringify({ code: 5, redirect_uri: RELAY }), 'willypost_falta_campo'],
    [JSON.stringify({ code: '', redirect_uri: RELAY }), 'willypost_falta_campo'],
  ];
  for (const [raw, code] of bad) {
    const res = await run(tokenReq('meta', 'code', null, { raw }));
    assert.equal(res.status, 400, raw);
    assert.equal((await res.json()).error, code, raw);
  }
  const tt = await run(tokenReq('tiktok', 'code', { code: 'X', redirect_uri: RELAY }));
  assert.equal(tt.status, 400); // falta code_verifier
});

test('límite de peticiones por IP → 429', async () => {
  mockFetch(() => jsonRes({ access_token: 'A' }));
  const ip = '198.51.100.77';
  let last;
  for (let i = 0; i < 30; i++) {
    last = await run(tokenReq('tiktok', 'refresh', { refresh_token: 'RT' }, { ip }));
    assert.equal(last.status, 200, `petición ${i + 1}`);
  }
  last = await run(tokenReq('tiktok', 'refresh', { refresh_token: 'RT' }, { ip }));
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), '60');
  assert.equal((await last.json()).error, 'willypost_demasiadas_peticiones');
  // Otra IP sigue pudiendo
  const other = await run(tokenReq('tiktok', 'refresh', { refresh_token: 'RT' }, { ip: '198.51.100.78' }));
  assert.equal(other.status, 200);
});

/* ---------- proxy de medios ---------- */

const SUB = 'happy-blue-fish-tunnel';
const TOKEN = 'a'.repeat(64);
const mediaUrl = (sub = SUB, token = TOKEN, file = 'media.jpg') => `${MEDIA}/t/${sub}/m/${token}/${file}`;

test('medios: reenvía en streaming la foto del túnel', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
  mockFetch(() => new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': '6', 'accept-ranges': 'bytes', 'set-cookie': 'a=b', 'x-secret': 'no' },
  }));
  const res = await run(new Request(`${mediaUrl()}?x=1`, { headers: { Cookie: 'c=d', Authorization: 'Bearer z' } }));
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, `https://${SUB}.trycloudflare.com/m/${TOKEN}/media.jpg`);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(calls[0].init.headers, {}); // no se reenvían cookies ni Authorization
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('content-length'), '6');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('x-secret'), null);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test('medios: Range se pasa y vuelve 206 con Content-Range', async () => {
  mockFetch((url, init) => {
    assert.equal(init.headers.Range, 'bytes=0-1');
    return new Response(new Uint8Array([0, 0]), {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-length': '2', 'content-range': 'bytes 0-1/1000', 'accept-ranges': 'bytes' },
    });
  });
  const res = await run(new Request(mediaUrl(SUB, TOKEN, 'media.mp4'), { headers: { Range: 'bytes=0-1' } }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-1/1000');
  assert.equal(res.headers.get('content-length'), '2');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
});

test('medios: Range mal formado → 400; 416 del túnel se respeta', async () => {
  const r1 = await run(new Request(mediaUrl(), { headers: { Range: 'items=1-2' } }));
  assert.equal(r1.status, 400);
  mockFetch(() => new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } }));
  const r2 = await run(new Request(mediaUrl(), { headers: { Range: 'bytes=50-60' } }));
  assert.equal(r2.status, 416);
  assert.equal(r2.headers.get('content-range'), 'bytes */10');
});

test('medios: HEAD sin cuerpo', async () => {
  mockFetch(() => new Response(null, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '1234' } }));
  const res = await run(new Request(mediaUrl(SUB, TOKEN, 'media.png'), { method: 'HEAD' }));
  assert.equal(res.status, 200);
  assert.equal(calls[0].method, 'HEAD');
  assert.equal(res.headers.get('content-length'), '1234');
  assert.equal(res.body, null);
});

test('medios: subdominio, token o archivo no válidos → 404 sin llamar al túnel', async () => {
  mockFetch(() => jsonRes({}));
  const bad = [
    mediaUrl('ab'), // corto
    mediaUrl('Mayus-cula'),
    mediaUrl('evil.com'),
    mediaUrl('a_b_c'),
    mediaUrl(SUB, 'corto'),
    mediaUrl(SUB, 'a'.repeat(129)),
    mediaUrl(SUB, `${'a'.repeat(20)}.x`),
    mediaUrl(SUB, TOKEN, 'media.svg'),
    mediaUrl(SUB, TOKEN, 'media.html'),
    mediaUrl(SUB, TOKEN, 'otro.jpg'),
    mediaUrl(SUB, TOKEN, 'media.jpg/extra'),
    `${MEDIA}/t/${SUB}/m/${TOKEN}/../../media.jpg`,
    `${MEDIA}/m/${TOKEN}/media.jpg`,
    `${MEDIA}/config`,
    `${MEDIA}/token/meta/code`,
  ];
  for (const u of bad) {
    const res = await run(new Request(u));
    assert.equal(res.status, 404, u);
  }
  assert.equal(calls.length, 0);
});

test('medios: método no permitido → 405', async () => {
  const res = await run(new Request(mediaUrl(), { method: 'POST', body: 'x' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('medios: el túnel redirige → se rechaza (502)', async () => {
  mockFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } }));
  const res = await run(new Request(mediaUrl()));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'willypost_redireccion_no_permitida');
  assert.equal(calls.length, 1);
});

test('medios: tipo que no es foto ni vídeo → 502', async () => {
  for (const type of ['text/html', 'application/json', 'image/svg+xml', '']) {
    mockFetch(() => new Response('<script>', { status: 200, headers: type ? { 'content-type': type } : {} }));
    const res = await run(new Request(mediaUrl()));
    assert.equal(res.status, 502, type);
    assert.equal((await res.json()).error, 'willypost_tipo_no_permitido');
  }
});

test('medios: 404 del túnel → 404; túnel caído → 502', async () => {
  mockFetch(() => new Response(null, { status: 404 }));
  assert.equal((await run(new Request(mediaUrl()))).status, 404);
  mockFetch(() => new Response('x', { status: 500 }));
  assert.equal((await run(new Request(mediaUrl()))).status, 502);
  mockFetch(() => { throw new TypeError('fetch failed'); });
  assert.equal((await run(new Request(mediaUrl()))).status, 502);
});

test('medios: en el host de auth no existe la ruta /t/', async () => {
  mockFetch(() => jsonRes({}));
  const res = await run(new Request(`${AUTH}/t/${SUB}/m/${TOKEN}/media.jpg`));
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

/* ---------- la versión PHP (broker/hostinger/) cumple lo mismo que el Worker ----------
   No hay PHP en las máquinas de desarrollo: se comprueba el código fuente para que las dos versiones no se separen. */

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const JS_SRC = read('../broker/worker.js');
const PHP_AUTH = read('../broker/hostinger/auth/index.php');
const PHP_MEDIA = read('../broker/hostinger/media/index.php');
const PHP_ALL = PHP_AUTH + PHP_MEDIA;

const errorPairs = (src) =>
  new Set([...src.matchAll(/(?:fail\(|\[)\s*(\d{3}),\s*'([a-z_]+)'/g)].map((m) => `${m[1]} ${m[2]}`));
const spanishMessages = (src) =>
  new Set([...src.matchAll(/'([A-ZÁÉÍÓÚ¿][^'\n]{10,}[.?])'/g)].map((m) => m[1]));

test('PHP: misma versión de Graph API', () => {
  assert.match(PHP_AUTH, new RegExp(`const GRAPH_VERSION = '${GRAPH_VERSION.replace('.', '\.')}';`));
});

test('PHP: mismos códigos de error con el mismo estado HTTP', () => {
  const js = errorPairs(JS_SRC);
  const php = errorPairs(PHP_ALL);
  assert.ok(js.size >= 15, `pocos errores encontrados en worker.js: ${[...js]}`);
  assert.deepEqual([...php].sort(), [...js].sort());
});

test('PHP: mismos mensajes en español', () => {
  const js = spanishMessages(JS_SRC);
  const php = spanishMessages(PHP_ALL);
  // Los dos de «falta_campo»/«campo_demasiado_largo» llevan el nombre del campo (plantilla en JS, comillas dobles en PHP)
  for (const f of ['Falta el campo «{$f}» o no es un texto.', 'El campo «{$f}» es demasiado largo.']) assert.ok(PHP_AUTH.includes(f), f);
  for (const f of ['Falta el campo «${f}» o no es un texto.', 'El campo «${f}» es demasiado largo.']) assert.ok(JS_SRC.includes(f), f);
  assert.deepEqual([...php].sort(), [...js].sort());
});

test('PHP: mismas expresiones de validación de medios y mismas llamadas oficiales', () => {
  const unescape = (s) => s.split('\\/').join('/');
  const jsMedia = unescape(JS_SRC.match(/const MEDIA_PATH = \/(.+)\/;/)[1]);
  const phpMedia = PHP_MEDIA.match(/const MEDIA_PATH = '#(.+)#';/)[1];
  assert.equal(phpMedia, jsMedia);
  assert.equal(PHP_MEDIA.match(/const MEDIA_TYPE = '#(.+)#';/)[1], unescape(JS_SRC.match(/const MEDIA_TYPE = \/(.+)\/;/)[1]));
  assert.equal(PHP_MEDIA.match(/const RANGE_RE = '#(.+)#';/)[1], JS_SRC.match(/const RANGE = \/(.+)\/;/)[1]);
  for (const url of [
    'https://api.instagram.com/oauth/access_token',
    'https://graph.instagram.com/access_token?',
    'https://open.tiktokapis.com/v2/oauth/token/',
    'https://www.linkedin.com/oauth/v2/accessToken',
    'https://graph.threads.com',
    "'/oauth/access_token?'",
  ]) {
    assert.ok(PHP_AUTH.includes(url.replace(/^'|'$/g, '')), `PHP sin ${url}`);
  }
  for (const grant of ['fb_exchange_token', 'ig_exchange_token', 'th_exchange_token', 'authorization_code', 'refresh_token']) {
    assert.ok(PHP_AUTH.includes(`'${grant}'`), grant);
  }
  for (const line of ['const MAX_BODY_BYTES = 16 * 1024;', 'const MAX_FIELD_BYTES = 4 * 1024;', 'const RATE_LIMIT = 30;']) {
    assert.ok(PHP_AUTH.includes(line), `PHP: ${line}`);
    assert.ok(JS_SRC.includes(line), `JS: ${line}`);
  }
});

test('PHP: no registra nada ni sigue redirecciones', () => {
  for (const src of [PHP_AUTH, PHP_MEDIA]) {
    for (const bad of ['error_log(', 'syslog(', 'var_dump(', 'print_r(', 'var_export(', 'FOLLOWLOCATION => true']) {
      assert.ok(!src.includes(bad), bad);
    }
    assert.ok(src.includes("ini_set('log_errors', '0')"));
    assert.ok(src.includes('CURLOPT_FOLLOWLOCATION => false') || src.includes('CURLOPT_FOLLOWLOCATION  => false'));
  }
  assert.ok(!/console\./.test(JS_SRC.replace(/\/\/.*$/gm, '')), 'worker.js no debe usar console');
});
