// Modo central de punta a punta (sin internet: fetch simulado):
//  - precedencia carné propio > app central > "configura tu carné";
//  - cada canje que necesita secreto va al broker con la familia/operación/cuerpo correctos y SIN secretos;
//  - lo demás (perfil, Páginas, refrescos sin secreto) sigue saliendo directo a la red;
//  - Google central: cliente de escritorio, PKCE y localhost, canje directo a Google;
//  - la cuenta recuerda con qué app se conectó y se renueva con esa misma app.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-central-oauth-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_PORT = '4833';
process.env.WILLYPOST_SHARE_PORT = '4834';
process.env.WILLYPOST_BROKER = 'https://broker.example.test';
delete process.env.WILLYPOST_RELAY;

const { run, get } = await import('../server/db.js');
const oauth = await import('../server/oauth.js');
const accounts = await import('../server/accounts.js');
const central = await import('../server/central.js');
const { LOCAL_REDIRECT } = await import('../server/config.js');
const { providers } = await import('../server/providers/index.js');

const BROKER = 'https://broker.example.test';
const RELAY = 'https://willypost.com/callback.html';
const YT_SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
const CONFIG = {
  version: 1,
  relay: RELAY,
  media: 'https://media.willypost.com',
  networks: {
    meta: { client_id: 'META_ID', config_id: '123456789' },
    instagram: { client_id: 'IG_ID' },
    threads: { client_id: 'TH_ID' },
    tiktok: { client_id: 'TT_KEY' },
    linkedin: { client_id: 'LI_ID' },
    google: { client_id: 'G_ID.apps.googleusercontent.com', client_secret: 'G_DESKTOP_SECRET' },
  },
};

const realFetch = globalThis.fetch;
let calls;
let routes; // [ [predicate(url), (rec) => Response] ]
let config;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  routes = [];
  config = CONFIG;
  central._resetCentralCache();
  fs.rmSync(path.join(dataDir, 'central.json'), { force: true });
  globalThis.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: init.method || 'GET', body: typeof init.body === 'string' ? init.body : null, headers: init.headers || {} };
    calls.push(rec);
    if (rec.url === `${BROKER}/config`) return json(config);
    const r = routes.find(([p]) => p(rec.url));
    if (!r) throw new Error(`url inesperada en el test: ${rec.url}`);
    return r[1](rec);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });
after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ } });

const on = (match, fn) => routes.push([typeof match === 'string' ? (u) => u.includes(match) : match, fn]);
const brokerCalls = () => calls.filter((c) => c.url.startsWith(`${BROKER}/token/`));
const bodyOf = (c) => JSON.parse(c.body);
const form = (c) => Object.fromEntries(new URLSearchParams(c.body || ''));

/** Ninguna llamada (salvo el canje directo de Google, que es público) lleva un secreto. */
function assertNoSecretsSent() {
  for (const c of calls) {
    if (c.url.startsWith('https://oauth2.googleapis.com/')) continue;
    assert.doesNotMatch(c.url, /client_secret/, `secreto en la URL: ${c.url}`);
    assert.doesNotMatch(String(c.body || ''), /client_secret|client_key|CS_PROPIO/, `secreto en el cuerpo de ${c.url}`);
  }
  for (const c of brokerCalls()) {
    const b = bodyOf(c);
    for (const k of ['client_id', 'client_secret', 'client_key', 'app_secret']) assert.equal(k in b, false, `${c.url} lleva ${k}`);
  }
}

let n = 0;
function newUser() {
  n += 1;
  run("INSERT INTO users (email, name, password_hash, recovery_hash, created_at) VALUES (?, 'T', 'x', 'y', ?)", `u${n}@t.es`, new Date().toISOString());
  return get('SELECT id FROM users WHERE email = ?', `u${n}@t.es`).id;
}
const saveOwn = (userId, family, id = 'ID_PROPIO', secret = 'CS_PROPIO') =>
  run("INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, ?, ?, ?, '{}', ?)", userId, family, id, secret, new Date().toISOString());
const stateOf = (authUrl) => new URL(authUrl).searchParams.get('state');
const verifierOf = (state) => get('SELECT code_verifier FROM oauth_pending WHERE state = ?', state).code_verifier;

/* ---------------- precedencia ---------------- */

test('precedencia: sin carné ni app central → "configura tu carné"; con app central → sin carné; con carné propio → el propio', async () => {
  const userId = newUser();
  config = { ...CONFIG, networks: { meta: CONFIG.networks.meta } }; // LinkedIn no está en modo central
  await assert.rejects(oauth.startOAuth({ id: userId }, 'linkedin'), (e) => e.status === 400 && /configura tu "carné" de LinkedIn/.test(e.message));
  assert.equal(await accounts.resolveCreds(userId, 'linkedin'), null);

  central._resetCentralCache();
  fs.rmSync(path.join(dataDir, 'central.json'), { force: true });
  config = CONFIG;
  let r = await oauth.startOAuth({ id: userId }, 'linkedin');
  assert.equal(r.central, true);
  let u = new URL(r.authUrl);
  assert.equal(u.searchParams.get('client_id'), 'LI_ID');
  assert.equal(u.searchParams.get('redirect_uri'), RELAY);

  saveOwn(userId, 'linkedin');
  r = await oauth.startOAuth({ id: userId }, 'linkedin');
  assert.equal(r.central, false);
  u = new URL(r.authUrl);
  assert.equal(u.searchParams.get('client_id'), 'ID_PROPIO', 'el carné propio tiene preferencia');
  const own = await accounts.resolveCreds(userId, 'linkedin');
  assert.equal(own.central, undefined);

  // TikTok con carné propio conserva su localhost; en central usa el relé.
  saveOwn(userId, 'tiktok');
  assert.equal(new URL((await oauth.startOAuth({ id: userId }, 'tiktok')).authUrl).searchParams.get('redirect_uri'), LOCAL_REDIRECT);
  const other = newUser();
  const t = new URL((await oauth.startOAuth({ id: other }, 'tiktok')).authUrl);
  assert.equal(t.searchParams.get('client_key'), 'TT_KEY');
  assert.equal(t.searchParams.get('redirect_uri'), RELAY);
});

test('precedencia: el carné propio no necesita preguntar al servidor central', async () => {
  const userId = newUser();
  saveOwn(userId, 'meta');
  await oauth.startOAuth({ id: userId }, 'facebook');
  assert.equal(calls.filter((c) => c.url.startsWith(BROKER)).length, 0);
});

/* ---------------- Facebook (meta) ---------------- */

test('facebook central: config_id central, code y long_lived por el broker; Páginas directo a Graph; cuenta marcada como central', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'facebook');
  const u = new URL(authUrl);
  assert.equal(u.searchParams.get('client_id'), 'META_ID');
  assert.equal(u.searchParams.get('config_id'), '123456789');
  assert.equal(u.searchParams.get('redirect_uri'), RELAY);
  on(`${BROKER}/token/meta/code`, () => json({ access_token: 'SHORT', token_type: 'bearer' }));
  on(`${BROKER}/token/meta/long_lived`, () => json({ access_token: 'LONG', expires_in: 5184000 }));
  on('graph.facebook.com/v26.0/me/accounts', (rec) => {
    assert.equal(new URL(rec.url).searchParams.get('access_token'), 'LONG');
    return json({ data: [{ id: 'P1', name: 'Mi Página', access_token: 'PAGE_T', tasks: ['CREATE_CONTENT'] }] });
  });
  assert.equal(await oauth.handleCallback({ code: 'CODE#_=_', state: stateOf(authUrl) }), '/#/redes?ok=facebook');
  const b = brokerCalls();
  assert.deepEqual(b.map((c) => c.url), [`${BROKER}/token/meta/code`, `${BROKER}/token/meta/long_lived`]);
  assert.deepEqual(bodyOf(b[0]), { code: 'CODE', redirect_uri: RELAY });
  assert.deepEqual(bodyOf(b[1]), { access_token: 'SHORT' });
  assert.equal(calls.some((c) => c.url.includes('graph.facebook.com') && c.url.includes('oauth/access_token')), false, 'nunca canjea directo');
  const acc = get("SELECT * FROM accounts WHERE network = 'facebook' AND external_id = 'P1'");
  assert.equal(acc.access_token, 'PAGE_T');
  assert.equal(JSON.parse(acc.meta).auth_mode, 'central');
  assert.equal(accounts.serializeAccount(acc).auth_mode, 'central');
  assertNoSecretsSent();
});

test('facebook central: si el broker dice que la red no está configurada, el alumno lo lee en español', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'facebook');
  on(`${BROKER}/token/meta/code`, () => json({ error: 'willypost_red_no_configurada', message: 'x' }, 404));
  const r = decodeURIComponent((await oauth.handleCallback({ code: 'C', state: stateOf(authUrl) })).split('error=')[1]);
  assert.match(r, /La conexión sin carné con Facebook no está disponible ahora mismo/);
  assert.doesNotMatch(r, /willypost_|carné de Meta|secreto/);
});

test('central: si la red devuelve un error en la vuelta, el mensaje no habla de "tu app"', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'instagram');
  const r = decodeURIComponent((await oauth.handleCallback({ state: stateOf(authUrl), error: 'invalid_request', error_description: 'Invalid redirect_uri' })).split('error=')[1]);
  assert.match(r, /Vuelve a pulsar Conectar/);
  assert.doesNotMatch(r, /tu app|carné/);
});

/* ---------------- Instagram ---------------- */

test('instagram central: code y ig_exchange_token por el broker; perfil directo; ig_refresh_token sigue siendo local y sin secreto', async () => {
  const creds = central.centralCredsFor('instagram') || (await central.loadCentralConfig(), central.centralCredsFor('instagram'));
  on(`${BROKER}/token/instagram/code`, () => json({ data: [{ access_token: 'IG_SHORT', user_id: '17', permissions: 'x' }] }));
  on(`${BROKER}/token/instagram/long_lived`, () => json({ access_token: 'IG_LONG', expires_in: 5184000 }));
  on('graph.instagram.com/v26.0/me', () => json({ user_id: 'IGU', username: 'ana', account_type: 'BUSINESS' }));
  const [c] = await providers.instagram.exchangeCode({ creds, redirectUri: RELAY, code: 'IGC#_' });
  assert.equal(c.access_token, 'IG_LONG');
  assert.equal(c.external_id, 'IGU');
  const b = brokerCalls();
  assert.deepEqual(b.map((x) => x.url.slice(BROKER.length)), ['/token/instagram/code', '/token/instagram/long_lived']);
  assert.deepEqual(bodyOf(b[0]), { code: 'IGC', redirect_uri: RELAY });
  assert.deepEqual(bodyOf(b[1]), { access_token: 'IG_SHORT' });

  calls.length = 0;
  on('graph.instagram.com/refresh_access_token', (rec) => {
    assert.equal(new URL(rec.url).searchParams.get('grant_type'), 'ig_refresh_token');
    return json({ access_token: 'IG_NEW', expires_in: 5184000 });
  });
  const r = await providers.instagram.refresh({
    account: { access_token: 'IG_LONG', token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, creds,
  });
  assert.equal(r.access_token, 'IG_NEW');
  assert.equal(brokerCalls().length, 0, 'el refresco de Instagram no pasa por el broker');
  assertNoSecretsSent();
});

/* ---------------- Threads ---------------- */

test('threads central: code y th_exchange_token por el broker; th_refresh_token local', async () => {
  await central.loadCentralConfig();
  const creds = central.centralCredsFor('threads');
  on(`${BROKER}/token/threads/code`, () => json({ access_token: 'TH_SHORT', user_id: 'TU' }));
  on(`${BROKER}/token/threads/long_lived`, () => json({ access_token: 'TH_LONG', expires_in: 5184000 }));
  on('graph.threads.com/v1.0/me', () => json({ id: 'TU', username: 'ana' }));
  const [c] = await providers.threads.exchangeCode({ creds, redirectUri: RELAY, code: 'THC' });
  assert.equal(c.access_token, 'TH_LONG');
  const b = brokerCalls();
  assert.deepEqual(b.map((x) => x.url.slice(BROKER.length)), ['/token/threads/code', '/token/threads/long_lived']);
  assert.deepEqual(bodyOf(b[0]), { code: 'THC', redirect_uri: RELAY });
  assert.deepEqual(bodyOf(b[1]), { access_token: 'TH_SHORT' });

  calls.length = 0;
  on('graph.threads.com/refresh_access_token', () => json({ access_token: 'TH_NEW', expires_in: 5184000 }));
  const r = await providers.threads.refresh({ account: { access_token: 'TH_LONG', token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, creds });
  assert.equal(r.access_token, 'TH_NEW');
  assert.equal(brokerCalls().length, 0);
  assertNoSecretsSent();
});

/* ---------------- LinkedIn ---------------- */

test('linkedin central: code por el broker; perfil (userinfo) directo', async () => {
  await central.loadCentralConfig();
  const creds = central.centralCredsFor('linkedin');
  on(`${BROKER}/token/linkedin/code`, () => json({ access_token: 'LI_T', expires_in: 5184000, scope: 'openid,profile,w_member_social' }));
  on('/v2/userinfo', (rec) => {
    assert.equal(rec.headers.Authorization, 'Bearer LI_T');
    return json({ sub: 'abc', name: 'Ana López' });
  });
  const [c] = await providers.linkedin.exchangeCode({ creds, redirectUri: RELAY, code: 'LIC' });
  assert.equal(c.external_id, 'abc');
  assert.equal(c.meta.urn, 'urn:li:person:abc');
  assert.deepEqual(bodyOf(brokerCalls()[0]), { code: 'LIC', redirect_uri: RELAY });
  assert.equal(calls.some((x) => x.url.includes('linkedin.com/oauth')), false);

  // Error de LinkedIn reenviado por el broker → mensaje en español, sin hablar del carné
  calls.length = 0;
  routes = [];
  on(`${BROKER}/token/linkedin/code`, () => json({ error: 'invalid_request', error_description: 'Unable to retrieve access token' }, 400));
  await assert.rejects(providers.linkedin.exchangeCode({ creds, redirectUri: RELAY, code: 'X' }),
    (e) => e.auth && /LinkedIn no ha aceptado la conexión/.test(e.message) && !/Client Secret/.test(e.message));
  assertNoSecretsSent();
});

/* ---------------- TikTok ---------------- */

test('tiktok central: code por el broker con code_verifier y el relé; perfil directo; se renueva SIEMPRE por el broker', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'tiktok');
  const st = stateOf(authUrl);
  const verifier = verifierOf(st);
  assert.equal(new URL(authUrl).searchParams.get('code_challenge'), crypto.createHash('sha256').update(verifier).digest('hex'));
  on(`${BROKER}/token/tiktok/code`, () => json({ access_token: 'AT', refresh_token: 'RT', expires_in: 86400, refresh_expires_in: 31536000, scope: 'user.info.basic,video.upload,video.publish', open_id: 'OID' }));
  on('open.tiktokapis.com/v2/user/info/', () => json({ data: { user: { open_id: 'OID', display_name: 'Ana' } }, error: { code: 'ok' } }));
  assert.equal(await oauth.handleCallback({ code: 'TTC', state: st }), '/#/redes?ok=tiktok');
  assert.deepEqual(bodyOf(brokerCalls()[0]), { code: 'TTC', redirect_uri: RELAY, code_verifier: verifier });
  assert.equal(calls.some((c) => c.url.includes('/v2/oauth/token/')), false, 'nunca canjea directo con TikTok');
  let acc = get("SELECT * FROM accounts WHERE user_id = ? AND network = 'tiktok'", userId);
  assert.equal(JSON.parse(acc.meta).auth_mode, 'central');

  // Renovación: por el broker, con el refresh_token y nada más.
  calls.length = 0;
  on(`${BROKER}/token/tiktok/refresh`, () => json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 86400 }));
  acc = await accounts.ensureFreshToken(acc, { force: true });
  assert.equal(acc.access_token, 'AT2');
  assert.equal(acc.refresh_token, 'RT2');
  assert.deepEqual(brokerCalls().map((c) => [c.url.slice(BROKER.length), bodyOf(c)]), [['/token/tiktok/refresh', { refresh_token: 'RT' }]]);

  // Aunque luego guarde un carné propio, ESTA cuenta se sigue renovando con la app central (la que emitió el token).
  saveOwn(userId, 'tiktok');
  calls.length = 0;
  acc = await accounts.ensureFreshToken(acc, { force: true });
  assert.equal(brokerCalls().length, 1);
  assert.equal(calls.some((c) => c.url.includes('/v2/oauth/token/')), false);
  assertNoSecretsSent();
});

test('tiktok: una cuenta conectada con carné propio (o antigua, sin marca) se renueva con el carné propio, no con el broker', async () => {
  const userId = newUser();
  saveOwn(userId, 'tiktok', 'CK_PROPIA', 'SECRETO_PROPIO');
  const ts = new Date().toISOString();
  run(`INSERT INTO accounts (user_id, network, external_id, name, access_token, refresh_token, meta, mode, connected_at, created_at)
       VALUES (?, 'tiktok', 'OLD', 'Vieja', 'T', 'RT_OLD', '{}', 'api', ?, ?)`, userId, ts, ts);
  let acc = get("SELECT * FROM accounts WHERE user_id = ? AND external_id = 'OLD'", userId);
  assert.equal(accounts.accountAuthMode(acc), 'own');
  on('open.tiktokapis.com/v2/oauth/token/', (rec) => {
    const f = form(rec);
    assert.equal(f.client_key, 'CK_PROPIA');
    assert.equal(f.client_secret, 'SECRETO_PROPIO');
    assert.equal(f.grant_type, 'refresh_token');
    return json({ access_token: 'AT_OWN', expires_in: 86400 });
  });
  acc = await accounts.ensureFreshToken(acc, { force: true });
  assert.equal(acc.access_token, 'AT_OWN');
  assert.equal(brokerCalls().length, 0);
});

test('tiktok central sin poder hablar con el servidor de WillyPost: error reintentable en español', async () => {
  await central.loadCentralConfig();
  on(`${BROKER}/token/tiktok/refresh`, () => { throw new TypeError('fetch failed'); });
  await assert.rejects(providers.tiktok.refresh({ account: { refresh_token: 'RT' }, creds: central.centralCredsFor('tiktok') }),
    (e) => e.retryable && /servidor de WillyPost/.test(e.message));
});

/* ---------------- Google (YouTube / GBP) ---------------- */

test('google central: cliente de escritorio + PKCE S256 + localhost; canje y refresco directos a Google (nunca al broker)', async () => {
  const userId = newUser();
  const { authUrl, central: isCentral } = await oauth.startOAuth({ id: userId }, 'youtube');
  assert.equal(isCentral, true);
  const u = new URL(authUrl);
  const st = u.searchParams.get('state');
  const verifier = verifierOf(st);
  assert.equal(u.searchParams.get('client_id'), 'G_ID.apps.googleusercontent.com');
  assert.equal(u.searchParams.get('redirect_uri'), LOCAL_REDIRECT);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update(verifier).digest('base64url'));

  on('https://oauth2.googleapis.com/token', (rec) => {
    const f = form(rec);
    if (f.grant_type === 'authorization_code') {
      assert.equal(f.code_verifier, verifier);
      assert.equal(f.client_id, 'G_ID.apps.googleusercontent.com');
      assert.equal(f.client_secret, 'G_DESKTOP_SECRET');
      assert.equal(f.redirect_uri, LOCAL_REDIRECT);
      return json({ access_token: 'GA', refresh_token: 'GR', expires_in: 3600, scope: YT_SCOPES });
    }
    assert.equal(f.grant_type, 'refresh_token');
    assert.equal(f.refresh_token, 'GR');
    assert.equal(f.client_id, 'G_ID.apps.googleusercontent.com');
    return json({ access_token: 'GA2', expires_in: 3600 });
  });
  on('youtube/v3/channels', () => json({ items: [{ id: 'UC1', snippet: { title: 'Mi canal' } }] }));
  assert.equal(await oauth.handleCallback({ code: 'GC', state: st }), '/#/redes?ok=youtube');
  let acc = get("SELECT * FROM accounts WHERE user_id = ? AND network = 'youtube'", userId);
  assert.equal(JSON.parse(acc.meta).auth_mode, 'central');
  acc = await accounts.ensureFreshToken(acc, { force: true });
  assert.equal(acc.access_token, 'GA2');
  assert.equal(brokerCalls().length, 0, 'Google no pasa por el broker');
});

test('google con carné propio: igual que siempre (sin PKCE); y central sin configuración → error reintentable', async () => {
  const userId = newUser();
  saveOwn(userId, 'google');
  const u = new URL((await oauth.startOAuth({ id: userId }, 'gbp')).authUrl);
  assert.equal(u.searchParams.get('client_id'), 'ID_PROPIO');
  assert.equal(u.searchParams.get('code_challenge'), null);
  await assert.rejects(providers.youtube.refresh({ account: { refresh_token: 'R' }, creds: { central: true, client_id: null, extra: {} } }),
    (e) => e.retryable && /servidor de WillyPost/.test(e.message));
});
