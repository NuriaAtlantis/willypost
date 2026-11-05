// WillyPost — servidor local. Arranque: node --disable-warning=ExperimentalWarning server/index.js
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PORT, ROOT, APP_URL, LOG_DIR, DATA_DIR, VERSION } from './config.js';
import './db.js';
import { HttpError } from './auth.js';
import { authRouter } from './routes/auth.js';
import { accountsRouter } from './routes/accounts.js';
import { postsRouter } from './routes/posts.js';
import { miscRouter } from './routes/misc.js';
import { mediaRouter } from './media.js';
import { startScheduler } from './scheduler.js';
import { startShareServer, stopTunnel } from './share.js';
import { loadErrors } from './providers/index.js';

// ---------- Log a archivo (útil para soporte) ----------
const logFile = fs.createWriteStream(path.join(LOG_DIR, 'willypost.log'), { flags: 'a' });
for (const level of ['log', 'error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    try {
      logFile.write(`${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
    } catch { /* */ }
  };
}

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

// ---------- Protección: solo peticiones locales y del propio WillyPost ----------
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
if (process.env.WILLYPOST_DEV === '1') ALLOWED_HOSTS.add('localhost:5173').add('127.0.0.1:5173');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Evita ataques de "DNS rebinding": el Host debe ser local.
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) return res.status(403).send('Forbidden');
  // Evita que otras webs abiertas en tu navegador modifiquen tus datos.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    // "null" (iframes aislados, archivos locales) también se bloquea.
    if (origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, '').toLowerCase())) {
      return res.status(403).json({ error: 'Petición bloqueada por seguridad.' });
    }
  }
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(authRouter, accountsRouter, postsRouter, miscRouter, mediaRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// ---------- Interfaz ----------
const DIST = path.join(ROOT, 'web', 'dist');
app.use(express.static(DIST, { index: false, maxAge: '1h' }));
app.get(/^\/(?!api\/|media\/|oauth\/).*/, (_req, res) => {
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index, { headers: { 'Cache-Control': 'no-cache' } });
  res.status(503).send('<h1>WillyPost</h1><p>Falta la interfaz (web/dist). Vuelve a descargar WillyPost.</p>');
});

// ---------- Errores ----------
const NET_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
const MULTER_MSG = {
  LIMIT_FILE_SIZE: 'El archivo pesa más de 1 GB.',
  LIMIT_FILE_COUNT: 'Sube como mucho 20 archivos a la vez.',
  LIMIT_UNEXPECTED_FILE: 'Sube como mucho 20 archivos a la vez.',
  LIMIT_PART_COUNT: 'Demasiados archivos en una sola subida.',
  LIMIT_FIELD_VALUE: 'Datos demasiado grandes.',
};

/** Traduce cualquier error a { status, error } con un mensaje claro en español. */
export function friendlyError(err) {
  if (err instanceof HttpError) return { status: err.status, error: err.message, details: err.details };
  if (err?.name === 'ProviderError') return { status: 400, error: err.message };
  if (err?.name === 'MulterError' || MULTER_MSG[err?.code]) {
    return { status: err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error: MULTER_MSG[err.code] || 'No se ha podido subir el archivo. Inténtalo de nuevo.' };
  }
  if (err?.type === 'entity.parse.failed') return { status: 400, error: 'Datos mal formados.' };
  if (err?.type === 'entity.too.large') return { status: 413, error: 'Los datos enviados son demasiado grandes.' };
  if (err?.type === 'request.aborted') return { status: 400, error: 'Se ha cortado la subida. Inténtalo de nuevo.' };
  if (err?.code === 'ENOSPC') return { status: 507, error: 'No queda espacio en el disco del ordenador. Libera espacio y vuelve a intentarlo.' };
  if (err?.code === 'EACCES' || err?.code === 'EPERM') return { status: 500, error: 'WillyPost no tiene permiso para escribir en su carpeta de datos. Reinicia el ordenador y vuelve a probar.' };
  if (/SQLITE_BUSY|database is locked/i.test(String(err?.message || '')) || err?.errcode === 5) {
    return { status: 503, error: 'WillyPost está ocupado guardando datos. Espera unos segundos y vuelve a intentarlo.' };
  }
  const cause = err?.cause;
  if ((err?.name === 'TypeError' && /fetch failed/i.test(err.message)) || NET_CODES.has(err?.code) || NET_CODES.has(cause?.code)) {
    return { status: 502, error: 'No hemos podido conectar con la red social. Revisa tu conexión a internet y vuelve a intentarlo.' };
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return { status: 504, error: 'La red social ha tardado demasiado en responder. Vuelve a intentarlo en un momento.' };
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const f = friendlyError(err);
  if (!f || f.status >= 500) console.error('[http]', req.method, req.url, err);
  if (res.headersSent) return res.end();
  if (f) return res.status(f.status).json(f.details !== undefined ? { error: f.error, details: f.details } : { error: f.error });
  res.status(500).json({ error: 'Algo ha fallado en WillyPost. Si se repite, reinícialo.' });
});

// ---------- Arranque ----------
async function alreadyRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j?.app === 'willypost';
  } catch {
    return false;
  }
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`WillyPost ${VERSION} listo en ${APP_URL} (datos en ${DATA_DIR})`);
  if (Object.keys(loadErrors).length) console.warn('Redes sin módulo (modo manual):', Object.keys(loadErrors).join(', '));
  startShareServer();
  if (process.env.WILLYPOST_NO_SCHEDULER !== '1') startScheduler();
});

server.on('error', async (e) => {
  if (e.code === 'EACCES') {
    console.error(`El sistema no deja usar el puerto ${PORT}. Reinicia el ordenador; si sigue pasando, avisa a soporte de la Willy SEO Academy.`);
    process.exit(1);
  }
  if (e.code === 'EADDRINUSE') {
    if (await alreadyRunning()) {
      console.log(`WillyPost ya estaba abierto en ${APP_URL}.`);
      process.exit(0);
    }
    console.error(`El puerto ${PORT} está ocupado por otro programa. Cierra ese programa o reinicia el ordenador.`);
    process.exit(1);
  }
  console.error('[server]', e);
  process.exit(1);
});

const shutdown = () => {
  stopTunnel();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Un error inesperado no debe apagar WillyPost (en Windows nadie lo volvería a arrancar y no se publicaría nada).
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

// Para pruebas en el mismo proceso (cerrar el servidor al terminar).
export { app, server };
