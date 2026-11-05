// Instagram en modo central "a través de Facebook" (sin internet: fetch simulado).
// Meta ya no deja que las apps nuevas usen "Instagram API with Instagram Login": si /config no trae la familia
// 'instagram' pero 'meta' trae ig_config_id, Instagram se conecta con Facebook Login for Business (app de Meta),
// los canjes van al broker con la familia 'meta' y se publica en graph.facebook.com con el Page token.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-central-igfb-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_PORT = '4851';
process.env.WILLYPOST_SHARE_PORT = '4852';
process.env.WILLYPOST_BROKER = 'https://broker.example.test';
delete process.env.WILLYPOST_RELAY;

const { run, get } = await import('../server/db.js');
const oauth = await import('../server/oauth.js');
const accounts = await import('../server/accounts.js');
const central = await import('../server/central.js');
const { providers, networkInfo } = await import('../server/providers/index.js');
const { GRAPH_VERSION } = await import('../server/providers/facebook.js');

const instagram = providers.instagram;
const BROKER = 'https://broker.example.test';
const RELAY = 'https://willypost.com/callback.html';
const FB = `https://graph.facebook.com/${GRAPH_VERSION}`;
const BASE = { version: 1, relay: RELAY, media: 'https://media.willypost.com' };
const VIA_FB = { ...BASE, networks: { meta: { client_id: 'META_ID', config_id: '111111111', ig_config_id: '222222222' } } };
const CLASSIC = { ...BASE, networks: { meta: { client_id: 'META_ID', ig_config_id: '222222222' }, instagram: { client_id: 'IG_ID' } } };

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
    const rec = { url: String(url), method: (init.method || 'GET').toUpperCase(), body: init.body, headers: init.headers || {} };
    calls.push(rec);
    if (rec.url === `${BROKER}/config`) return json(config);
    const r = routes.find(([p]) => p(rec));
    if (!r) throw new Error(`url inesperada en el test: ${rec.method} ${rec.url}`);
    return r[1](rec);
  };
  await useConfig(VIA_FB);
  calls.length = 0;
});
afterEach(() => { globalThis.fetch = realFetch; });
after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ } });

/** on('GET graph.facebook.com/v26.0/me/accounts', fn): coincide con "MÉTODO url" (subcadena) o con una función. */
const on = (match, fn) => routes.push([typeof match === 'string' ? (r) => `${r.method} ${r.url}`.includes(match) : match, fn]);
const brokerCalls = () => calls.filter((c) => c.url.startsWith(`${BROKER}/token/`));
const bodyText = (c) => (typeof c.body === 'string' ? c.body : c.body instanceof URLSearchParams ? c.body.toString() : '');
const form = (c) => Object.fromEntries(new URLSearchParams(bodyText(c)));

function assertNoSecretsSent() {
  for (const c of calls) {
    assert.doesNotMatch(c.url, /client_secret|app_secret/, `secreto en la URL: ${c.url}`);
    assert.doesNotMatch(bodyText(c), /client_secret|app_secret|CS_PROPIO/, `secreto en el cuerpo de ${c.url}`);
  }
  for (const c of brokerCalls()) {
    const b = JSON.parse(c.body);
    for (const k of ['client_id', 'client_secret', 'client_key', 'app_secret']) assert.equal(k in b, false, `${c.url} lleva ${k}`);
  }
}

let n = 0;
function newUser() {
  n += 1;
  run("INSERT INTO users (email, name, password_hash, recovery_hash, created_at) VALUES (?, 'T', 'x', 'y', ?)", `igfb${n}@t.es`, new Date().toISOString());
  return get('SELECT id FROM users WHERE email = ?', `igfb${n}@t.es`).id;
}
const stateOf = (authUrl) => new URL(authUrl).searchParams.get('state');

const tmp = fs.mkdtempSync(path.join(dataDir, 'media-'));
function mediaFile(i, { kind = 'image', mime = 'image/jpeg', ext = 'jpg' } = {}) {
  const p = path.join(tmp, `m${i}.${ext}`);
  fs.writeFileSync(p, Buffer.from(`fake-${i}`));
  return { id: i, path: p, mime, kind, width: 1080, height: 1080, original_name: `m${i}.${ext}` };
}
const ctx = () => ({
  pollMs: 1,
  log() {},
  sleep: () => new Promise((r) => setTimeout(r, 1)),
  toJpeg: async (item) => ({ path: item.path, mime: 'image/jpeg' }),
  publicUrl: async (item) => `https://demo.trycloudflare.com/m/tok/${path.basename(item.path)}`,
});

/* ---------------- configuración y credenciales ---------------- */

test('sanitizeConfig conserva ig_config_id de meta (solo si es numérico)', () => {
  assert.equal(central.sanitizeConfig(VIA_FB).networks.meta.ig_config_id, '222222222');
  const bad = central.sanitizeConfig({ ...BASE, networks: { meta: { client_id: 'M', ig_config_id: 'abc' } } });
  assert.equal(bad.networks.meta.ig_config_id, undefined);
});

test('credenciales: solo meta + ig_config_id → Instagram central "a través de Facebook"', async () => {
  const c = central.centralCredsFor('instagram');
  assert.deepEqual(c, { client_id: 'META_ID', extra: { config_id: '222222222' }, central: true, relay: RELAY, via: 'facebook' });
  // Facebook sigue usando SU configuración, sin la de Instagram
  assert.deepEqual(central.centralCredsFor('meta').extra, { config_id: '111111111' });
  const userId = newUser();
  assert.equal((await accounts.resolveCreds(userId, 'instagram')).via, 'facebook');
});

test('credenciales: si /config trae la familia instagram, se usa el camino de siempre', async () => {
  await useConfig(CLASSIC);
  const c = central.centralCredsFor('instagram');
  assert.equal(c.client_id, 'IG_ID');
  assert.equal(c.via, undefined);
});

test('credenciales: meta sin ig_config_id y sin instagram → Instagram no está en modo central', async () => {
  await useConfig({ ...BASE, networks: { meta: { client_id: 'META_ID' } } });
  assert.equal(central.centralCredsFor('instagram'), null);
});

test('credenciales: el carné propio de Instagram tiene preferencia y no va "a través de Facebook"', async () => {
  const userId = newUser();
  run("INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, 'instagram', 'ID_PROPIO', 'CS_PROPIO', '{}', ?)", userId, new Date().toISOString());
  const c = await accounts.resolveCreds(userId, 'instagram');
  assert.equal(c.client_id, 'ID_PROPIO');
  assert.equal(c.via, undefined);
  const u = new URL((await oauth.startOAuth({ id: userId }, 'instagram')).authUrl);
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
});

test('/api/networks: Instagram aparece como central y con notas de Página vinculada', () => {
  const info = networkInfo('instagram', new Set(), new Set(['meta', 'instagram'].filter((f) => central.centralCredsFor(f))));
  assert.equal(info.central, true);
  assert.equal(info.mode, 'central');
  assert.match(info.notes, /profesional/);
  assert.match(info.notes, /Página de Facebook/);
  assert.doesNotMatch(info.notes, /probador|tu app/);
});

test('notas en modo central clásico: sin hablar de Páginas', async () => {
  await useConfig(CLASSIC);
  const info = networkInfo('instagram', new Set(), new Set(['instagram']));
  assert.doesNotMatch(info.notes, /Página/);
});

/* ---------------- conexión ---------------- */

test('URL de autorización: diálogo de Facebook con la configuración de Instagram', async () => {
  const userId = newUser();
  const { authUrl, central: isCentral } = await oauth.startOAuth({ id: userId }, 'instagram');
  assert.equal(isCentral, true);
  const u = new URL(authUrl);
  assert.equal(u.origin + u.pathname, `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  assert.equal(u.searchParams.get('client_id'), 'META_ID');
  assert.equal(u.searchParams.get('redirect_uri'), RELAY);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('config_id'), '222222222');
  assert.equal(u.searchParams.get('override_default_response_type'), 'true');
  assert.equal(u.searchParams.get('scope'), null);
  assert.ok(u.searchParams.get('state'));
});

test('canje: broker meta (code + long_lived) → /me/accounts con paginación → cuenta con el Page token', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'instagram');
  on(`POST ${BROKER}/token/meta/code`, () => json({ access_token: 'SHORT', token_type: 'bearer' }));
  on(`POST ${BROKER}/token/meta/long_lived`, () => json({ access_token: 'LONG', expires_in: 5184000 }));
  on('GET https://graph.facebook.com/next-page', () => json({
    data: [{ id: 'P2', name: 'Página buceo', access_token: 'PAGE_T2',
      instagram_business_account: { id: 'IG2', username: 'atlantis', name: 'Atlantis', profile_picture_url: 'https://img/a.jpg' } }],
  }));
  on(`GET ${FB}/me/accounts`, (rec) => {
    const q = new URL(rec.url).searchParams;
    assert.equal(q.get('access_token'), 'LONG');
    assert.match(q.get('fields'), /instagram_business_account\{id,username,name,profile_picture_url\}/);
    assert.match(q.get('fields'), /access_token/);
    return json({
      data: [{ id: 'P1', name: 'Página sin Instagram', access_token: 'PAGE_T1' }],
      paging: { next: 'https://graph.facebook.com/next-page?after=x' },
    });
  });
  assert.equal(await oauth.handleCallback({ code: 'CODE#_=_', state: stateOf(authUrl) }), '/#/redes?ok=instagram');

  assert.deepEqual(brokerCalls().map((c) => [c.url.slice(BROKER.length), JSON.parse(c.body)]), [
    ['/token/meta/code', { code: 'CODE', redirect_uri: RELAY }],
    ['/token/meta/long_lived', { access_token: 'SHORT' }],
  ]);
  assert.equal(calls.some((c) => /graph\.instagram\.com|api\.instagram\.com|\/token\/instagram\//.test(c.url)), false);
  const acc = get("SELECT * FROM accounts WHERE user_id = ? AND network = 'instagram'", userId);
  assert.equal(acc.external_id, 'IG2');
  assert.equal(acc.access_token, 'PAGE_T2');
  assert.equal(acc.username, 'atlantis');
  assert.equal(acc.token_expires_at, null);
  const meta = JSON.parse(acc.meta);
  assert.equal(meta.via, 'facebook');
  assert.equal(meta.page_id, 'P2');
  assert.equal(meta.page_name, 'Página buceo');
  assert.equal(meta.username, 'atlantis');
  assert.equal(meta.auth_mode, 'central');
  assertNoSecretsSent();

  // Sin ig_refresh_token: el Page token no caduca (y no se llama a nada).
  calls.length = 0;
  const same = await accounts.ensureFreshToken(acc, { force: true });
  assert.equal(same.access_token, 'PAGE_T2');
  assert.equal(calls.filter((c) => !c.url.endsWith('/config')).length, 0);
});

test('canje: varias cuentas de Instagram → hay que elegir', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'instagram');
  on(`${BROKER}/token/meta/code`, () => json({ access_token: 'SHORT' }));
  on(`${BROKER}/token/meta/long_lived`, () => json({ access_token: 'LONG' }));
  on(`GET ${FB}/me/accounts`, () => json({ data: [
    { id: 'P1', name: 'A', access_token: 'T1', instagram_business_account: { id: 'IGA', username: 'a' } },
    { id: 'P2', name: 'B', access_token: 'T2', instagram_business_account: { id: 'IGB', username: 'b' } },
  ] }));
  const r = await oauth.handleCallback({ code: 'C', state: stateOf(authUrl) });
  assert.match(r, /^\/#\/redes\?pick=\d+$/);
  const picks = oauth.getPendingCandidates({ id: userId }, r.split('pick=')[1]);
  assert.deepEqual(picks.candidates.map((c) => c.external_id), ['IGA', 'IGB']);
  assert.doesNotMatch(JSON.stringify(picks), /T1|T2/);
});

test('canje: ninguna Página con Instagram profesional vinculado → error claro en español', async () => {
  const userId = newUser();
  const { authUrl } = await oauth.startOAuth({ id: userId }, 'instagram');
  on(`${BROKER}/token/meta/code`, () => json({ access_token: 'SHORT' }));
  on(`${BROKER}/token/meta/long_lived`, () => json({ access_token: 'LONG' }));
  on(`GET ${FB}/me/accounts`, () => json({ data: [{ id: 'P1', name: 'Sin IG', access_token: 'T1' }] }));
  const r = decodeURIComponent((await oauth.handleCallback({ code: 'C', state: stateOf(authUrl) })).split('error=')[1]);
  assert.match(r, /profesional \(Empresa o Creador/);
  assert.match(r, /vinculada a una Página de Facebook que administres/);
  assert.match(r, /marca tu cuenta de Instagram Y la Página/);
  assert.equal(get("SELECT COUNT(*) AS c FROM accounts WHERE user_id = ? AND network = 'instagram'", userId).c, 0);
});

/* ---------------- publicación ---------------- */

function publishRoutes(host) {
  let k = 0;
  on((r) => r.method === 'POST' && r.url.startsWith(`${host}/IGX/media_publish`), () => json({ id: 'PUB1' }));
  on((r) => r.method === 'POST' && r.url === `${host}/IGX/media`, () => json({ id: `C${++k}` }));
  on((r) => r.method === 'GET' && r.url.startsWith(`${host}/C`) && r.url.includes('status_code'), () => json({ status_code: 'FINISHED' }));
  on((r) => r.method === 'GET' && r.url.startsWith(`${host}/PUB1?`), () => json({ permalink: 'https://www.instagram.com/p/XYZ/' }));
}

test('publicar "a través de Facebook": carrusel, Reel y story en graph.facebook.com con el Page token', async () => {
  const host = FB;
  publishRoutes(host);
  const account = { external_id: 'IGX', access_token: 'PAGE_T', token_expires_at: null, meta: { via: 'facebook', page_id: 'P1', username: 'atlantis' } };

  let out = await instagram.publish({ account, type: 'carousel', caption: 'Hola', media: [mediaFile(1), mediaFile(2)], options: {}, ctx: ctx() });
  assert.deepEqual(out, { external_id: 'PUB1', url: 'https://www.instagram.com/p/XYZ/' });
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 4);
  assert.equal(form(posts[2]).media_type, 'CAROUSEL');
  assert.equal(form(posts[2]).children, 'C1,C2');
  assert.equal(form(posts[3]).creation_id, 'C3');

  out = await instagram.publish({ account, type: 'reel', caption: 'R', media: [mediaFile(3, { kind: 'video', mime: 'video/mp4', ext: 'mp4' })], options: {}, ctx: ctx() });
  assert.equal(out.external_id, 'PUB1');
  out = await instagram.publish({ account, type: 'story', caption: '', media: [mediaFile(4)], options: {}, ctx: ctx() });
  assert.equal(out.external_id, 'PUB1');

  const types = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/IGX/media')).map((c) => form(c).media_type || 'IMAGE');
  assert.deepEqual(types, ['IMAGE', 'IMAGE', 'CAROUSEL', 'REELS', 'STORIES']);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${FB}/`), `fuera de graph.facebook.com: ${c.url}`);
    const token = c.method === 'POST' ? form(c).access_token : new URL(c.url).searchParams.get('access_token');
    assert.equal(token, 'PAGE_T');
  }
  assert.equal(calls.some((c) => c.url.includes('graph.instagram.com')), false);
  assertNoSecretsSent();
});

test('publicar con una cuenta clásica sigue yendo a graph.instagram.com', async () => {
  const host = 'https://graph.instagram.com/v26.0';
  publishRoutes(host);
  const account = { external_id: 'IGX', access_token: 'IG_T', meta: { username: 'ana' } };
  const out = await instagram.publish({ account, type: 'post', caption: 'x', media: [mediaFile(5)], options: {}, ctx: ctx() });
  assert.equal(out.external_id, 'PUB1');
  for (const c of calls) assert.ok(c.url.startsWith(`${host}/`), c.url);
  assertNoSecretsSent();
});

test('refresh: cuenta "a través de Facebook" → null sin llamar a nada; la clásica sigue con ig_refresh_token', async () => {
  assert.equal(await instagram.refresh({ account: { access_token: 'PAGE_T', token_expires_at: null, meta: { via: 'facebook' } } }), null);
  assert.equal(calls.length, 0);
  on('graph.instagram.com/refresh_access_token', () => json({ access_token: 'NEW', expires_in: 5184000 }));
  const r = await instagram.refresh({ account: { access_token: 'OLD', token_expires_at: new Date(Date.now() + 10 * 86400000).toISOString(), meta: {} } });
  assert.equal(r.access_token, 'NEW');
});
