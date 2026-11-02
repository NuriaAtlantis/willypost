// Modo central: configuración (/config con caché de 1 h y copia en disco), cliente del broker,
// direcciones derivadas del dominio y reescritura de URLs para el proxy de medios de TikTok.
// Sin internet: fetch está simulado y el broker es una dirección ficticia.
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-central-cfg-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_PORT = '4831';
process.env.WILLYPOST_SHARE_PORT = '4832';
process.env.WILLYPOST_BROKER = 'https://broker.example.test';
delete process.env.WILLYPOST_RELAY;
delete process.env.WILLYPOST_DOMAIN;

const config = await import('../server/config.js');
const central = await import('../server/central.js');
const { providers } = await import('../server/providers/index.js');
const { ProviderError } = await import('../server/providers/_http.js');

const BROKER = 'https://broker.example.test';
const CONFIG = {
  version: 1,
  relay: 'https://willypost.com/callback.html',
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
let handler;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  handler = () => json(CONFIG);
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    return handler(String(url), init);
  };
  central._resetCentralCache();
  fs.rmSync(path.join(dataDir, 'central.json'), { force: true });
});
afterEach(() => { globalThis.fetch = realFetch; });
after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ } });

test('config: todas las direcciones salen de un solo dominio (willypost.com)', () => {
  assert.equal(config.DOMAIN, 'willypost.com');
  assert.equal(config.SITE_URL, 'https://willypost.com/');
  assert.equal(config.BROKER_URL, 'https://auth.willypost.com');
  assert.equal(config.MEDIA_PROXY, 'https://media.willypost.com');
  assert.equal(config.RELAY_URL, 'https://willypost.com/callback.html');
  assert.doesNotMatch(config.RELAY_URL, /github\.io/);
});

test('broker: WILLYPOST_BROKER manda; "off" lo apaga; dentro de node --test sin variable queda apagado (nunca internet)', () => {
  assert.equal(central.brokerBase(), BROKER);
  const prev = process.env.WILLYPOST_BROKER;
  try {
    process.env.WILLYPOST_BROKER = 'off';
    assert.equal(central.brokerBase(), null);
    delete process.env.WILLYPOST_BROKER;
    assert.ok(process.env.NODE_TEST_CONTEXT, 'el runner de tests marca NODE_TEST_CONTEXT');
    assert.equal(central.brokerBase(), null);
    process.env.WILLYPOST_BROKER = 'https://otro.example.test///';
    assert.equal(central.brokerBase(), 'https://otro.example.test');
  } finally {
    process.env.WILLYPOST_BROKER = prev;
  }
});

test('config: se pide /config una vez, se guarda en caché (1 h) y en DATA_DIR/central.json', async () => {
  const a = await central.loadCentralConfig();
  const b = await central.loadCentralConfig();
  assert.equal(calls.length, 1, 'la segunda vez sale de la caché');
  assert.equal(calls[0].url, `${BROKER}/config`);
  assert.deepEqual(a, b);
  assert.equal(a.relay, 'https://willypost.com/callback.html');
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'central.json'), 'utf8'));
  assert.equal(saved.data.networks.tiktok.client_id, 'TT_KEY');
  assert.ok(saved.fetchedAt > 0);

  // force vuelve a preguntar
  await central.loadCentralConfig({ force: true });
  assert.equal(calls.length, 2);
});

test('config: pasada la hora se vuelve a pedir', async () => {
  fs.writeFileSync(path.join(dataDir, 'central.json'), JSON.stringify({ data: CONFIG, fetchedAt: Date.now() - central.CONFIG_TTL_MS - 1000 }));
  central._resetCentralCache();
  handler = () => json({ ...CONFIG, networks: { ...CONFIG.networks, tiktok: { client_id: 'TT_NUEVA' } } });
  await central.loadCentralConfig();
  assert.equal(calls.length, 1);
  assert.equal(central.centralCredsFor('tiktok').client_id, 'TT_NUEVA');
});

test('config: sin conexión vale la última copia guardada en disco; sin copia, no hay modo central', async () => {
  await central.loadCentralConfig(); // guarda la copia
  central._resetCentralCache();
  // Copia antigua (caducada) + sin internet → se usa la copia igualmente.
  const file = path.join(dataDir, 'central.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.fetchedAt = 1;
  fs.writeFileSync(file, JSON.stringify(saved));
  handler = () => { throw new TypeError('fetch failed'); };
  const cfg = await central.loadCentralConfig();
  assert.equal(cfg.networks.meta.client_id, 'META_ID');
  assert.equal(central.centralCredsFor('instagram').client_id, 'IG_ID');
  // No reintenta en cada clic mientras no hay conexión.
  const n = calls.length;
  await central.loadCentralConfig();
  assert.equal(calls.length, n);

  // Sin copia y sin conexión
  fs.rmSync(file, { force: true });
  central._resetCentralCache();
  assert.equal(await central.loadCentralConfig(), null);
  assert.equal(central.centralCredsFor('meta'), null);
});

test('config: un /config roto (HTTP 500 o JSON raro) no rompe nada', async () => {
  handler = () => json({ error: 'x' }, 500);
  assert.equal(await central.loadCentralConfig(), null);
  central._resetCentralCache();
  handler = () => new Response('<html>', { status: 200 });
  assert.equal(await central.loadCentralConfig(), null);
});

test('centralCredsFor: solo datos públicos; config_id de Meta; secreto SOLO para Google (escritorio)', async () => {
  await central.loadCentralConfig();
  assert.deepEqual(central.centralCredsFor('meta'), {
    client_id: 'META_ID', extra: { config_id: '123456789' }, central: true, relay: 'https://willypost.com/callback.html',
  });
  for (const fam of ['instagram', 'threads', 'tiktok', 'linkedin']) {
    const c = central.centralCredsFor(fam);
    assert.equal(c.central, true, fam);
    assert.equal('client_secret' in c, false, `${fam} no lleva secreto`);
  }
  assert.equal(central.centralCredsFor('google').client_secret, 'G_DESKTOP_SECRET');
  assert.equal(central.centralCredsFor('bluesky'), null);
  assert.equal(central.centralCredsFor('desconocida'), null);
});

test('sanitizeConfig: descarta redes incompletas, config_id raro y URLs que no son https', () => {
  const c = central.sanitizeConfig({
    relay: 'http://malo.example/callback.html',
    media: 'javascript:alert(1)',
    networks: {
      meta: { client_id: 'M', config_id: 'no-numerico' },
      google: { client_id: 'G' }, // sin secreto de escritorio: no sirve
      tiktok: { client_id: '' },
      linkedin: 'cadena',
      inventada: { client_id: 'X' },
    },
  });
  assert.deepEqual(Object.keys(c.networks), ['meta']);
  assert.equal(c.networks.meta.config_id, undefined);
  assert.equal(c.relay, config.RELAY_URL);
  assert.equal(c.media, config.MEDIA_PROXY);
  assert.equal(central.sanitizeConfig(null), null);
  assert.equal(central.sanitizeConfig([]), null);
});

test('centralToken: POST JSON a /token/:family/:op y devuelve la respuesta de la red tal cual (también si es un error de la red)', async () => {
  handler = (url) => (url.endsWith('/token/meta/code') ? json({ access_token: 'T', token_type: 'bearer' }) : json({ error: { message: 'Invalid code', code: 100 } }, 400));
  const ok = await central.centralToken('meta', 'code', { code: 'C', redirect_uri: 'https://willypost.com/callback.html' });
  assert.deepEqual(ok, { status: 200, json: { access_token: 'T', token_type: 'bearer' } });
  assert.equal(calls[0].url, `${BROKER}/token/meta/code`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), { code: 'C', redirect_uri: 'https://willypost.com/callback.html' });

  const bad = await central.centralToken('meta', 'long_lived', { access_token: 'T' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.message, 'Invalid code');
  // centralFetchJson lo convierte en el mismo ProviderError que una llamada directa
  await assert.rejects(central.centralFetchJson('meta', 'long_lived', { access_token: 'T' }, { label: 'Facebook' }),
    (e) => e instanceof ProviderError && /Facebook: Invalid code/.test(e.message) && e.status === 400);
});

test('centralToken: errores propios del broker (willypost_*) → mensajes en español sin jerga', async () => {
  const cases = [
    [404, 'willypost_no_configurada', /no está disponible ahora mismo.*opción avanzada/, false],
    [429, 'willypost_demasiadas', /muchas peticiones/, true],
    [502, 'willypost_red_caida', /TikTok no responde ahora mismo/, true],
    [502, 'willypost_respuesta_no_valida', /TikTok ha contestado algo inesperado/, true],
    [500, 'willypost_error_interno', /fallo momentáneo/, true],
    [400, 'willypost_tipo_no_valido', /Vuelve a pulsar Conectar/, false],
    [405, 'willypost_metodo', /Vuelve a pulsar Conectar/, false],
    [413, 'willypost_demasiado_grande', /Vuelve a pulsar Conectar/, false],
  ];
  for (const [status, code, re, retryable] of cases) {
    handler = () => json({ error: code, message: 'texto del broker' }, status);
    await assert.rejects(central.centralToken('tiktok', 'code', {}), (e) => {
      assert.ok(e instanceof ProviderError, code);
      assert.equal(e.central, true);
      assert.match(e.message, re, code);
      assert.doesNotMatch(e.message, /willypost_/);
      assert.equal(e.retryable, retryable, code);
      return true;
    });
  }
  handler = () => { throw new TypeError('fetch failed'); };
  await assert.rejects(central.centralToken('linkedin', 'code', {}), (e) => e.retryable && e.central && /servidor de WillyPost/.test(e.message));
});

test('mediaProxyUrl: túnel → media.willypost.com/t/<sub>/m/<token>/<archivo> (extensión en minúsculas); lo demás no se toca', () => {
  const tok = 'a'.repeat(64);
  assert.equal(
    central.mediaProxyUrl(`https://bright-fox-42.trycloudflare.com/m/${tok}/media.jpg`),
    `https://media.willypost.com/t/bright-fox-42/m/${tok}/media.jpg`,
  );
  assert.equal(
    central.mediaProxyUrl(`https://bright-fox-42.trycloudflare.com/m/${tok}/media.JPG`),
    `https://media.willypost.com/t/bright-fox-42/m/${tok}/media.jpg`,
  );
  for (const u of [
    `https://publico.example.test/m/${tok}/media.jpg`, // no es el túnel
    `https://x.trycloudflare.com/m/${tok}/media.jpg`, // subdominio demasiado corto
    `https://bright-fox.trycloudflare.com/m/corto/media.jpg`, // token raro
    `https://bright-fox.trycloudflare.com/m/${tok}/media.exe`, // extensión no admitida
    `https://bright-fox.trycloudflare.com/m/${tok}/media.jpg?x=1`,
  ]) assert.equal(central.mediaProxyUrl(u), u, u);
});

test('share: las URLs públicas llevan la extensión en minúsculas', async () => {
  process.env.WILLYPOST_PUBLIC_BASE = 'https://publico.example.test';
  const share = await import('../server/share.js');
  const f = path.join(dataDir, 'FOTO.JPG');
  fs.writeFileSync(f, 'x');
  try {
    const u = await share.publicUrl({ path: f, mime: 'image/jpeg' });
    assert.match(u, /^https:\/\/publico\.example\.test\/m\/[a-f0-9]{64}\/media\.jpg$/);
  } finally {
    // publicUrl arranca el mini servidor de medios: se cierra para que el test termine.
    const srv = share.startShareServer();
    await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
    share.stopTunnel();
  }
});

test('redirectUriFor: carné propio como siempre; modo central → relé (TikTok incluido) y Google → localhost', () => {
  const cen = { central: true, relay: 'https://willypost.com/callback.html' };
  for (const id of ['facebook', 'instagram', 'threads', 'linkedin', 'tiktok']) {
    assert.equal(config.redirectUriFor(providers[id], cen), 'https://willypost.com/callback.html', id);
  }
  for (const id of ['youtube', 'gbp']) assert.equal(config.redirectUriFor(providers[id], cen), config.LOCAL_REDIRECT, id);
  // carné propio: sin cambios
  assert.equal(config.redirectUriFor(providers.tiktok, { client_id: 'x' }), config.LOCAL_REDIRECT);
  assert.equal(config.redirectUriFor(providers.facebook, { client_id: 'x' }), config.RELAY_URL);
  assert.equal(config.LOCAL_REDIRECT, 'http://localhost:4831/oauth/callback');
});
