import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { all, get, run, now } from './db.js';
import { MEDIA_DIR } from './config.js';
import { requireAuth, HttpError } from './auth.js';

const THUMB_DIR = path.join(MEDIA_DIR, 'thumbs');
const CONV_DIR = path.join(MEDIA_DIR, 'converted');
fs.mkdirSync(THUMB_DIR, { recursive: true });
fs.mkdirSync(CONV_DIR, { recursive: true });

// Formatos que aceptamos tal cual.
const IMAGE_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.jpe': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
  // Se convierten a JPG al subirlos (si se pueden leer).
  '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
};
const VIDEO_EXT = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.qt': 'video/quicktime', '.webm': 'video/webm' };
const VIDEO_MIMES = new Set(Object.values(VIDEO_EXT));
const BAD_VIDEO_EXT = new Set(['.avi', '.mkv', '.wmv', '.flv', '.3gp', '.3g2', '.mpg', '.mpeg', '.mts', '.m2ts', '.ts', '.vob', '.ogv', '.divx']);
// Formatos de imagen que las redes aceptan directamente; el resto se convierte a JPG.
const PASS_FORMATS = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const CONVERT_FORMATS = new Set(['heif', 'avif', 'tiff', 'jp2', 'jxl']);
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

export const mediaPath = (m) => path.join(MEDIA_DIR, m.filename);

export function serializeMedia(m) {
  return {
    id: m.id,
    url: `/media/${m.id}/file`,
    thumb: `/media/${m.id}/thumb`,
    original_name: m.original_name,
    mime: m.mime,
    kind: m.kind,
    size: m.size,
    width: m.width,
    height: m.height,
    duration: m.duration ?? null,
    created_at: m.created_at,
  };
}

/** Item que reciben los proveedores. */
export function providerMediaItem(m) {
  return {
    id: m.id, path: mediaPath(m), mime: m.mime, kind: m.kind,
    size: m.size, width: m.width, height: m.height, duration: m.duration ?? null, original_name: m.original_name,
  };
}

const extOf = (name) => path.extname(String(name || '')).toLowerCase();
const shortName = (name) => {
  const s = String(name || 'archivo');
  return s.length > 60 ? `${s.slice(0, 40)}…${s.slice(-15)}` : s;
};

/** Decide si un archivo es imagen o vídeo a partir del nombre y del tipo que manda el navegador. */
function classify(name, browserMime) {
  const ext = extOf(name);
  if (IMAGE_EXT[ext]) return { kind: 'image', mime: IMAGE_EXT[ext] };
  if (VIDEO_EXT[ext]) return { kind: 'video', mime: VIDEO_EXT[ext] };
  if (BAD_VIDEO_EXT.has(ext) || (browserMime && /^video\//.test(browserMime) && !VIDEO_MIMES.has(browserMime))) {
    throw new HttpError(400, `"${shortName(name)}": las redes sociales no aceptan vídeos ${ext ? ext.slice(1).toUpperCase() : 'en ese formato'}. Expórtalo en MP4 y vuelve a subirlo.`);
  }
  if (browserMime && VIDEO_MIMES.has(browserMime)) return { kind: 'video', mime: browserMime };
  // Sin extensión conocida: si el navegador dice que es una imagen, lo comprobamos con sharp.
  if (browserMime && /^image\//.test(browserMime) && browserMime !== 'image/svg+xml') return { kind: 'image', mime: browserMime };
  throw new HttpError(400, `"${shortName(name)}" no es una foto ni un vídeo que podamos usar. Sube imágenes JPG, PNG o WEBP, o vídeos MP4 o MOV.`);
}

// ---------- Vídeo: comprobación rápida y metadatos (MP4/MOV) sin programas externos ----------
const ISO_BOXES = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot', 'uuid']);

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

/** Recorre las cajas de un MP4/MOV y devuelve { duration, width, height } (o nulos si no se puede). */
export function probeVideo(file) {
  const out = { container: null, duration: null, width: null, height: null };
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 16);
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) { out.container = 'webm'; return out; }
    if (head.length < 8 || !ISO_BOXES.has(head.toString('latin1', 4, 8))) return out;
    out.container = head.toString('latin1', 4, 8) === 'ftyp' && head.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
    // Busca la caja moov en el nivel superior.
    let pos = 0;
    let moov = null;
    for (let guard = 0; pos + 8 <= size && guard < 10000; guard++) {
      const h = readAt(fd, pos, 16);
      if (h.length < 8) break;
      let boxSize = h.readUInt32BE(0);
      const type = h.toString('latin1', 4, 8);
      let header = 8;
      if (boxSize === 1) {
        if (h.length < 16) break;
        boxSize = Number(h.readBigUInt64BE(8));
        header = 16;
      } else if (boxSize === 0) {
        boxSize = size - pos;
      }
      if (boxSize < header) break;
      if (type === 'moov') {
        if (boxSize > 64 * 1024 * 1024) break;
        moov = readAt(fd, pos + header, boxSize - header);
        break;
      }
      pos += boxSize;
    }
    if (!moov) return out;
    const children = (buf, start, end, cb) => {
      let p = start;
      while (p + 8 <= end) {
        let s = buf.readUInt32BE(p);
        const t = buf.toString('latin1', p + 4, p + 8);
        let hdr = 8;
        if (s === 1) { if (p + 16 > end) return; s = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
        if (s === 0) s = end - p;
        if (s < hdr || p + s > end) return;
        cb(t, p + hdr, p + s);
        p += s;
      }
    };
    children(moov, 0, moov.length, (type, s, e) => {
      if (type === 'mvhd' && e - s >= 32) {
        const v = moov[s];
        const timescale = v === 1 ? moov.readUInt32BE(s + 20) : moov.readUInt32BE(s + 12);
        const dur = v === 1 ? Number(moov.readBigUInt64BE(s + 24)) : moov.readUInt32BE(s + 16);
        if (timescale > 0 && dur > 0 && dur !== 0xffffffff) out.duration = Math.round((dur / timescale) * 100) / 100;
      }
      if (type === 'trak' && out.width == null) {
        children(moov, s, e, (t2, s2, e2) => {
          if (t2 !== 'tkhd') return;
          const v = moov[s2];
          const base = s2 + (v === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 2 + 2 + 2 + 2;
          if (base + 36 + 8 > e2) return;
          const w = moov.readUInt32BE(base + 36) / 65536;
          const h = moov.readUInt32BE(base + 40) / 65536;
          if (!(w > 0 && h > 0)) return; // pista de audio
          const a = moov.readInt32BE(base);
          const d = moov.readInt32BE(base + 16);
          const rotated = a === 0 && d === 0; // matriz de giro de 90/270 grados (móviles en vertical)
          out.width = Math.round(rotated ? h : w);
          out.height = Math.round(rotated ? w : h);
        });
      }
    });
  } catch {
    /* metadatos opcionales */
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ }
  }
  return out;
}

// ---------- Registro ----------
const randomName = (ext) => crypto.randomBytes(12).toString('hex') + ext;
const rm = (p) => { try { fs.rmSync(p, { force: true }); } catch { /* */ } };

/**
 * Comprueba el archivo ya copiado en MEDIA_DIR, lo convierte si hace falta y lo guarda en la base de datos.
 * Si algo falla, borra el archivo y lanza un HttpError con un mensaje claro.
 */
async function registerFile(userId, filename, originalName, browserMime) {
  let full = path.join(MEDIA_DIR, filename);
  try {
    const { kind, mime: guessed } = classify(originalName, browserMime);
    let mime = guessed;
    let size = fs.statSync(full).size;
    if (!size) throw new HttpError(400, `"${shortName(originalName)}" está vacío (0 bytes). Vuelve a exportarlo y súbelo otra vez.`);
    let width = null;
    let height = null;
    let duration = null;
    let thumb = null;
    let displayName = originalName;

    if (kind === 'image') {
      const isHeic = ['.heic', '.heif'].includes(extOf(originalName)) || /hei[cf]/.test(guessed);
      const heicMsg = `"${shortName(originalName)}" es una foto HEIC del iPhone y no podemos convertirla. Ábrela y guárdala como JPG (o en el iPhone: Ajustes > Cámara > Formatos > "Más compatible") y vuelve a subirla.`;
      let meta;
      try {
        meta = await sharp(full, { failOn: 'none' }).metadata();
      } catch {
        throw new HttpError(400, isHeic ? heicMsg : `No hemos podido leer la imagen "${shortName(originalName)}": parece dañada o no es una foto. Prueba con JPG o PNG.`);
      }
      if (PASS_FORMATS[meta.format]) {
        mime = PASS_FORMATS[meta.format];
      } else if (CONVERT_FORMATS.has(meta.format)) {
        // HEIC, AVIF, TIFF…: lo pasamos a JPG para que lo acepten todas las redes.
        const jpgName = randomName('.jpg');
        const jpgPath = path.join(MEDIA_DIR, jpgName);
        try {
          await sharp(full, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toFile(jpgPath);
        } catch {
          rm(jpgPath);
          throw new HttpError(400, isHeic ? heicMsg : `No hemos podido convertir "${shortName(originalName)}" a JPG. Guárdala como JPG o PNG y vuelve a subirla.`);
        }
        rm(full);
        full = jpgPath;
        filename = jpgName;
        mime = 'image/jpeg';
        size = fs.statSync(full).size;
        displayName = `${path.basename(originalName, path.extname(originalName))}.jpg`;
        meta = await sharp(full).metadata();
      } else {
        throw new HttpError(400, `"${shortName(originalName)}" no es una foto que acepten las redes (${String(meta.format || 'formato desconocido').toUpperCase()}). Usa JPG, PNG o WEBP.`);
      }
      // Tiene en cuenta la rotación EXIF.
      const rotated = meta.orientation && meta.orientation >= 5;
      width = rotated ? meta.height : meta.width;
      height = rotated ? meta.width : meta.height;
      // Generar la miniatura obliga a leer la imagen entera: así detectamos archivos cortados o dañados.
      try {
        thumb = await sharp(full, { failOn: 'truncated' }).rotate()
          .resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      } catch {
        throw new HttpError(400, `La imagen "${shortName(originalName)}" está dañada o incompleta. Vuelve a exportarla y súbela otra vez.`);
      }
    } else {
      const probe = probeVideo(full);
      if (!probe.container) {
        throw new HttpError(400, `El vídeo "${shortName(originalName)}" parece dañado o no es un MP4/MOV de verdad. Expórtalo de nuevo en MP4 y vuelve a subirlo.`);
      }
      if (probe.container === 'webm') mime = 'video/webm';
      else if (probe.container === 'mov') mime = 'video/quicktime';
      else if (mime === 'video/webm') mime = 'video/mp4';
      ({ width, height, duration } = probe);
    }

    const r = run(
      'INSERT INTO media (user_id, filename, original_name, mime, kind, size, width, height, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      userId, filename, displayName, mime, kind, size, width, height, duration, now(),
    );
    const id = Number(r.lastInsertRowid);
    if (thumb) try { fs.writeFileSync(path.join(THUMB_DIR, `${id}.webp`), thumb); } catch { /* se regenera al pedirla */ }
    return get('SELECT * FROM media WHERE id = ?', id);
  } catch (e) {
    rm(full);
    throw e;
  }
}

function unregister(m) {
  run('DELETE FROM media WHERE id = ?', m.id);
  for (const p of [mediaPath(m), path.join(THUMB_DIR, `${m.id}.webp`), path.join(CONV_DIR, `${m.id}.jpg`)]) rm(p);
}

// Los nombres con tildes pueden llegar codificados en latin1 desde el navegador.
function fixName(name) {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const out = decoded.includes('�') ? name : decoded;
  return path.basename(out.replace(/\\/g, '/')).slice(0, 200) || 'archivo';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (_req, file, cb) => {
      const ext = extOf(file.originalname);
      cb(null, randomName(/^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ''));
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 20 },
  fileFilter: (_req, file, cb) => {
    try {
      classify(fixName(file.originalname), file.mimetype);
      cb(null, true);
    } catch (e) {
      cb(e);
    }
  },
});

/** Limpia una ruta que Claude o el alumno han podido pegar con comillas, como file:// o con ~. */
export function normalizeLocalPath(input) {
  let p = String(input || '').trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1).trim();
  if (/^file:\/\//i.test(p)) {
    try { p = fileURLToPath(p); } catch { /* se queda como está */ }
  }
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return p;
}

export async function importLocalFile(userId, sourcePath) {
  const src = normalizeLocalPath(sourcePath);
  let st = null;
  try { st = src ? fs.statSync(src) : null; } catch { st = null; }
  if (!st || !st.isFile()) {
    throw new HttpError(400, `No encuentro el archivo: ${src || '(ruta vacía)'}. Comprueba la ruta completa.`);
  }
  const name = path.basename(src);
  classify(name, null);
  if (st.size > MAX_BYTES) throw new HttpError(400, 'El archivo pesa más de 1 GB.');
  const ext = extOf(name);
  const filename = randomName(/^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '');
  try {
    await fs.promises.copyFile(src, path.join(MEDIA_DIR, filename));
  } catch (e) {
    rm(path.join(MEDIA_DIR, filename));
    if (e.code === 'ENOSPC') throw e;
    throw new HttpError(400, `No hemos podido leer el archivo ${src}. ¿Está abierto en otro programa o en una carpeta sin permiso?`);
  }
  return registerFile(userId, filename, name, null);
}

/** Convierte a JPEG (Instagram solo admite JPEG). Devuelve un item de proveedor. */
export async function toJpeg(item) {
  if (item.kind !== 'image' || item.mime === 'image/jpeg') return item;
  const out = path.join(CONV_DIR, `${item.id}.jpg`);
  if (!fs.existsSync(out)) {
    const tmp = `${out}.${process.pid}.tmp`;
    await sharp(item.path, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toFile(tmp);
    fs.renameSync(tmp, out);
  }
  return { ...item, path: out, mime: 'image/jpeg', original_name: (item.original_name || 'imagen').replace(/\.[^.]+$/, '') + '.jpg' };
}

const VIDEO_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#203046"/><circle cx="200" cy="200" r="54" fill="#4A73AA"/><path d="M185 172 L232 200 L185 228 Z" fill="#fff"/></svg>`;

export const mediaRouter = express.Router();

mediaRouter.post('/api/media', requireAuth, upload.array('files', 20), async (req, res, next) => {
  const files = req.files || [];
  const done = [];
  try {
    if (!files.length) throw new HttpError(400, 'No has elegido ningún archivo.');
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        done.push(await registerFile(req.user.id, f.filename, fixName(f.originalname), f.mimetype));
      } catch (e) {
        // Todo o nada: si un archivo falla, no dejamos los demás a medias en la biblioteca.
        for (const rest of files.slice(i + 1)) rm(path.join(MEDIA_DIR, rest.filename));
        for (const m of done) unregister(m);
        throw e;
      }
    }
    res.json(done.map(serializeMedia));
  } catch (e) { next(e); }
});

mediaRouter.post('/api/media/from-path', requireAuth, async (req, res, next) => {
  try {
    const m = await importLocalFile(req.user.id, String(req.body?.path || ''));
    res.json(serializeMedia(m));
  } catch (e) { next(e); }
});

mediaRouter.get('/api/media', requireAuth, (req, res) => {
  res.json(all('SELECT * FROM media WHERE user_id = ? ORDER BY id DESC', req.user.id).map(serializeMedia));
});

mediaRouter.delete('/api/media/:id', requireAuth, (req, res) => {
  const m = get('SELECT * FROM media WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!m) return res.status(404).json({ error: 'No existe ese archivo.' });
  const used = get(
    `SELECT COUNT(*) AS n FROM post_media pm JOIN posts p ON p.id = pm.post_id
     WHERE pm.media_id = ? AND p.status NOT IN ('published')`, m.id,
  ).n;
  if (used) return res.status(409).json({ error: 'Este archivo se usa en una publicación pendiente. Quítalo de ella primero.' });
  unregister(m);
  res.json({ ok: true });
});

function ownMedia(req, res) {
  const m = get('SELECT * FROM media WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!m) res.status(404).end();
  return m;
}

mediaRouter.get('/media/:id/file', requireAuth, (req, res) => {
  const m = ownMedia(req, res);
  if (!m) return;
  if (!fs.existsSync(mediaPath(m))) return res.status(404).end();
  res.type(m.mime);
  // Nombre real al descargar (modo manual), con tildes bien codificadas.
  if (req.query.download) res.attachment(m.original_name || path.basename(m.filename));
  res.sendFile(mediaPath(m), { headers: { 'Cache-Control': 'private, max-age=86400' } });
});

mediaRouter.get('/media/:id/thumb', requireAuth, async (req, res) => {
  const m = ownMedia(req, res);
  if (!m) return;
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (m.kind === 'video') return res.type('image/svg+xml').send(VIDEO_THUMB);
  const out = path.join(THUMB_DIR, `${m.id}.webp`);
  try {
    if (!fs.existsSync(out)) {
      const tmp = `${out}.${process.pid}.tmp`;
      await sharp(mediaPath(m), { failOn: 'none' }).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
      fs.renameSync(tmp, out);
    }
    res.type('image/webp').sendFile(out);
  } catch {
    if (!fs.existsSync(mediaPath(m))) return res.status(404).end();
    res.type(m.mime).sendFile(mediaPath(m));
  }
});
