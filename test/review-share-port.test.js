// Si el puerto del servidor de medios lo tiene OTRO programa, el túnel de Cloudflare no se abre (expondría
// ese programa a internet) y la publicación falla con un mensaje claro que se puede reintentar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rev-port-'));
const intruder = net.createServer((sock) => sock.end('soy otro programa'));
const port = await new Promise((r) => intruder.listen(0, '127.0.0.1', () => r(intruder.address().port)));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_SHARE_PORT = String(port);
process.env.WILLYPOST_PUBLIC_BASE = 'https://prueba.trycloudflare.com';

const share = await import('../server/share.js');

before(() => {});
after(() => {
  intruder.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

test('puerto de medios ocupado por otro programa → no hay URL pública; error en español y reintentable', async () => {
  const file = path.join(dataDir, 'foto.jpg');
  fs.writeFileSync(file, 'x');
  await assert.rejects(share.publicUrl({ path: file, mime: 'image/jpeg' }), (e) => {
    assert.equal(e.name, 'ProviderError');
    assert.equal(e.retryable, true);
    assert.match(e.message, new RegExp(`puerto ${port} lo está usando otro programa`));
    return true;
  });
  // Cuando el otro programa libera el puerto, el siguiente intento funciona.
  await new Promise((r) => intruder.close(r));
  const url = await share.publicUrl({ path: file, mime: 'image/jpeg' });
  assert.match(url, /^https:\/\/prueba\.trycloudflare\.com\/m\/[a-f0-9]{64}\/media\.jpg$/);
  share.startShareServer().close();
});
