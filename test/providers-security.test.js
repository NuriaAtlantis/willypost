// Seguridad de OAuth, relé y servidor público de medios. Sin red real y SIN lanzar el túnel de Cloudflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-sec-'));
const SHARE_PORT = 4826;
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_SHARE_PORT = String(SHARE_PORT);
process.env.WILLYPOST_PORT = '4825';
process.env.WILLYPOST_PUBLIC_BASE = 'https://publico.example.test'; // evita abrir el túnel de Cloudflare

const share = await import('../server/share.js');
const { db, run, get } = await import('../server/db.js').then((m) => ({ db: m.db, run: m.run, get: m.get }));
const oauth = await import('../server/oauth.js');
const { RELAY_URL, LOCAL_REDIRECT } = await import('../server/config.js');

const realFetch = globalThis.fetch;
let shareServer;
const files = [];
before(() => { shareServer = share.startShareServer(); });
after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => { shareServer.close(r); shareServer.closeAllConnections?.(); });
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

/* ======================= servidor público de medios (share.js) ======================= */

function tmpMedia(bytes, name = 'f.jpg') {
  const p = path.join(dataDir, `${crypto.randomBytes(4).toString('hex')}-${name}`);
  fs.writeFileSync(p, bytes);
  files.push(p);
  return p;
}
const tokenOf = (url) => /\/m\/([a-f0-9]{64})\//.exec(url)[1];

/** Petición cruda con el path EXACTO (fetch/URL lo normalizarían). */
function raw(pathStr, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: SHARE_PORT, path: pathStr, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('share: los tokens son de 32 bytes aleatorios (64 hex), distintos cada vez, y la URL solo expone /m/<token>/media.ext', async () => {
  const p = tmpMedia(Buffer.alloc(100, 1));
  const urls = await Promise.all(Array.from({ length: 40 }, () => share.publicUrl({ path: p, mime: 'image/jpeg' })));
  const tokens = new Set(urls.map(tokenOf));
  assert.equal(tokens.size, 40);
  for (const u of urls) assert.match(u, /^https:\/\/publico\.example\.test\/m\/[a-f0-9]{64}\/media\.jpg$/);
});

test('share: sirve el fichero con cabeceras seguras y soporta HEAD', async () => {
  const body = crypto.randomBytes(1000);
  const url = await share.publicUrl({ path: tmpMedia(body), mime: 'image/jpeg' });
  const p = new URL(url).pathname;
  const r = await raw(p);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, body);
  assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['accept-ranges'], 'bytes');
  const h = await raw(p, { method: 'HEAD' });
  assert.equal(h.status, 200);
  assert.equal(h.headers['content-length'], '1000');
  assert.equal(h.body.length, 0);
});

test('share: Range — tramo, hasta el final, últimos N (incluso N > tamaño), inválido → 416, varios tramos → fichero entero', async () => {
  const body = crypto.randomBytes(1000);
  const p = new URL(await share.publicUrl({ path: tmpMedia(body), mime: 'video/mp4' })).pathname;
  let r = await raw(p, { headers: { Range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-9/1000');
  assert.deepEqual(r.body, body.subarray(0, 10));
  r = await raw(p, { headers: { Range: 'bytes=990-' } });
  assert.deepEqual(r.body, body.subarray(990));
  r = await raw(p, { headers: { Range: 'bytes=-10' } });
  assert.equal(r.headers['content-range'], 'bytes 990-999/1000');
  r = await raw(p, { headers: { Range: 'bytes=-5000' } }); // antes daba start negativo
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-999/1000');
  assert.deepEqual(r.body, body);
  r = await raw(p, { headers: { Range: 'bytes=5000-6000' } });
  assert.equal(r.status, 416);
  r = await raw(p, { headers: { Range: 'bytes=-' } });
  assert.equal(r.status, 416);
  r = await raw(p, { headers: { Range: 'bytes=0-1,5-9' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1000);
});

test('share: token falso, ruta fuera de /m, método no permitido y token caducado → 404/405, sin filtrar nada', async () => {
  const p = new URL(await share.publicUrl({ path: tmpMedia(Buffer.alloc(10)), mime: 'image/jpeg' })).pathname;
  assert.equal((await raw(`/m/${'0'.repeat(64)}/media.jpg`)).status, 404);
  assert.equal((await raw('/')).status, 404);
  assert.equal((await raw('/api/health')).status, 404);
  assert.equal((await raw('/m/../../etc/passwd')).status, 404);
  assert.equal((await raw(`${p}/../../x`)).status, 404);
  assert.equal((await raw(p, { method: 'POST' })).status, 405);
  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 3600 * 1000; // pasan 3 h (caducan a las 2 h)
  try { assert.equal((await raw(p)).status, 404); } finally { Date.now = realNow; }
});

test('share: peticiones malformadas desde internet ("GET //", rutas raras) YA NO tumban el proceso', async () => {
  for (const bad of ['//', '//x:y', '/%', '/m/%zz/x', '/\\']) {
    const r = await raw(bad).catch((e) => ({ status: `error:${e.code}` }));
    assert.ok([400, 404].includes(r.status) || String(r.status).startsWith('error'), `${bad} → ${r.status}`);
  }
  assert.equal((await raw('/health')).body.toString(), 'ok', 'el servidor sigue vivo');
});

test('share: si el fichero desaparece tras crear el enlace → 404, no excepción', async () => {
  const f = tmpMedia(Buffer.alloc(10));
  const p = new URL(await share.publicUrl({ path: f, mime: 'image/jpeg' })).pathname;
  fs.rmSync(f);
  assert.equal((await raw(p)).status, 404);
  assert.equal((await raw('/health')).status, 200);
});

test('share: parseRange y looksLikeBinary (descarga de cloudflared)', () => {
  assert.deepEqual(share.parseRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(share.parseRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepEqual(share.parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(share.parseRange('bytes=-0', 10), 'invalid');
  assert.equal(share.parseRange('items=0-1', 10), null);
  const mz = Buffer.alloc(6 * 1024 * 1024); mz[0] = 0x4d; mz[1] = 0x5a;
  assert.equal(share.looksLikeBinary(mz), true);
  assert.equal(share.looksLikeBinary(Buffer.from('<html>Not found</html>')), false, 'una página de error no es un ejecutable');
  assert.equal(share.looksLikeBinary(Buffer.alloc(6 * 1024 * 1024, 65)), false);
});

/* ======================= OAuth: state, PKCE, caducidad, mensajes ======================= */

let userId;
before(() => {
  run("INSERT INTO users (email, name, password_hash, recovery_hash, created_at) VALUES ('t@t.es', 'T', 'x', 'y', ?)", new Date().toISOString());
  userId = get("SELECT id FROM users WHERE email = 't@t.es'").id;
  run("INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, 'tiktok', 'CK', 'CS', '{}', ?)", userId, new Date().toISOString());
});

const pendingFor = (state) => get('SELECT * FROM oauth_pending WHERE state = ?', state);

test('oauth: state aleatorio y distinto en cada intento; PKCE de TikTok = SHA256 en HEXADECIMAL del verifier guardado', async () => {
  const states = new Set();
  for (let i = 0; i < 20; i++) {
    const { authUrl } = await oauth.startOAuth({ id: userId }, 'tiktok');
    const u = new URL(authUrl);
    states.add(u.searchParams.get('state'));
    assert.equal(u.searchParams.get('redirect_uri'), LOCAL_REDIRECT);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    const pend = pendingFor(u.searchParams.get('state'));
    assert.match(pend.code_verifier, /^[A-Za-z0-9_-]{43,128}$/, 'verifier PKCE válido (43-128 car.)');
    assert.equal(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update(pend.code_verifier).digest('hex'));
  }
  assert.equal(states.size, 20);
  [...states].forEach((s) => assert.ok(s.length >= 32, 'state con suficiente entropía'));
});

test('oauth: Meta/LinkedIn usan el relé HTTPS y Google/TikTok el localhost directo', async () => {
  const { providers } = await import('../server/providers/index.js');
  const { redirectUriFor } = await import('../server/config.js');
  for (const id of ['facebook', 'instagram', 'threads', 'linkedin']) assert.equal(redirectUriFor(providers[id]), RELAY_URL, id);
  assert.match(RELAY_URL, /^https:\/\//);
  for (const id of ['tiktok', 'youtube', 'gbp']) assert.equal(redirectUriFor(providers[id]), LOCAL_REDIRECT, id);
});

test('oauth: un "state" desconocido, reutilizado o caducado no conecta nada y avisa en español', async () => {
  const msg = async (q) => decodeURIComponent((await oauth.handleCallback(q)).split('error=')[1] || '');
  assert.match(await msg({ code: 'x', state: 'inventado' }), /caducado o ya se usó/);
  assert.match(await msg({ code: 'x' }), /caducado o ya se usó/);

  // caducado (>30 min)
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'tiktok');
  const st = new URL(authUrl).searchParams.get('state');
  run('UPDATE oauth_pending SET created_at = ? WHERE state = ?', new Date(Date.now() - 31 * 60000).toISOString(), st);
  assert.match(await msg({ code: 'x', state: st }), /pasaron más de 30 minutos/);
  assert.equal(pendingFor(st), undefined, 'el pendiente caducado se borra');
});

test('oauth: el usuario cancela → mensaje en español sin jerga; se borra el pendiente', async () => {
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'tiktok');
  const st = new URL(authUrl).searchParams.get('state');
  const r = await oauth.handleCallback({ state: st, error: 'access_denied', error_description: 'The user denied the request' });
  const m = decodeURIComponent(r.split('error=')[1]);
  assert.match(m, /TikTok: has cancelado/);
  assert.doesNotMatch(m, /access_denied/);
  assert.equal(pendingFor(st), undefined);
});

test('oauth: conexión correcta guarda la cuenta, usa code_verifier y NO se puede reutilizar el mismo state', async () => {
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'tiktok');
  const st = new URL(authUrl).searchParams.get('state');
  const verifier = pendingFor(st).code_verifier;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/v2/oauth/token/')) {
      assert.equal(new URLSearchParams(init.body).get('code_verifier'), verifier);
      return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 86400, scope: 'user.info.basic,video.upload,video.publish', open_id: 'OID' });
    }
    if (u.includes('/v2/user/info/')) return j({ data: { user: { open_id: 'OID', display_name: 'Ana', avatar_url: 'https://a' } }, error: { code: 'ok' } });
    throw new Error('url inesperada ' + u);
  };
  assert.equal(await oauth.handleCallback({ code: 'C', state: st }), '/#/redes?ok=tiktok');
  assert.equal(get("SELECT name FROM accounts WHERE network = 'tiktok' AND external_id = 'OID'").name, 'Ana');
  const again = await oauth.handleCallback({ code: 'C', state: st });
  assert.match(decodeURIComponent(again), /caducado o ya se usó/);
});

test('oauth: un fallo interno (no de la red social) no enseña el error técnico en inglés al alumno', async () => {
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'tiktok');
  const st = new URL(authUrl).searchParams.get('state');
  run("DELETE FROM credentials WHERE family = 'tiktok'"); // antes provocaba un TypeError dentro del proveedor
  const r = decodeURIComponent((await oauth.handleCallback({ code: 'C', state: st })).split('error=')[1]);
  // Ahora se detecta antes de llamar al proveedor y se explica qué pasa (el carné ya no está).
  assert.match(r, /No encontramos el carné de TikTok/);
  assert.doesNotMatch(r, /Cannot read|undefined|TypeError/);
  run("INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, 'tiktok', 'CK', 'CS', '{}', ?)", userId, new Date().toISOString());
});

test('oauth: friendlyOAuthError traduce los casos típicos de los asistentes', () => {
  const f = oauth.friendlyOAuthError;
  assert.match(f('Facebook', 'access_denied', 'User denied'), /cancelado/);
  assert.match(f('Instagram', 'invalid_request', 'Invalid redirect_uri'), /dirección de redirección/);
  assert.match(f('TikTok', 'invalid_scope', 'The scope is invalid'), /permisos/);
  assert.match(f('Threads', '', ''), /cancelado/);
});

/* ======================= relé docs/callback.html ======================= */

const relayHtml = fs.readFileSync(path.join(ROOT, 'docs', 'callback.html'), 'utf8');
const relayScript = /<script>([\s\S]*?)<\/script>/.exec(relayHtml)[1];

function runRelay(search, hash = '') {
  const els = {};
  const mk = (id) => (els[id] ||= {
    id, style: {}, _attrs: {}, textContent: '',
    setAttribute(k, v) { this._attrs[k] = v; },
    set innerHTML(_v) { throw new Error('innerHTML prohibido en el relé'); },
  });
  const replaced = [];
  const ctx = {
    URLSearchParams,
    String,
    setTimeout: () => 0,
    document: { getElementById: mk },
    location: { search, hash, replace: (u) => replaced.push(u), set href(u) { replaced.push(u); } },
  };
  vm.runInNewContext(relayScript, ctx);
  return { replaced, els };
}

test('relé: SOLO reenvía a http://localhost:4747/oauth/callback (destino fijo), con cualquier parámetro raro', () => {
  const evil = [
    '?code=abc&state=xyz',
    '?code=a&state=b&redirect=https://evil.example&next=//evil.example&url=http://evil.example',
    '?state=//evil.example/x',
    '?code=%0d%0aLocation:%20https://evil.example',
    '?error=access_denied&error_description=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E',
  ];
  for (const q of evil) {
    const { replaced } = runRelay(q);
    assert.equal(replaced.length, 1, q);
    const u = new URL(replaced[0]);
    assert.equal(u.origin, 'http://localhost:4747', q);
    assert.equal(u.pathname, '/oauth/callback', q);
  }
});

test('relé: pasa code y state intactos; el texto de error se muestra con textContent (nunca HTML)', () => {
  const { replaced } = runRelay('?code=A%2Fb&state=S1');
  const u = new URL(replaced[0]);
  assert.equal(u.searchParams.get('code'), 'A/b');
  assert.equal(u.searchParams.get('state'), 'S1');
  const { els } = runRelay('?error=access_denied&error_description=%3Cb%3Eboo%3C%2Fb%3E');
  assert.match(els.err.textContent, /<b>boo<\/b>/);
  assert.equal(els.err.style.display, 'block');
});

test('relé: sin parámetros no redirige a ningún sitio', () => {
  assert.equal(runRelay('').replaced.length, 0);
  assert.equal(runRelay('', '#_=_').replaced.length, 0, 'el #_=_ de Meta solo no es una vuelta');
});

test('relé: si la red devuelve los datos en el fragmento (#code=…), los reenvía como consulta al MISMO destino fijo', () => {
  const { replaced } = runRelay('', '#code=A%2Fb&state=S1&next=https://evil.example');
  assert.equal(replaced.length, 1);
  const u = new URL(replaced[0]);
  assert.equal(u.origin + u.pathname, 'http://localhost:4747/oauth/callback');
  assert.equal(u.searchParams.get('code'), 'A/b');
  assert.equal(u.searchParams.get('state'), 'S1');
  // Con ?code=… en la consulta, el fragmento se ignora.
  const q = new URL(runRelay('?code=Q&state=S', '#code=H').replaced[0]);
  assert.equal(q.searchParams.get('code'), 'Q');
});

test('relé: sin recursos externos ni analítica, con CSP y sin referrer', () => {
  assert.doesNotMatch(relayHtml, /<script[^>]+src=/i);
  assert.doesNotMatch(relayHtml, /<link[^>]+href="https?:/i);
  assert.doesNotMatch(relayHtml, /(src|href)="https?:\/\/(?!localhost)/i);
  assert.match(relayHtml, /Content-Security-Policy[^>]+default-src 'none'/);
  assert.match(relayHtml, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(relayScript, /innerHTML|document\.write|eval\(|localStorage|sessionStorage|fetch\(|XMLHttpRequest|sendBeacon/);
  assert.match(relayScript, /var TARGET = 'http:\/\/localhost:4747\/oauth\/callback'/);
});
