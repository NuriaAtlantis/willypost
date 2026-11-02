// /api/networks en modo central: arranca un WillyPost real (datos temporales) apuntando a un broker
// SIMULADO en este mismo ordenador (127.0.0.1, puerto aleatorio). Nada sale a internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4835;
const BASE = `http://localhost:${PORT}`;
const CONFIG = {
  version: 1,
  relay: 'https://willypost.com/callback.html',
  media: 'https://media.willypost.com',
  networks: {
    meta: { client_id: 'META_ID' },
    instagram: { client_id: 'IG_ID' },
    tiktok: { client_id: 'TT_KEY' },
    google: { client_id: 'G_ID', client_secret: 'G_DESKTOP' },
    // threads y linkedin NO están en modo central
  },
};

let proc;
let broker;
let brokerHits = 0;
let dataDir;
let cookie = '';

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = text; }
  return { status: res.status, body: j };
}

before(async () => {
  broker = http.createServer((req, res) => {
    brokerHits += 1;
    if (req.url === '/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(CONFIG));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"willypost_no_encontrado"}');
  });
  await new Promise((r) => broker.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-central-net-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      WILLYPOST_DATA: dataDir,
      WILLYPOST_PORT: String(PORT),
      WILLYPOST_SHARE_PORT: '4836',
      WILLYPOST_NO_DESKTOP_NOTIFY: '1',
      WILLYPOST_NO_SCHEDULER: '1',
      WILLYPOST_BROKER: `http://127.0.0.1:${broker.address().port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 200));
    if (i === 49) throw new Error(`El servidor no arrancó:\n${out}`);
  }
  const r = await api('POST', '/api/auth/register', { name: 'Ana', email: 'ana@central.test', password: 'contraseña-larga' });
  assert.equal(r.status, 200);
});

after(async () => {
  proc?.kill();
  await new Promise((r) => broker.close(r));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

test('/api/networks: marca central y mode por red (sin carné cuando el servidor central la ofrece)', async () => {
  const r = await api('GET', '/api/networks');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.map((n) => [n.id, n]));
  for (const id of ['facebook', 'instagram', 'tiktok', 'youtube', 'gbp']) {
    assert.equal(by[id].central, true, id);
    assert.equal(by[id].mode, 'central', id);
    assert.equal(by[id].credsConfigured, false, id);
  }
  for (const id of ['threads', 'linkedin']) {
    assert.equal(by[id].central, false, id);
    assert.equal(by[id].mode, 'carne', id);
  }
  assert.equal(by.bluesky.central, false);
  assert.equal(by.bluesky.mode, 'password');
  // Notas sin instrucciones de "tu app de Meta" en modo central
  assert.doesNotMatch(by.instagram.notes, /probador|tu app/);
  // La URI de redirección que se enseña es la del carné propio (la que el alumno pegaría en SU app)
  assert.equal(by.tiktok.redirectUri, `http://localhost:${PORT}/oauth/callback`);
  // Nada secreto en la respuesta
  assert.doesNotMatch(JSON.stringify(r.body), /G_DESKTOP|client_secret/);
  assert.ok(brokerHits >= 1);
});

test('/api/networks: con carné propio guardado, la red pasa a mode "own" (sigue indicando que existe la opción central)', async () => {
  let r = await api('PUT', '/api/credentials/tiktok', { client_id: 'CK_PROPIA', client_secret: 'CS_PROPIO' });
  assert.equal(r.status, 200);
  r = await api('GET', '/api/networks');
  const tt = r.body.find((n) => n.id === 'tiktok');
  assert.equal(tt.mode, 'own');
  assert.equal(tt.credsConfigured, true);
  assert.equal(tt.central, true);
  // /api/credentials no cambia de forma ni enseña secretos
  r = await api('GET', '/api/credentials');
  const c = r.body.find((x) => x.family === 'tiktok');
  assert.deepEqual(Object.keys(c).sort(), ['client_id', 'config_id', 'configured', 'family', 'networks', 'updated_at']);
  assert.doesNotMatch(JSON.stringify(r.body), /CS_PROPIO/);
  // Volver a quitarlo → otra vez sin carné
  await api('DELETE', '/api/credentials/tiktok');
  r = await api('GET', '/api/networks');
  assert.equal(r.body.find((n) => n.id === 'tiktok').mode, 'central');
});

test('Conectar en modo central devuelve la URL de autorización de la app de WillyPost (relé https)', async () => {
  let r = await api('POST', '/api/accounts/connect/instagram');
  assert.equal(r.status, 200);
  const u = new URL(r.body.authUrl);
  assert.equal(u.searchParams.get('client_id'), 'IG_ID');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://willypost.com/callback.html');
  assert.equal(r.body.central, true);
  // Una red que no está en modo central sigue pidiendo carné
  r = await api('POST', '/api/accounts/connect/linkedin');
  assert.equal(r.status, 400);
  assert.match(r.body.error || JSON.stringify(r.body), /carné/);
});
