// Medios públicos temporales.
// Instagram, Threads y Google Business descargan las fotos/vídeos desde una URL de internet.
// Levantamos un mini servidor (puerto 4748) que SOLO sirve /m/<token>/<archivo> y lo exponemos
// con un túnel gratuito de Cloudflare mientras hace falta. El resto de WillyPost nunca sale del ordenador.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream';
import { SHARE_PORT, BIN_DIR } from './config.js';
import { ProviderError } from './providers/_http.js';

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const TUNNEL_IDLE_MS = 15 * 60 * 1000;
const shares = new Map(); // token -> { path, mime, expires }

let server = null;
let tunnel = null; // { proc, url }
let tunnelStarting = null;
let idleTimer = null;

/** Interpreta una cabecera Range simple (un solo tramo). Devuelve {start,end}, 'invalid' (416) o null (ignorar). */
export function parseRange(header, size) {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  if (!m[1] && !m[2]) return 'invalid';
  let start;
  let end;
  if (!m[1]) {
    // "últimos N bytes": si N supera el tamaño, se sirve el fichero entero
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

/**
 * Atiende una petición del servidor público. Es lo ÚNICO que ve internet a través del túnel, así que
 * nunca debe lanzar: cualquier fallo (URL rara, fichero borrado a mitad) responde 4xx/5xx sin tumbar el proceso.
 */
export function handleShareRequest(req, res) {
  try {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      return res.writeHead(400).end(); // p. ej. "GET //" o "GET http://[": antes tumbaba el servidor entero
    }
    if (pathname === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    const m = pathname.match(/^\/m\/([a-f0-9]{64})\/[^/]+$/);
    const entry = m && shares.get(m[1]);
    if (!entry || entry.expires < Date.now()) return res.writeHead(404).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    let size;
    try {
      size = fs.statSync(entry.path).size;
    } catch {
      return res.writeHead(404).end();
    }
    touchTunnel(); // mientras alguien descargue, el túnel no se cierra por inactividad
    const headers = {
      'Content-Type': entry.mime || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    let opts;
    if (range) {
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': range.end - range.start + 1 });
      opts = { start: range.start, end: range.end };
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': size });
    }
    if (req.method === 'HEAD') return res.end();
    pipeline(fs.createReadStream(entry.path, opts), res, () => { /* cliente cortado o fichero borrado: nada que hacer */ });
  } catch (e) {
    console.error('[share] error atendiendo una petición:', e?.message || e);
    try { if (!res.headersSent) res.writeHead(500); res.end(); } catch { /* */ }
  }
}

export function startShareServer() {
  if (server) return server;
  server = http.createServer(handleShareRequest);
  server.on('clientError', (_e, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* */ } });
  server.on('error', (e) => console.error('[share] error del servidor de medios:', e.message));
  server.listen(SHARE_PORT, '127.0.0.1');
  return server;
}

function cloudflaredAsset() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  // Cloudflare no publica binario de Windows para ARM (nov-2026): Windows en ARM ejecuta el de x64 por emulación.
  if (process.platform === 'win32') return { file: 'cloudflared-windows-amd64.exe', bin: 'cloudflared.exe' };
  if (process.platform === 'darwin') return { file: `cloudflared-darwin-${arch}.tgz`, bin: 'cloudflared', tgz: true };
  return { file: `cloudflared-linux-${arch}`, bin: 'cloudflared' };
}

async function ensureCloudflared() {
  const { file, bin, tgz } = cloudflaredAsset();
  const target = path.join(BIN_DIR, bin);
  if (fs.existsSync(target)) return target;
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`;
  console.log('[share] Descargando cloudflared (solo la primera vez)…', url);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch {
    throw new ProviderError('No se pudo descargar el túnel de Cloudflare. Revisa tu conexión a internet.', { retryable: true });
  }
  if (!res.ok) throw new ProviderError(`No se pudo descargar el túnel de Cloudflare (HTTP ${res.status}).`, { retryable: true });
  const buf = Buffer.from(await res.arrayBuffer());
  // Comprobación de cordura (Cloudflare no publica un checksum por la API de releases).
  if (!looksLikeBinary(buf, { tgz })) {
    throw new ProviderError('Lo descargado del túnel de Cloudflare no parece válido (¿un antivirus o un proxy lo ha cambiado?). Inténtalo de nuevo.', { retryable: true });
  }
  if (tgz) {
    const tmp = path.join(BIN_DIR, file);
    fs.writeFileSync(tmp, buf);
    execFileSync('tar', ['-xzf', tmp, '-C', BIN_DIR]);
    fs.rmSync(tmp, { force: true });
  } else {
    const part = `${target}.part`;
    fs.writeFileSync(part, buf);
    fs.renameSync(part, target); // así nunca queda un .exe a medias que parezca bueno
  }
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  return target;
}

/** ¿Tiene pinta de ejecutable (PE/ELF) o de .tgz, y un tamaño razonable? */
export function looksLikeBinary(buf, { tgz = false } = {}) {
  if (!buf || buf.length < 5 * 1024 * 1024) return false;
  if (tgz) return buf[0] === 0x1f && buf[1] === 0x8b;
  const pe = buf[0] === 0x4d && buf[1] === 0x5a; // "MZ"
  const elf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  return pe || elf;
}

function touchTunnel() {
  if (tunnel) scheduleIdleClose();
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stopTunnel, TUNNEL_IDLE_MS);
  idleTimer.unref?.();
}

export function stopTunnel() {
  if (tunnel?.proc) {
    try { tunnel.proc.kill(); } catch { /* ya cerrado */ }
  }
  tunnel = null;
}

async function waitReachable(base) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch { /* aún no resuelve el DNS */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function startTunnel() {
  const binPath = await ensureCloudflared();
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, ['tunnel', '--url', `http://127.0.0.1:${SHARE_PORT}`, '--no-autoupdate'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill(); } catch { /* */ }
      reject(new ProviderError('El túnel de Cloudflare no arrancó a tiempo. Lo reintentaremos.', { retryable: true }));
    }, 45000);
    const onData = async (chunk) => {
      const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !done) {
        done = true;
        clearTimeout(timer);
        const url = m[0];
        const ok = await waitReachable(url);
        if (!ok) {
          try { proc.kill(); } catch { /* */ }
          return reject(new ProviderError('El túnel de Cloudflare no responde. Lo reintentaremos en unos minutos.', { retryable: true }));
        }
        resolve({ proc, url });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', () => {
      if (tunnel?.proc === proc) tunnel = null;
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new ProviderError('El túnel de Cloudflare se cerró al arrancar.', { retryable: true }));
      }
    });
  });
}

async function publicBase() {
  if (process.env.WILLYPOST_PUBLIC_BASE) return process.env.WILLYPOST_PUBLIC_BASE.replace(/\/$/, '');
  if (!tunnel) {
    tunnelStarting ||= startTunnel().finally(() => { tunnelStarting = null; });
    tunnel = await tunnelStarting;
  }
  scheduleIdleClose();
  return tunnel.url;
}

/** URL https temporal para un item de medios ({path, mime, original_name}). */
export async function publicUrl(item) {
  startShareServer();
  const token = crypto.randomBytes(32).toString('hex');
  shares.set(token, { path: item.path, mime: item.mime, expires: Date.now() + TOKEN_TTL_MS });
  for (const [t, v] of shares) if (v.expires < Date.now()) shares.delete(t);
  const base = await publicBase();
  // Extensión siempre en minúsculas: el proxy de medios del modo central (TikTok) solo acepta media.jpg, .png…
  const ext = path.extname(item.path).toLowerCase() || (item.mime === 'image/jpeg' ? '.jpg' : '');
  return `${base}/m/${token}/media${ext}`;
}
