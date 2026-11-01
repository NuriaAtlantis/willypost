// Pruebas de robustez del núcleo con un servidor real (puerto 4811/4812) y datos temporales.
// APPDATA/LOCALAPPDATA/HOME apuntan a una carpeta temporal: nunca tocamos la configuración real de Claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4811;
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-core-r-'));
// Carpeta de datos con espacios y tildes (como "C:\Users\José María\...").
const dataDir = path.join(tmp, 'datos José ñ');
const fakeHome = path.join(tmp, 'home');
const appData = path.join(fakeHome, 'AppData', 'Roaming');
const localAppData = path.join(fakeHome, 'AppData', 'Local');
fs.mkdirSync(appData, { recursive: true });
fs.mkdirSync(localAppData, { recursive: true });
let proc;
let cookie = '';
let token = '';

async function start() {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env, WILLYPOST_DATA: dataDir, WILLYPOST_PORT: String(PORT), WILLYPOST_SHARE_PORT: '4812',
      WILLYPOST_NO_DESKTOP_NOTIFY: '1', APPDATA: appData, LOCALAPPDATA: localAppData, HOME: fakeHome, USERPROFILE: fakeHome,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 75; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`El servidor no arrancó:\n${out}`);
}

async function stop() {
  if (!proc) return;
  const p = proc;
  proc = null;
  await new Promise((resolve) => {
    p.once('exit', resolve);
    p.kill();
  });
}

async function api(method, url, body, headers = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const asClaude = (method, url, body) => {
  const saved = cookie;
  cookie = '';
  return api(method, url, body, { Authorization: `Bearer ${token}` }).finally(() => { cookie = saved; });
};

const dayAt = (offsetDays, h, m = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays, h, m).toISOString();
};

before(start);
after(async () => {
  await stop();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
});

// ---------- Autenticación ----------
let recovery;
test('registro: email sin distinguir mayúsculas y contraseñas raras', async () => {
  let r = await api('POST', '/api/auth/register', { name: 'José', email: 'Jose.Maria@Test.COM', password: '        ' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /8 caracteres|espacios/);
  r = await api('POST', '/api/auth/register', { name: 'José', email: 'Jose.Maria@Test.COM', password: 'ñandú-contraseña 🐢' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  recovery = r.body.recoveryCode;
  assert.equal(r.body.user.email, 'jose.maria@test.com');
  r = await api('POST', '/api/auth/register', { name: 'Otro', email: 'JOSE.MARIA@test.com', password: '12345678' });
  assert.equal(r.status, 409);
  cookie = '';
  r = await api('POST', '/api/auth/login', { email: '  JOSE.maria@TEST.com ', password: 'ñandú-contraseña 🐢' });
  assert.equal(r.status, 200);
  r = await api('POST', '/api/auth/login', { email: 'jose.maria@test.com', password: 'mala' });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /incorrectos/);
  r = await api('POST', '/api/auth/login', {});
  assert.equal(r.status, 400);
});

test('recuperación: el código vale escrito en minúsculas, con espacios o sin guiones', async () => {
  const sloppy = ` ${recovery.toLowerCase().replace(/-/g, ' ')} `;
  let r = await api('POST', '/api/auth/reset', { email: 'jose.maria@test.com', recoveryCode: sloppy, newPassword: 'nueva-contraseña' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.body.recoveryCode, recovery);
  // El código viejo ya no sirve.
  r = await api('POST', '/api/auth/reset', { email: 'jose.maria@test.com', recoveryCode: recovery, newPassword: 'otra-mas-123' });
  assert.equal(r.status, 401);
  r = await api('POST', '/api/auth/login', { email: 'jose.maria@test.com', password: 'nueva-contraseña' });
  assert.equal(r.status, 200);
});

test('sesión caducada o falsa → mensaje claro', async () => {
  const saved = cookie;
  cookie = 'wp_session=inventada';
  const r = await api('GET', '/api/me');
  assert.equal(r.status, 401);
  assert.match(r.body.error, /sesión/);
  cookie = saved;
});

// ---------- Seguridad ----------
test('seguridad: Origin "null" y otras webs bloqueadas; cabeceras; rutas de medios', async () => {
  let r = await api('POST', '/api/campaigns', { name: 'x' }, { Origin: 'null' });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/campaigns', { name: 'x' }, { Origin: 'http://localhost:9999' });
  assert.equal(r.status, 403);
  r = await api('POST', '/api/campaigns', { name: 'x' }, { Origin: `http://localhost:${PORT}` });
  assert.equal(r.status, 201);
  r = await api('GET', '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  for (const u of ['/media/..%2f..%2fwillypost.db/file', '/media/abc/file', '/media/999999/thumb']) {
    r = await api('GET', u);
    assert.equal(r.status, 404, u);
  }
  // Rebinding DNS: Host raro.
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/me', headers: { Host: `evil.com:${PORT}` } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('errores en español: JSON roto, datos enormes, fechas de filtro inválidas', async () => {
  let res = await fetch(`${BASE}/api/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"name": ' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /mal formados/);
  res = await fetch(`${BASE}/api/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'x'.repeat(6 * 1024 * 1024) }) });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /demasiado grandes/);
  let r = await api('GET', '/api/posts?from=mañana');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no es válida/);
  r = await api('GET', '/api/slots?to=xx');
  assert.equal(r.status, 400);
});

// ---------- Claude (token Bearer) ----------
let ig;
let fb;
test('Claude: no puede saltarse el modo borrador ni darse permisos', async () => {
  let r = await api('POST', '/api/claude/token', {});
  token = r.body.token;
  r = await api('POST', '/api/accounts/manual', { network: 'instagram', name: 'Mi IG' });
  ig = r.body.id;
  r = await api('POST', '/api/accounts/manual', { network: 'facebook', name: 'Mi página' });
  fb = r.body.id;
  // Aunque diga created_by "user", con el token es Claude → borrador.
  r = await asClaude('POST', '/api/posts', { type: 'post', caption: 'Truco', targets: [{ account_id: ig }], scheduled_at: dayAt(3, 10), action: 'schedule', created_by: 'user' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.created_by, 'claude');
  const draftId = r.body.id;
  r = await asClaude('POST', `/api/posts/${draftId}/approve`, {});
  assert.equal(r.status, 403);
  r = await asClaude('POST', `/api/posts/${draftId}/publish-now`, {});
  assert.equal(r.status, 403);
  r = await asClaude('PUT', '/api/settings', { claude_mode: 'schedule' });
  assert.equal(r.status, 403);
  r = await asClaude('POST', '/api/claude/token', {});
  assert.equal(r.status, 403);
  r = await asClaude('PUT', '/api/me', { name: 'Hacker' });
  assert.equal(r.status, 403);
  // Lo de leer sí puede.
  r = await asClaude('GET', '/api/me');
  assert.equal(r.status, 200);
  // El alumno aprueba.
  r = await api('POST', `/api/posts/${draftId}/approve`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'scheduled');
});

test('aprobar una propuesta cuya fecha ya pasó no la publica por sorpresa', async () => {
  let r = await asClaude('POST', '/api/posts', { type: 'post', caption: 'Vieja', targets: [{ account_id: ig }], scheduled_at: dayAt(2, 10), action: 'schedule' });
  const id = r.body.id;
  // Simulamos que han pasado días: fecha propuesta en el pasado (borradores sí lo permiten).
  r = await api('PUT', `/api/posts/${id}`, { type: 'post', caption: 'Vieja', targets: [{ account_id: ig }], scheduled_at: dayAt(-2, 10), action: 'draft' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api('POST', `/api/posts/${id}/approve`, {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /ya ha pasado/);
  r = await api('GET', `/api/posts/${id}`);
  assert.equal(r.body.status, 'draft');
});

test('revocar los tokens de Claude', async () => {
  const r0 = await api('POST', '/api/claude/token', {});
  const extra = r0.body.token;
  let r = await api('DELETE', '/api/claude/token');
  assert.equal(r.status, 200);
  assert.ok(r.body.revoked >= 2);
  r = await asClaude('GET', '/api/me');
  assert.equal(r.status, 401);
  assert.match(r.body.error, /token de Claude/);
  const saved = token;
  token = extra;
  r = await asClaude('GET', '/api/me');
  assert.equal(r.status, 401);
  token = saved;
});

// ---------- Publicaciones y límites ----------
test('límites: 5 sí, 6º no (mensaje claro); mover entre días respeta el límite', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/api/posts', { type: 'post', caption: `P${i}`, targets: [{ account_id: fb }, { account_id: ig }], scheduled_at: dayAt(5, 9 + i), action: 'schedule' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids.push(r.body.id);
  }
  let r = await api('POST', '/api/posts', { type: 'post', caption: 'Sexto', targets: [{ account_id: fb }], scheduled_at: dayAt(5, 20), action: 'schedule' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /ya tienes 5 publicaciones en Facebook \(Mi página\)\. El máximo es 5/);
  // Mover uno dentro del mismo día (cambiar la hora) sí.
  r = await api('GET', `/api/posts/${ids[0]}`);
  const p0 = r.body;
  r = await api('PUT', `/api/posts/${p0.id}`, { type: 'post', caption: 'P0', targets: p0.targets.map((t) => ({ account_id: t.account_id })), scheduled_at: dayAt(5, 21), action: 'schedule' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Uno de otro día no puede entrar en el día lleno.
  r = await api('POST', '/api/posts', { type: 'post', caption: 'Otro día', targets: [{ account_id: fb }], scheduled_at: dayAt(6, 10), action: 'schedule' });
  const other = r.body.id;
  r = await api('PUT', `/api/posts/${other}`, { type: 'post', caption: 'Otro día', targets: [{ account_id: fb }], scheduled_at: dayAt(5, 22), action: 'schedule' });
  assert.equal(r.status, 409);
  // Fecha solo con día (sin hora) → mensaje claro.
  r = await api('POST', '/api/posts', { type: 'post', caption: 'x', targets: [{ account_id: fb }], scheduled_at: '2030-01-01', action: 'schedule' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /hora/);
});

test('campaña: se puede quitar con campaign_id null', async () => {
  let r = await api('POST', '/api/campaigns', { name: 'Black Friday', color: 'red; background:url(x)' });
  assert.match(r.body.color, /^#/);
  const camp = r.body.id;
  r = await api('POST', '/api/posts', { type: 'post', caption: 'c', targets: [{ account_id: ig }], action: 'draft', campaign_id: camp });
  const id = r.body.id;
  assert.equal(r.body.campaign.id, camp);
  r = await api('PUT', `/api/posts/${id}`, { type: 'post', caption: 'c', targets: [{ account_id: ig }], action: 'draft', campaign_id: null });
  assert.equal(r.body.campaign, null);
});

test('"Ya lo he publicado": solo enlaces http(s)', async () => {
  let r = await api('POST', '/api/posts', { type: 'post', caption: 'manual', targets: [{ account_id: ig }], action: 'publish_now' });
  const id = r.body.id;
  let post;
  for (let i = 0; i < 40; i++) {
    post = (await api('GET', `/api/posts/${id}`)).body;
    if (post.status === 'manual') break;
    await new Promise((res) => setTimeout(res, 150));
  }
  const tid = post.targets[0].id;
  r = await api('POST', `/api/targets/${tid}/manual-done`, { url: 'javascript:alert(1)' });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/targets/${tid}/manual-done`, { url: 'instagram.com/p/abc' });
  assert.equal(r.status, 200);
  assert.equal(r.body.targets[0].external_url, 'https://instagram.com/p/abc');
  assert.equal(r.body.status, 'published');
});

test('borrar una cuenta con publicaciones: no quedan publicaciones "fantasma" programadas', async () => {
  let r = await api('POST', '/api/accounts/manual', { network: 'threads', name: 'Hilo' });
  const th = r.body.id;
  r = await api('POST', '/api/posts', { type: 'post', caption: 'solo threads', targets: [{ account_id: th }], scheduled_at: dayAt(7, 10), action: 'schedule' });
  const only = r.body.id;
  r = await api('POST', '/api/posts', { type: 'post', caption: 'threads e ig', targets: [{ account_id: th }, { account_id: ig }], scheduled_at: dayAt(7, 11), action: 'schedule' });
  const both = r.body.id;
  r = await api('DELETE', `/api/accounts/${th}`);
  assert.equal(r.status, 409);
  r = await api('DELETE', `/api/accounts/${th}?force=1`);
  assert.equal(r.status, 200);
  r = await api('GET', `/api/posts/${only}`);
  assert.equal(r.body.status, 'draft', 'sin redes pasa a borrador (no se pierde el texto)');
  assert.equal(r.body.caption, 'solo threads');
  r = await api('GET', `/api/posts/${both}`);
  assert.equal(r.body.status, 'scheduled');
  assert.equal(r.body.targets.length, 1);
});

// ---------- Medios ----------
const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#3366aa' } }).png().toBuffer();
function form(files) {
  const fd = new FormData();
  for (const [name, buf, type] of files) fd.append('files', new Blob([buf], { type: type || 'application/octet-stream' }), name);
  return fd;
}
function box(type, ...parts) {
  const payload = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(payload.length + 8, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, payload]);
}
/** MP4 mínimo: vídeo vertical de móvil (1920x1080 con giro de 90º) de 12,5 s. */
function tinyMp4() {
  const ftyp = box('ftyp', Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41'));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(12500, 16);
  const tkhd = Buffer.alloc(84);
  const m = 40; // matriz
  tkhd.writeInt32BE(0, m); tkhd.writeInt32BE(0x10000, m + 4); tkhd.writeInt32BE(-0x10000, m + 12); tkhd.writeInt32BE(0, m + 16);
  tkhd.writeUInt32BE(0x40000000, m + 32);
  tkhd.writeUInt32BE(1920 * 65536, 76);
  tkhd.writeUInt32BE(1080 * 65536, 80);
  const moov = box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd)));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(64))]);
}

let imageId;
test('medios: nombres con tildes y espacios, vídeo con metadatos, formatos convertidos', async () => {
  const name = 'Foto de la playa — ñandú áéíóú (copia 2).png';
  let r = await api('POST', '/api/media', form([[name, await png(), 'image/png']]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body[0].original_name, name);
  assert.equal(r.body[0].width, 64);
  imageId = r.body[0].id;
  let res = await fetch(`${BASE}${r.body[0].thumb}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  res = await fetch(`${BASE}${r.body[0].url}?download=1`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /attachment/);
  // .jfif (JPEG de Windows) y PNG con extensión equivocada.
  const jpg = await sharp(await png()).jpeg().toBuffer();
  r = await api('POST', '/api/media', form([['descarga.jfif', jpg, 'image/jpeg'], ['en-realidad-jpg.png', jpg, 'image/png']]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.map((m) => m.mime), ['image/jpeg', 'image/jpeg']);
  // TIFF → se convierte a JPG.
  const tiff = await sharp(await png()).tiff().toBuffer();
  r = await api('POST', '/api/media', form([['escaneo.tiff', tiff, 'image/tiff']]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body[0].mime, 'image/jpeg');
  assert.equal(r.body[0].original_name, 'escaneo.jpg');
  // Vídeo vertical: duración y tamaño girado.
  r = await api('POST', '/api/media', form([['Mi vídeo vertical.MOV', tinyMp4(), 'video/quicktime']]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body[0].kind, 'video');
  assert.equal(r.body[0].duration, 12.5);
  assert.equal(r.body[0].width, 1080);
  assert.equal(r.body[0].height, 1920);
});

test('medios: archivos malos → error claro en español y nada a medias en la biblioteca', async () => {
  const before = (await api('GET', '/api/media')).body.length;
  const cases = [
    ['notas.txt', Buffer.from('hola'), 'text/plain', /no es una foto ni un vídeo/],
    ['IMG_0001.HEIC', Buffer.from('ftypheic-no-es-real'), 'image/heic', /HEIC del iPhone/],
    ['rota.jpg', Buffer.from('esto no es un jpg'), 'image/jpeg', /dañada|no es una foto/],
    ['cortada.jpg', (await sharp({ create: { width: 800, height: 800, channels: 3, background: '#ff0000' } }).jpeg().toBuffer()).subarray(0, 600), 'image/jpeg', /dañada|incompleta/],
    ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', /no es una foto ni un vídeo/],
    ['peli.avi', Buffer.from('RIFF....AVI '), 'video/x-msvideo', /MP4/],
    ['falso.mp4', Buffer.from('esto no es un vídeo de verdad'), 'video/mp4', /dañado/],
    ['vacio.png', Buffer.alloc(0), 'image/png', /vacío/],
  ];
  for (const [name, buf, type, re] of cases) {
    const r = await api('POST', '/api/media', form([[name, buf, type]]));
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, re, name);
  }
  // Uno bueno + uno malo: no se queda el bueno a medias.
  let r = await api('POST', '/api/media', form([['buena.png', await png(), 'image/png'], ['mala.jpg', Buffer.from('xx'), 'image/jpeg']]));
  assert.equal(r.status, 400);
  // Más de 20 archivos.
  const many = [];
  for (let i = 0; i < 21; i++) many.push([`f${i}.png`, await png(), 'image/png']);
  r = await api('POST', '/api/media', form(many));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /20 archivos/);
  r = await api('POST', '/api/media', new FormData());
  assert.equal(r.status, 400);
  assert.equal((await api('GET', '/api/media')).body.length, before);
  // Sin archivos huérfanos en la carpeta de medios.
  const files = fs.readdirSync(path.join(dataDir, 'media')).filter((f) => !['thumbs', 'converted'].includes(f));
  const rows = (await api('GET', '/api/media')).body.length;
  assert.equal(files.length, rows);
});

test('medios desde ruta (Claude): comillas, file:// y carpetas con tildes', async () => {
  const dir = path.join(tmp, 'Mis imágenes ñ');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'foto final.png');
  fs.writeFileSync(f, await png());
  let r = await api('POST', '/api/media/from-path', { path: `"${f}"` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api('POST', '/api/media/from-path', { path: pathToFileURL(f).href });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await api('POST', '/api/media/from-path', { path: path.join(dir, 'no-existe.png') });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /No encuentro el archivo/);
  r = await api('POST', '/api/media/from-path', { path: path.join(dataDir, 'willypost.db') });
  assert.equal(r.status, 400);
});

test('no se puede borrar un archivo que usa una publicación programada', async () => {
  let r = await api('POST', '/api/posts', { type: 'post', caption: 'con foto', media_ids: [imageId], targets: [{ account_id: ig }], scheduled_at: dayAt(9, 10), action: 'schedule' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  r = await api('DELETE', `/api/media/${imageId}`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /publicación pendiente/);
});

// ---------- Claude Desktop ----------
const desktopCfg = path.join(appData, 'Claude', 'claude_desktop_config.json');
test('Claude Desktop: crea la carpeta si no existe', async () => {
  const r = await api('POST', '/api/claude/install-desktop');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(path.resolve(r.body.path), path.resolve(desktopCfg));
  const cfg = JSON.parse(fs.readFileSync(desktopCfg, 'utf8'));
  assert.ok(cfg.mcpServers.willypost.env.WILLYPOST_TOKEN.startsWith('wp_'));
  const st = await api('GET', '/api/claude');
  assert.equal(st.body.desktopInstalled, true);
});

test('Claude Desktop: respeta lo que había (con BOM del Bloc de notas), hace copia y revoca el token anterior', async () => {
  const oldToken = JSON.parse(fs.readFileSync(desktopCfg, 'utf8')).mcpServers.willypost.env.WILLYPOST_TOKEN;
  const existing = { globalShortcut: 'Ctrl+Espacio', mcpServers: { otro: { command: 'npx', args: ['-y', 'otro-servidor'] } }, preferencias: { tema: 'oscuro' } };
  fs.writeFileSync(desktopCfg, `\uFEFF${JSON.stringify(existing, null, 2)}`, 'utf8');
  const r = await api('POST', '/api/claude/install-desktop');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cfg = JSON.parse(fs.readFileSync(desktopCfg, 'utf8'));
  assert.deepEqual(cfg.mcpServers.otro, existing.mcpServers.otro);
  assert.equal(cfg.globalShortcut, 'Ctrl+Espacio');
  assert.deepEqual(cfg.preferencias, existing.preferencias);
  assert.ok(cfg.mcpServers.willypost);
  assert.ok(fs.existsSync(`${desktopCfg}.bak-willypost`));
  assert.ok(!fs.existsSync(`${desktopCfg}.willypost-tmp`));
  // El token de la instalación anterior ya no sirve; el nuevo sí.
  const saved = token;
  token = oldToken;
  assert.equal((await asClaude('GET', '/api/me')).status, 401);
  token = cfg.mcpServers.willypost.env.WILLYPOST_TOKEN;
  assert.equal((await asClaude('GET', '/api/me')).status, 200);
  token = saved;
});

test('Claude Desktop: si el JSON está roto NO lo toca y explica qué hacer', async () => {
  const broken = '{ "mcpServers": { "otro": { "command": "npx", } }';
  fs.writeFileSync(desktopCfg, broken, 'utf8');
  let r = await api('POST', '/api/claude/install-desktop');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Bloc de notas/);
  assert.equal(fs.readFileSync(desktopCfg, 'utf8'), broken);
  // Archivo vacío o con "mcpServers" raro: se arregla sin perder nada más.
  fs.writeFileSync(desktopCfg, '', 'utf8');
  r = await api('POST', '/api/claude/install-desktop');
  assert.equal(r.status, 200);
  fs.writeFileSync(desktopCfg, JSON.stringify({ mcpServers: null, x: 1 }), 'utf8');
  r = await api('POST', '/api/claude/install-desktop');
  assert.equal(r.status, 200);
  const cfg = JSON.parse(fs.readFileSync(desktopCfg, 'utf8'));
  assert.equal(cfg.x, 1);
  assert.ok(cfg.mcpServers.willypost);
  fs.writeFileSync(desktopCfg, '[1,2]', 'utf8');
  r = await api('POST', '/api/claude/install-desktop');
  assert.equal(r.status, 409);
});

// ---------- Reinicio: cierre a mitad de publicación y ordenador apagado ----------
test('al reiniciar: envíos interrumpidos y publicaciones atrasadas', async () => {
  let r = await api('POST', '/api/posts', { type: 'post', caption: 'atrasada', targets: [{ account_id: ig }], scheduled_at: dayAt(10, 10), action: 'schedule' });
  const missedId = r.body.id;
  r = await api('POST', '/api/posts', { type: 'post', caption: 'interrumpida', targets: [{ account_id: fb }, { account_id: ig }], scheduled_at: dayAt(11, 10), action: 'schedule' });
  const stuckId = r.body.id;
  await stop();
  const db = new DatabaseSync(path.join(dataDir, 'willypost.db'));
  const past = new Date(Date.now() - 3 * 3600e3).toISOString();
  db.prepare('UPDATE posts SET scheduled_at = ? WHERE id IN (?, ?)').run(past, missedId, stuckId);
  db.prepare(`UPDATE posts SET status = 'publishing' WHERE id = ?`).run(stuckId);
  const [t1, t2] = db.prepare('SELECT id FROM post_targets WHERE post_id = ? ORDER BY id').all(stuckId);
  db.prepare(`UPDATE post_targets SET status = 'publishing', attempts = 1 WHERE id = ?`).run(t1.id);
  db.prepare(`UPDATE post_targets SET status = 'published', published_at = ? WHERE id = ?`).run(past, t2.id);
  db.close();
  await start();
  r = await api('GET', `/api/posts/${missedId}`);
  assert.equal(r.body.status, 'missed');
  r = await api('GET', `/api/posts/${stuckId}`);
  assert.equal(r.body.status, 'partial');
  assert.equal(r.body.targets[0].status, 'failed');
  assert.match(r.body.targets[0].error, /se cerró mientras publicaba/);
  // Ya no está bloqueada: se puede borrar o reintentar.
  r = await api('PUT', `/api/posts/${stuckId}`, { type: 'post', caption: 'x', targets: [{ account_id: fb }], scheduled_at: dayAt(12, 10), action: 'schedule' });
  assert.equal(r.status, 409, 'no se puede rehacer: una red ya la publicó');

  // Decisiones sobre la atrasada.
  r = await api('POST', `/api/posts/${missedId}/missed`, { action: 'reschedule', scheduled_at: dayAt(-1, 10) });
  assert.equal(r.status, 400);
  r = await api('GET', `/api/posts/${missedId}`);
  assert.equal(r.body.status, 'missed', 'si reprogramar falla, sigue pendiente de decisión');
  r = await api('POST', `/api/posts/${missedId}/missed`, { action: 'skip' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'draft');
  assert.equal(r.body.scheduled_at, null);
  assert.equal(r.body.caption, 'atrasada');
});

function runSecond(port, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env, WILLYPOST_DATA: path.join(tmp, `second-${port}`), WILLYPOST_PORT: String(port), WILLYPOST_SHARE_PORT: '4814',
        WILLYPOST_NO_DESKTOP_NOTIFY: '1', WILLYPOST_NO_SCHEDULER: '1', APPDATA: appData, LOCALAPPDATA: localAppData, ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill(), 15000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

test('arranque con el puerto ocupado: otro WillyPost → sale bien; otro programa → mensaje claro', async () => {
  let r = await runSecond(PORT);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ya estaba abierto/);
  const blocker = http.createServer((_req, res) => res.end('otro programa'));
  await new Promise((res) => blocker.listen(4813, '127.0.0.1', res));
  try {
    r = await runSecond(4813);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ocupado por otro programa/);
  } finally {
    blocker.close();
  }
});

test('el servidor sigue vivo tras todo lo anterior', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});
