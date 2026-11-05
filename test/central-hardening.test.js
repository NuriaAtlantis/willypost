// Regresiones del repaso del modo central (nov-2026), sin internet (fetch simulado):
//  - Facebook nunca pide publish_video (tampoco en modo central sin config_id);
//  - la vuelta OAuth canjea con la MISMA app con la que se abrió la ventana aunque /config cambie a mitad;
//  - si la app con la que se empezó ya no existe, mensaje claro en español (no un error interno);
//  - reconectar usa la app con la que se conectó la cuenta (TikTok/LinkedIn dan un id distinto por app);
//  - el servidor central contestando algo que no es JSON (página de error del alojamiento) → error en español;
//  - renovar TikTok/Google con el carné propio borrado → aviso de reconectar, no un TypeError;
//  - broker: "constructor", "toString"… no son familias (paridad con array_key_exists de PHP);
//  - broker PHP: el archivo de claves se escribe de forma atómica y con permisos 0600.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-central-hard-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_PORT = '4861';
process.env.WILLYPOST_SHARE_PORT = '4862';
process.env.WILLYPOST_BROKER = 'https://broker.example.test';
delete process.env.WILLYPOST_RELAY;

const { run, get } = await import('../server/db.js');
const oauth = await import('../server/oauth.js');
const accounts = await import('../server/accounts.js');
const central = await import('../server/central.js');
const { providers } = await import('../server/providers/index.js');
const { GRAPH_VERSION } = await import('../server/providers/facebook.js');
const { googleRefresh } = await import('../server/providers/youtube.js');
const { default: worker } = await import('../broker/worker.js');

const BROKER = 'https://broker.example.test';
const RELAY = 'https://willypost.com/callback.html';
const FB = `https://graph.facebook.com/${GRAPH_VERSION}`;
const BASE = { version: 1, relay: RELAY, media: 'https://media.willypost.com' };
const FULL = {
  ...BASE,
  networks: {
    meta: { client_id: 'META_ID', ig_config_id: '222222222' }, // sin config_id: Facebook usa scope
    tiktok: { client_id: 'TT_KEY' },
    linkedin: { client_id: 'LI_ID' },
  },
};

const realFetch = globalThis.fetch;
let calls;
let routes;
let config;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

async function useConfig(c) {
  config = c;
  central._resetCentralCache();
  fs.rmSync(path.join(dataDir, 'central.json'), { force: true });
  await central.loadCentralConfig({ force: true });
}

beforeEach(async () => {
  calls = [];
  routes = [];
  globalThis.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: (init.method || 'GET').toUpperCase(), body: typeof init.body === 'string' ? init.body : null, headers: init.headers || {} };
    calls.push(rec);
    if (rec.url === `${BROKER}/config`) return json(config);
    const r = routes.find(([p]) => p(rec));
    if (!r) throw new Error(`url inesperada en el test: ${rec.method} ${rec.url}`);
    return r[1](rec);
  };
  await useConfig(FULL);
  calls.length = 0;
});
afterEach(() => { globalThis.fetch = realFetch; });
after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ } });

const on = (match, fn) => routes.push([typeof match === 'string' ? (r) => `${r.method} ${r.url}`.includes(match) : match, fn]);
const brokerCalls = () => calls.filter((c) => c.url.startsWith(`${BROKER}/token/`));
const errorOf = (hash) => decodeURIComponent(hash.replace(/^\/#\/redes\?error=/, ''));

let n = 0;
function newUser() {
  n += 1;
  run("INSERT INTO users (email, name, password_hash, recovery_hash, created_at) VALUES (?, 'T', 'x', 'y', ?)", `hard${n}@t.es`, new Date().toISOString());
  return get('SELECT id FROM users WHERE email = ?', `hard${n}@t.es`).id;
}
const saveOwn = (userId, family, id = 'ID_PROPIO', secret = 'CS_PROPIO') =>
  run("INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, ?, ?, ?, '{}', ?)", userId, family, id, secret, new Date().toISOString());
const stateOf = (authUrl) => new URL(authUrl).searchParams.get('state');
function insertAccount(userId, network, externalId, meta) {
  const ts = new Date().toISOString();
  run(`INSERT INTO accounts (user_id, network, external_id, name, username, access_token, refresh_token, meta, mode, connected_at, created_at)
       VALUES (?, ?, ?, 'Ana', NULL, 'T', 'RT', ?, 'api', ?, ?)`, userId, network, externalId, JSON.stringify(meta), ts, ts);
  return get('SELECT * FROM accounts WHERE user_id = ? AND network = ? AND external_id = ?', userId, network, externalId);
}

/* ---------------- Facebook: sin publish_video ---------------- */

test('facebook central sin config_id: pide permisos por scope y NUNCA publish_video', async () => {
  const userId = newUser();
  const { authUrl, central: isCentral } = await oauth.startOAuth({ id: userId }, 'facebook');
  assert.equal(isCentral, true);
  const u = new URL(authUrl);
  assert.equal(u.searchParams.get('client_id'), 'META_ID');
  assert.equal(u.searchParams.get('redirect_uri'), RELAY);
  const scopes = u.searchParams.get('scope').split(',');
  assert.deepEqual(scopes.sort(), ['business_management', 'pages_manage_posts', 'pages_read_engagement', 'pages_show_list']);
  assert.ok(!authUrl.includes('publish_video'));
});

/* ---------------- la vuelta usa la app con la que se empezó ---------------- */

test('instagram: si /config cambia de "a través de Facebook" a directo a mitad, la vuelta sigue canjeando con la app de Meta', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'instagram');
  assert.match(authUrl, /facebook\.com\/v\d+\.\d+\/dialog\/oauth/);
  assert.equal(new URL(authUrl).searchParams.get('config_id'), '222222222');

  // Mientras el alumno acepta en Facebook, el servidor central pasa a ofrecer Instagram directo.
  await useConfig({ ...BASE, networks: { ...FULL.networks, instagram: { client_id: 'IG_ID' } } });
  calls.length = 0;
  on(`POST ${BROKER}/token/meta/code`, () => json({ access_token: 'SHORT' }));
  on(`POST ${BROKER}/token/meta/long_lived`, () => json({ access_token: 'LONG', expires_in: 5184000 }));
  on(`GET ${FB}/me/accounts`, () => json({ data: [{ id: 'P1', name: 'Página', access_token: 'PAGE_T', instagram_business_account: { id: 'IG1', username: 'ana' } }] }));
  assert.equal(await oauth.handleCallback({ code: 'C', state: stateOf(authUrl) }), '/#/redes?ok=instagram');
  assert.deepEqual(brokerCalls().map((c) => c.url.slice(BROKER.length)), ['/token/meta/code', '/token/meta/long_lived']);
  const acc = get("SELECT * FROM accounts WHERE user_id = ? AND network = 'instagram'", userId);
  assert.equal(JSON.parse(acc.meta).via, 'facebook');
  assert.equal(acc.access_token, 'PAGE_T');
});

test('si el carné propio con el que se empezó se borra antes de volver: mensaje claro, sin error interno', async () => {
  const userId = newUser();
  saveOwn(userId, 'linkedin');
  const { authUrl, central: isCentral } = await oauth.startOAuth({ id: userId }, 'linkedin');
  assert.equal(isCentral, false);
  run("DELETE FROM credentials WHERE user_id = ? AND family = 'linkedin'", userId);
  const hash = await oauth.handleCallback({ code: 'C', state: stateOf(authUrl) });
  assert.match(errorOf(hash), /No encontramos el carné de LinkedIn/);
  assert.equal(calls.filter((c) => !c.url.endsWith('/config')).length, 0, 'no intenta canjear nada');
  assert.equal(get('SELECT COUNT(*) AS n FROM oauth_pending WHERE state = ?', stateOf(authUrl)).n, 0);
});

/* ---------------- reconectar con la misma app ---------------- */

test('reconectar una cuenta central de TikTok usa la app central aunque luego se haya guardado un carné propio', async () => {
  const userId = newUser();
  const acc = insertAccount(userId, 'tiktok', 'OID_CENTRAL', { auth_mode: 'central' });
  saveOwn(userId, 'tiktok', 'CK_PROPIA');
  const r = await oauth.startOAuth({ id: userId }, 'tiktok', acc.id);
  assert.equal(r.central, true);
  const u = new URL(r.authUrl);
  assert.equal(u.searchParams.get('client_key'), 'TT_KEY');
  assert.equal(u.searchParams.get('redirect_uri'), RELAY);
  // Una conexión NUEVA sí usa el carné propio (preferencia de siempre).
  assert.equal(new URL((await oauth.startOAuth({ id: userId }, 'tiktok')).authUrl).searchParams.get('client_key'), 'CK_PROPIA');
});

test('reconectar una cuenta de carné propio cuando el carné ya no está: usa la app central y, si el id cambia, lo explica', async () => {
  const userId = newUser();
  const acc = insertAccount(userId, 'linkedin', 'SUB_DE_MI_APP', { auth_mode: 'own' });
  const { authUrl, central: isCentral } = await oauth.startOAuth({ id: userId }, 'linkedin', acc.id);
  assert.equal(isCentral, true);
  on(`POST ${BROKER}/token/linkedin/code`, () => json({ access_token: 'LI_T', expires_in: 5184000 }));
  on('/v2/userinfo', () => json({ sub: 'SUB_DE_LA_APP_CENTRAL', name: 'Ana' }));
  const msg = errorOf(await oauth.handleCallback({ code: 'C', state: stateOf(authUrl) }));
  assert.match(msg, /se conectó con tu propio carné/);
  assert.match(msg, /Quita la cuenta/);
  const still = get('SELECT * FROM accounts WHERE id = ?', acc.id);
  assert.equal(still.access_token, 'T', 'no se ha tocado la cuenta');
  assert.equal(get("SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND network = 'linkedin'", userId).n, 1, 'no se añade otra cuenta');
});

/* ---------------- respuestas raras del servidor central ---------------- */

test('el servidor central devuelve una página HTML (error del alojamiento): error en español, reintentable, sin HTML', async () => {
  for (const status of [500, 503, 403, 200]) {
    routes = [];
    on(`POST ${BROKER}/token/tiktok/refresh`, () => new Response('<html><body>Error 5xx de Hostinger</body></html>', { status, headers: { 'content-type': 'text/html' } }));
    await assert.rejects(central.centralToken('tiktok', 'refresh', { refresh_token: 'RT' }), (e) => {
      assert.equal(e.name, 'ProviderError');
      assert.equal(e.central, true);
      assert.equal(e.retryable, true);
      assert.equal(e.auth, false);
      assert.doesNotMatch(e.message, /html|Hostinger/i);
      assert.match(e.message, /servidor de WillyPost/);
      return true;
    }, `status ${status}`);
  }
  // Y al conectar, ese mismo error llega tal cual (no "revisa tu carné").
  routes = [];
  on(`POST ${BROKER}/token/meta/code`, () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
  await assert.rejects(providers.facebook.exchangeCode({ creds: central.centralCredsFor('meta'), redirectUri: RELAY, code: 'C' }),
    (e) => /servidor de WillyPost/.test(e.message) && !/carné/.test(e.message));
});

/* ---------------- renovar sin el carné propio ---------------- */

test('renovar TikTok o Google conectados con carné propio después de borrar el carné: aviso de reconectar, no TypeError', async () => {
  await assert.rejects(providers.tiktok.refresh({ account: { refresh_token: 'RT' }, creds: null }),
    (e) => e.name === 'ProviderError' && e.auth && /carné de TikTok/.test(e.message));
  await assert.rejects(googleRefresh({ account: { refresh_token: 'RT' }, creds: null }),
    (e) => e.name === 'ProviderError' && e.auth && /carné de Google/.test(e.message));
  // Por la ruta real: ensureFreshToken con la cuenta "own" y sin carné guardado.
  const userId = newUser();
  const acc = insertAccount(userId, 'tiktok', 'OID_OWN', { auth_mode: 'own' });
  await assert.rejects(accounts.ensureFreshToken(acc, { force: true }), (e) => e.name === 'ProviderError' && e.auth);
  assert.equal(calls.length, 0, 'no llama a nadie');
});

/* ---------------- broker: paridad y archivo de claves ---------------- */

test('broker (worker): "constructor", "toString"… no son familias ni operaciones → 404 operacion_desconocida (como PHP)', async () => {
  globalThis.fetch = async () => { throw new Error('no debe llamar a ninguna red'); };
  const env = { META_APP_ID: 'm', META_APP_SECRET: 's' };
  for (const [family, op] of [['constructor', 'name'], ['toString', 'length'], ['__proto__', 'code'], ['meta', 'constructor'], ['meta', 'hasOwnProperty']]) {
    const res = await worker.fetch(new Request(`https://auth.willypost.com/token/${family}/${op}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }), env, {});
    assert.equal(res.status, 404, `${family}/${op}`);
    assert.equal((await res.json()).error, 'willypost_operacion_desconocida', `${family}/${op}`);
  }
});

test('broker (PHP): las claves de /admin se guardan de forma atómica y con permisos 0600 desde el primer instante', () => {
  const php = fs.readFileSync(new URL('../broker/hostinger/auth/index.php', import.meta.url), 'utf8');
  const fn = php.match(/function save_secrets\([\s\S]*?\r?\n}\r?\n/);
  assert.ok(fn, 'existe save_secrets()');
  assert.match(fn[0], /umask\(0077\)/);
  assert.match(fn[0], /rename\(\$tmp, \$file\)/);
  assert.match(fn[0], /umask\(\$old\)/);
  // Nadie escribe directamente encima del archivo de claves.
  assert.doesNotMatch(php, /file_put_contents\(\$file/);
  // Y sigue dentro de la sección que solo existe en PHP (no cuenta para la paridad con worker.js).
  const section = php.match(/página privada de claves[\s\S]*?fin página privada de claves/)[0];
  assert.ok(section.includes('function save_secrets('));
});
