// Prueba del servidor MCP contra una API falsa (sin tocar la base de datos real).
// Ejecutar: node --test test/mcp.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js');
const TOKEN = 'wp_test_token';

// Fechas relativas a hoy (el servidor MCP rechaza fechas pasadas). Las 10:00 UTC son mediodía en Madrid: siempre el mismo día local.
const TZ = 'Europe/Madrid';
function day(n) {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const at = (n, hhmm = '10:00') => `${day(n)}T${hhmm}:00Z`;
const FULL_DAY = day(2);

const accounts = [
  { id: 1, network: 'instagram', name: 'Willy SEO', username: 'willyseo', mode: 'api', status: 'ok', days_left: 20, last_error: null },
  { id: 2, network: 'tiktok', name: 'Willy TikTok', username: 'willytok', mode: 'api', status: 'ok', days_left: 12, last_error: null },
  { id: 3, network: 'linkedin', name: 'Willy LinkedIn', username: null, mode: 'api', status: 'expired', days_left: 0, last_error: null },
];

const received = { posts: [], campaigns: [], uploads: [] };
let nextId = 100;
let fake;
let baseUrl;
let client;
let tmp;

function startFake() {
  return new Promise((resolve) => {
    fake = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        const send = (status, obj) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'No autorizado' });
        const route = `${req.method} ${url.pathname}`;
        if (route === 'GET /api/health') return send(200, { ok: true, version: '1.0.0' });
        if (route === 'GET /api/me') {
          return send(200, {
            user: { id: 1, name: 'Ana', email: 'ana@example.com' },
            settings: { claude_mode: 'draft', queue_times: ['09:00', '13:30', '19:00'], timezone: TZ },
          });
        }
        if (route === 'GET /api/accounts') return send(200, accounts);
        if (route === 'GET /api/slots') return send(200, [{ date: FULL_DAY, account_id: 1, feed: 5, story: 0, feedMax: 5, storyMax: 10 }]);
        if (route === 'GET /api/campaigns') return send(200, received.campaigns);
        if (route === 'POST /api/campaigns') {
          const c = { id: received.campaigns.length + 1, name: body.name, description: body.description || null, color: '#5881B9' };
          received.campaigns.push(c);
          return send(201, c);
        }
        if (route === 'POST /api/media/from-path') {
          received.uploads.push(body.path);
          if (!fs.existsSync(body.path)) return send(400, { error: `No encuentro el archivo: ${body.path}` });
          const id = 500 + received.uploads.length;
          return send(200, { id, kind: /\.mp4$/i.test(body.path) ? 'video' : 'image', original_name: path.basename(body.path), width: 1080, height: 1350, size: fs.statSync(body.path).size });
        }
        if (route === 'GET /api/posts') {
          return send(200, received.posts.map((p) => p.stored));
        }
        if (route === 'POST /api/posts') {
          if (String(body.caption).includes('PROHIBIDO')) return send(403, { error: 'En modo borrador, Claude no puede aprobar publicaciones.' });
          if (String(body.caption).includes('EXPLOTA')) {
            return send(400, { error: 'Revisa estos puntos antes de programar:', details: [{ network: 'tiktok', message: 'TikTok: falta el vídeo' }] });
          }
          const id = nextId++;
          const stored = {
            id, type: body.type, caption: body.caption, status: 'draft',
            scheduled_at: body.scheduled_at, created_by: body.created_by,
            campaign: body.campaign_id ? received.campaigns.find((c) => c.id === body.campaign_id) || null : null,
            notes: body.notes || '', media: [],
            targets: body.targets.map((t, i) => {
              const a = accounts.find((x) => x.id === t.account_id);
              return {
                id: id * 10 + i, account_id: a.id, network: a.network, account_name: `@${a.username}`,
                caption: t.caption || body.caption, caption_override: t.caption, options: t.options,
                delivery: a.network === 'tiktok' && body.type === 'carousel' ? 'manual' : 'api', status: 'pending',
              };
            }),
          };
          received.posts.push({ body, stored });
          return send(201, { ...stored, warnings: [{ message: 'Guardado como borrador "Propuesto por Claude": apruébalo en WillyPost para programarlo.' }] });
        }
        return send(404, { error: `Ruta no simulada: ${route}` });
      });
    });
    fake.listen(0, '127.0.0.1', () => resolve(fake.address().port));
  });
}

function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=ExperimentalWarning', SERVER],
    env: { ...process.env, ...env },
    stderr: 'pipe',
  });
  const c = new Client({ name: 'willypost-test', version: '0.0.0' });
  return c.connect(transport).then(() => c);
}

const textOf = (r) => r.content.map((x) => x.text).join('\n');

before(async () => {
  const port = await startFake();
  baseUrl = `http://127.0.0.1:${port}`;
  client = await connect({ WILLYPOST_URL: baseUrl, WILLYPOST_TOKEN: TOKEN });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-mcp-media-'));
});

after(async () => {
  await client?.close();
  fake?.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

test('lista las herramientas y el prompt de campaña', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const n of [
    'willypost_status', 'list_accounts', 'get_calendar', 'get_free_slots', 'upload_media', 'list_media',
    'create_post', 'create_campaign', 'update_post', 'delete_post', 'get_network_specs',
  ]) assert.ok(names.includes(n), `falta la herramienta ${n}`);
  assert.equal(names.length, 11);
  const create = tools.find((t) => t.name === 'create_post');
  assert.match(create.description, /5 publicaciones de feed y 10 stories/);
  assert.match(create.description, /MODO MANUAL/);
  // Cada herramienta debe tener descripción y los parámetros con su explicación (Claude los lee).
  for (const t of tools) assert.ok(t.description && t.description.length > 40, `descripción corta en ${t.name}`);
  const sched = create.inputSchema.properties.scheduled_at;
  assert.match(sched.description, /desfase/);
  assert.match(tools.find((t) => t.name === 'upload_media').description, /CARPETA/);

  const { prompts } = await client.listPrompts();
  assert.ok(prompts.some((p) => p.name === 'campana'));
  const p = await client.getPrompt({ name: 'campana', arguments: { objetivo: 'Vender el curso de SEO local', redes: 'Instagram y TikTok', duracion: '2 semanas' } });
  assert.match(p.messages[0].content.text, /Vender el curso de SEO local/);
  assert.match(p.messages[0].content.text, /create_campaign/);
});

test('willypost_status muestra cuentas, hora local y modo', async () => {
  const r = await client.callTool({ name: 'willypost_status', arguments: {} });
  assert.ok(!r.isError, textOf(r));
  const t = textOf(r);
  assert.match(t, /Europe\/Madrid/);
  assert.match(t, /draft/);
  assert.match(t, /Instagram @willyseo/);
  assert.match(t, /5 publicaciones de feed.*10 stories/);
  assert.match(t, /CADUCADA/);
});

test('create_post mapea networks a account_ids, textos por red y marca created_by claude', async () => {
  const r = await client.callTool({
    name: 'create_post',
    arguments: {
      type: 'reel',
      caption: 'Texto base',
      networks: ['instagram', 'tiktok'],
      captions_by_network: { tiktok: 'Texto TikTok #seo' },
      media_ids: [7],
      scheduled_at: at(3, '09:30').replace('Z', '+00:00'),
      campaign: 'Black Friday',
      notes: 'grabar en vertical',
    },
  });
  assert.ok(!r.isError, textOf(r));
  const sent = received.posts.at(-1).body;
  assert.equal(sent.created_by, 'claude');
  assert.equal(sent.action, 'schedule');
  assert.equal(sent.scheduled_at, `${day(3)}T09:30:00.000Z`);
  assert.deepEqual(sent.media_ids, [7]);
  assert.deepEqual(sent.targets.map((t) => t.account_id), [1, 2]);
  assert.equal(sent.targets[0].caption, null);
  assert.equal(sent.targets[1].caption, 'Texto TikTok #seo');
  assert.equal(sent.campaign_id, 1, 'crea la campaña por nombre');
  assert.match(textOf(r), /Propuesto por Claude|propuesta por Claude/i);
});

test('create_post sin fecha va como borrador y con carrusel en TikTok avisa del modo manual', async () => {
  const r = await client.callTool({ name: 'create_post', arguments: { type: 'carousel', caption: 'Hola', networks: ['tiktok'] } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(received.posts.at(-1).body.action, 'draft');
  assert.match(textOf(r), /MODO MANUAL/);
});

test('create_post rechaza fechas sin desfase horario y las que ya han pasado', async () => {
  const before = received.posts.length;
  let r = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'x', networks: ['instagram'], scheduled_at: `${day(3)}T09:30:00` } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /desfase/);
  r = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'x', networks: ['instagram'], scheduled_at: '2020-01-01T09:30:00+01:00' } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /ya ha pasado/);
  assert.equal(received.posts.length, before);
});

test('create_post avisa si la red no está conectada o está caducada', async () => {
  let r = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'x', networks: ['bluesky'] } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /Bluesky conectada/);
  r = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'x', networks: ['linkedin'] } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /caducadas/);
});

test('create_post avisa ANTES de crear si el día está lleno', async () => {
  const before = received.posts.length;
  const r = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'x', networks: ['instagram'], scheduled_at: at(2, '12:00') } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /máximo 5 al día/);
  assert.equal(received.posts.length, before, 'no debe llamar a la API de crear');
  // Una story sí cabe ese día (límite aparte).
  const ok = await client.callTool({ name: 'create_post', arguments: { type: 'story', caption: 'x', networks: ['instagram'], scheduled_at: at(2, '12:00') } });
  assert.ok(!ok.isError, textOf(ok));
});

test('un error 403 se muestra tal cual y explica que lo hace el alumno', async () => {
  const r = await client.callTool({ name: 'create_post', arguments: { type: 'post', caption: 'PROHIBIDO', networks: ['instagram'] } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /En modo borrador, Claude no puede aprobar publicaciones./);
  assert.match(textOf(r), /el alumno directamente en WillyPost/);
});

test('get_calendar lista las publicaciones', async () => {
  const r = await client.callTool({ name: 'get_calendar', arguments: { from: day(0), to: day(30) } });
  assert.ok(!r.isError, textOf(r));
  const t = textOf(r);
  assert.match(t, /Texto base/);
  assert.match(t, /Black Friday/);
  assert.match(t, /propuesto por Claude/);
});

test('get_free_slots indica los días llenos', async () => {
  const r = await client.callTool({ name: 'get_free_slots', arguments: { from: day(0), to: day(30) } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), new RegExp(`${FULL_DAY} · Instagram @willyseo: feed 5/5.*LLENO`));
});

test('create_campaign continúa tras errores y omite lo que supera el límite diario', async () => {
  const n = received.posts.length;
  const r = await client.callTool({
    name: 'create_campaign',
    arguments: {
      name: 'Lanzamiento',
      description: 'Prueba',
      posts: [
        { type: 'post', caption: 'Pieza buena 1', networks: ['instagram'], scheduled_at: at(4) },
        { type: 'post', caption: 'EXPLOTA', networks: ['tiktok'], scheduled_at: at(5) },
        { type: 'post', caption: 'Día lleno', networks: ['instagram'], scheduled_at: at(2) },
        { type: 'reel', caption: 'Pieza buena 2', networks: ['instagram', 'tiktok'], scheduled_at: at(6) },
        { type: 'post', caption: 'Fecha pasada', networks: ['instagram'], scheduled_at: '2020-01-01T10:00:00Z' },
        { type: 'post', caption: 'Red sin conectar', networks: ['bluesky'] },
      ],
    },
  });
  assert.ok(!r.isError, textOf(r));
  const t = textOf(r);
  assert.match(t, /2 piezas creadas, 4 con incidencias/);
  assert.match(t, /TikTok: falta el vídeo/);
  assert.match(t, /Se omite/);
  assert.match(t, /ya ha pasado/);
  assert.match(t, /Bluesky conectada/);
  assert.match(t, /apruébalas|aprobarlas/);
  assert.equal(received.posts.length, n + 2);
});

test('create_campaign no pasa de 5 piezas de feed por cuenta y día dentro de la misma campaña', async () => {
  const n = received.posts.length;
  const posts = Array.from({ length: 7 }, (_, i) => ({ type: 'post', caption: `P${i}`, networks: ['tiktok'], scheduled_at: at(9, `0${i + 1}:00`) }));
  const r = await client.callTool({ name: 'create_campaign', arguments: { name: 'Mucho', posts } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /5 piezas creadas, 2 con incidencias/);
  assert.equal(received.posts.length, n + 5);
});

test('upload_media acepta rutas con tildes, espacios y comillas, y carpetas enteras', async () => {
  const dir = path.join(tmp, 'Campaña Navidad ñandú');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'foto 1 ñ.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'foto 2.png'), 'x');
  fs.writeFileSync(path.join(dir, 'vídeo.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'notas.txt'), 'no es un medio');

  let r = await client.callTool({ name: 'upload_media', arguments: { path: `"${path.join(dir, 'foto 1 ñ.jpg')}"` } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /media_id 50\d/);
  assert.equal(received.uploads.at(-1), path.join(dir, 'foto 1 ñ.jpg'), 'quita las comillas y respeta tildes y espacios');

  const before = received.uploads.length;
  r = await client.callTool({ name: 'upload_media', arguments: { path: dir } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /3 archivos subidos/);
  assert.equal(received.uploads.length, before + 3, 'ignora notas.txt');

  r = await client.callTool({ name: 'upload_media', arguments: { path: path.join(dir, 'no existe.jpg') } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /No encuentro/);
  assert.match(textOf(r), /tildes, espacios/);

  r = await client.callTool({ name: 'upload_media', arguments: { path: 'fotos/relativa.jpg' } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /no es absoluta/);

  const empty = path.join(tmp, 'vacia');
  fs.mkdirSync(empty);
  r = await client.callTool({ name: 'upload_media', arguments: { path: empty } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /no tiene imágenes/);
});

test('get_network_specs devuelve datos por red', async () => {
  const r = await client.callTool({ name: 'get_network_specs', arguments: { network: 'bluesky' } });
  assert.ok(!r.isError);
  assert.match(textOf(r), /300 caracteres/);
  const all = await client.callTool({ name: 'get_network_specs', arguments: {} });
  assert.match(textOf(all), /Instagram/);
  assert.match(textOf(all), /Google Business Profile/);
});

test('con un token incorrecto da un mensaje claro', async () => {
  const c = await connect({ WILLYPOST_URL: baseUrl, WILLYPOST_TOKEN: 'otro' });
  try {
    const r = await c.callTool({ name: 'list_accounts', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /token/);
    assert.match(textOf(r), /WillyPost > Claude/);
  } finally {
    await c.close();
  }
});

test('sin token configurado lo explica', async () => {
  const c = await connect({ WILLYPOST_URL: baseUrl, WILLYPOST_TOKEN: '' });
  try {
    const r = await c.callTool({ name: 'list_accounts', arguments: {} });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /Falta el token/);
  } finally {
    await c.close();
  }
});

test('si WillyPost no está abierto lo dice', async () => {
  const c = await connect({ WILLYPOST_URL: 'http://127.0.0.1:1', WILLYPOST_TOKEN: TOKEN });
  try {
    const r = await c.callTool({ name: 'willypost_status', arguments: {} });
    assert.equal(r.isError, true);
    assert.equal(textOf(r), 'WillyPost no está abierto. Ábrelo (doble clic en el icono de WillyPost) y vuelve a intentarlo.');
  } finally {
    await c.close();
  }
});
