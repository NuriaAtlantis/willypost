// Túnel de medios: un vídeo grande que Instagram/Threads tarda mucho en descargar (conexión lenta) no debe
// quedarse a medias porque el túnel se cierre "por inactividad" mientras se descarga.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rev-share-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_SHARE_PORT = '0'; // nunca el 4747/4748 de la instalación real
process.env.WILLYPOST_PUBLIC_BASE = 'https://prueba.trycloudflare.com';
process.env.WILLYPOST_TUNNEL_IDLE_MS = '150';

const share = await import('../server/share.js');

let srv;
let port;
const big = path.join(dataDir, 'video.mp4');

before(async () => {
  fs.writeFileSync(big, Buffer.alloc(48 * 1024 * 1024, 7));
  srv = http.createServer(share.handleShareRequest);
  port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
});

after(() => {
  share._setTunnelForTests(null);
  share.startShareServer().close(); // publicUrl abre el servidor de medios (en un puerto libre)
  srv?.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('el túnel no se cierra mientras una descarga sigue en curso; sí cuando termina y pasa el tiempo de inactividad', async () => {
  let killed = 0;
  share._setTunnelForTests({ proc: { kill() { killed++; } }, url: 'https://prueba.trycloudflare.com' });
  const url = await share.publicUrl({ path: big, mime: 'video/mp4' });
  const pathname = new URL(url).pathname;

  // Una "red" que descarga muy despacio: abre la conexión y no lee durante más que el tiempo de inactividad.
  const res = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, resolve).on('error', reject);
  });
  assert.equal(res.statusCode, 200);
  res.pause();
  await wait(500);
  assert.equal(killed, 0, 'no se corta a mitad de descarga');

  let bytes = 0;
  res.on('data', (c) => { bytes += c.length; });
  await new Promise((r) => { res.on('end', r); res.resume(); });
  assert.equal(bytes, 48 * 1024 * 1024);
  await wait(500);
  assert.equal(killed, 1, 'terminada la descarga, el túnel se cierra por inactividad');
});
