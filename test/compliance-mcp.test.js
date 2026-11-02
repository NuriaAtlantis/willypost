// El servidor MCP (Claude) no puede elegir la privacidad, las interacciones ni el contenido comercial de TikTok.
// MCP real por stdio contra una API falsa (nunca toca los datos reales).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js');
const TOKEN = 'wp_compliance_token';
const accounts = [
  { id: 7, network: 'tiktok', name: 'Willy TikTok', username: 'willytok', mode: 'api', status: 'ok', days_left: 20, last_error: null },
  { id: 8, network: 'youtube', name: 'Willy YT', username: 'willyyt', mode: 'api', status: 'ok', days_left: 20, last_error: null },
];
const sent = [];
const stored = {
  id: 55, type: 'reel', caption: 'x', status: 'draft', scheduled_at: null, created_by: 'claude', campaign: null, notes: '', media: [{ id: 1 }],
  targets: [{ id: 1, account_id: 7, network: 'tiktok', account_name: '@willytok', caption_override: null, options: { tiktok_mode: 'direct', tiktok_privacy: 'FOLLOWER_OF_CREATOR' }, delivery: 'api', status: 'pending' }],
};
let fake;
let client;

before(async () => {
  fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'No autorizado' });
      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/health') return send(200, { ok: true });
      if (route === 'GET /api/me') return send(200, { user: { id: 1, name: 'Ana' }, settings: { claude_mode: 'draft', queue_times: ['09:00'], timezone: 'Europe/Madrid' } });
      if (route === 'GET /api/accounts') return send(200, accounts);
      if (route === 'GET /api/campaigns') return send(200, []);
      if (route === 'GET /api/slots') return send(200, []);
      if (route === 'GET /api/posts/55') return send(200, stored);
      if (route === 'POST /api/posts' || route === 'PUT /api/posts/55') {
        sent.push(body);
        return send(201, { ...stored, ...body, id: 55, status: 'draft', targets: stored.targets, warnings: [] });
      }
      return send(404, { error: `Ruta no simulada: ${route}` });
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', SERVER],
    env: { ...process.env, WILLYPOST_URL: `http://127.0.0.1:${fake.address().port}`, WILLYPOST_TOKEN: TOKEN },
    stderr: 'pipe',
  });
  client = new Client({ name: 'compliance-test', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  fake?.close();
});

const textOf = (r) => r.content.map((x) => x.text).join('\n');

test('MCP create_post: si Claude intenta poner la privacidad de TikTok, error claro y no se crea nada', async () => {
  const before = sent.length;
  for (const opts of [{ tiktok_privacy: 'PUBLIC_TO_EVERYONE' }, { commercial: true, brand_organic: true }, { allow_comment: true }, { disable_duet: true }]) {
    const r = await client.callTool({ name: 'create_post', arguments: { type: 'reel', caption: 'Vídeo', networks: ['tiktok'], media_ids: [1], options_by_network: { tiktok: { tiktok_mode: 'direct', ...opts } } } });
    assert.equal(r.isError, true, JSON.stringify(opts));
    assert.match(textOf(r), /los elige el alumno en WillyPost al aprobar/);
  }
  assert.equal(sent.length, before);
});

test('MCP create_post: con solo tiktok_mode sí crea el borrador', async () => {
  const r = await client.callTool({ name: 'create_post', arguments: { type: 'reel', caption: 'Vídeo', networks: ['tiktok'], media_ids: [1], options_by_network: { tiktok: { tiktok_mode: 'direct' } } } });
  assert.ok(!r.isError, textOf(r));
  assert.deepEqual(sent.at(-1).targets[0].options, { tiktok_mode: 'direct' });
  assert.equal(sent.at(-1).created_by, 'claude');
});

test('MCP update_post: no puede cambiar la privacidad de TikTok, pero conserva la que eligió la persona', async () => {
  let r = await client.callTool({ name: 'update_post', arguments: { id: 55, options_by_network: { tiktok: { tiktok_privacy: 'SELF_ONLY' } } } });
  assert.equal(r.isError, true);
  r = await client.callTool({ name: 'update_post', arguments: { id: 55, caption: 'Texto nuevo' } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(sent.at(-1).targets[0].options.tiktok_privacy, 'FOLLOWER_OF_CREATOR');
});

test('MCP: las descripciones explican que la persona elige las opciones de TikTok y que YouTube pide título y visibilidad', async () => {
  const { tools } = await client.listTools();
  const create = tools.find((t) => t.name === 'create_post');
  assert.match(create.description, /TikTok: NO pongas privacidad/);
  assert.match(create.description, /YouTube: pon title y privacy/);
  const specs = await client.callTool({ name: 'get_network_specs', arguments: { network: 'tiktok' } });
  assert.match(textOf(specs), /elige SIEMPRE el alumno/);
});
