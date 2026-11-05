// Claude y la zona horaria de Canarias: un desfase que no es el del alumno (el típico "+01:00" de la
// península en invierno) haría salir la publicación una hora antes. El servidor MCP lo rechaza y explica cómo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js');
const TOKEN = 'wp_tz_token';
const Y = new Date().getFullYear() + 1;
const posts = [];
let fake;
let client;

before(async () => {
  fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const route = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      if (route === 'GET /api/me') return send(200, { user: { id: 1, name: 'Nuria' }, settings: { claude_mode: 'draft', queue_times: ['09:00'], timezone: 'Atlantic/Canary' } });
      if (route === 'GET /api/accounts') return send(200, [{ id: 1, network: 'instagram', name: 'Atlantis', username: 'atlantis', mode: 'api', status: 'ok' }]);
      if (route === 'GET /api/slots') return send(200, []);
      if (route === 'POST /api/posts') {
        posts.push(body);
        return send(201, { id: posts.length, type: body.type, status: 'draft', scheduled_at: body.scheduled_at, created_by: 'claude', targets: [], warnings: [] });
      }
      return send(404, { error: route });
    });
  });
  const port = await new Promise((r) => fake.listen(0, '127.0.0.1', () => r(fake.address().port)));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', SERVER],
    env: { ...process.env, WILLYPOST_URL: `http://127.0.0.1:${port}`, WILLYPOST_TOKEN: TOKEN },
    stderr: 'pipe',
  });
  client = new Client({ name: 'tz-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  fake?.close();
});

const textOf = (r) => r.content.map((x) => x.text).join('\n');
const create = (scheduled_at) => client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'Bautismo de buceo', networks: ['instagram'], scheduled_at } });

test('Canarias en invierno: "+01:00" se rechaza con la hora correcta sugerida; "+00:00" y "Z" valen', async () => {
  let r = await create(`${Y}-01-15T10:00:00+01:00`);
  assert.equal(r.isError, true);
  assert.match(textOf(r), /Atlantic\/Canary/);
  assert.match(textOf(r), new RegExp(`envía ${Y}-01-15T10:00:00\\+00:00`));
  assert.equal(posts.length, 0, 'no se crea nada con la hora mal');

  r = await create(`${Y}-01-15T10:00:00+00:00`);
  assert.ok(!r.isError, textOf(r));
  assert.equal(posts.at(-1).scheduled_at, `${Y}-01-15T10:00:00.000Z`);

  r = await create(`${Y}-01-15T11:00:00Z`);
  assert.ok(!r.isError, textOf(r));
  assert.equal(posts.at(-1).scheduled_at, `${Y}-01-15T11:00:00.000Z`);
});

test('Canarias en verano: "+01:00" es correcto; "+02:00" (hora de Madrid) no; UTC explícito siempre vale', async () => {
  let r = await create(`${Y}-07-15T10:00:00+01:00`);
  assert.ok(!r.isError, textOf(r));
  assert.equal(posts.at(-1).scheduled_at, `${Y}-07-15T09:00:00.000Z`);
  r = await create(`${Y}-07-15T10:00:00+02:00`);
  assert.equal(r.isError, true);
  assert.match(textOf(r), new RegExp(`envía ${Y}-07-15T10:00:00\\+01:00`));
  r = await create(`${Y}-07-15T10:00:00+00:00`);
  assert.ok(!r.isError, textOf(r));
  assert.equal(posts.at(-1).scheduled_at, `${Y}-07-15T10:00:00.000Z`);
});
