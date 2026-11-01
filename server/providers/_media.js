// Utilidades de medios compartidas por los proveedores (no es un proveedor: no está en index.js).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderError } from './_http.js';

const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = { instagram: 8 * MB, threads: 8 * MB, facebook: 10 * MB, gbp: 5 * MB };

/** Duración en segundos si se conoce; null si no (WebM, ficheros ilegibles…): "desconocida" NO es 0 ni un error. */
export function knownDuration(m) {
  const d = Number(m?.duration);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Errores de duración de un vídeo; solo si la duración se conoce. */
export function durationErrors(m, { min = 0, max, label }) {
  const d = knownDuration(m);
  if (d === null) return [];
  const out = [];
  if (min && d < min) out.push(`El vídeo dura ${d.toFixed(1)} s y ${label} pide al menos ${min} s.`);
  if (max && d > max) out.push(`El vídeo dura ${Math.round(d)} s y ${label} admite como máximo ${max >= 120 ? `${Math.round(max / 60 * 10) / 10} min` : `${max} s`}.`);
  return out;
}

/** Tamaño real en bytes de un medio (0 si no existe). */
export async function fileSize(item) {
  try { return (await fs.promises.stat(item.path)).size; } catch { return 0; }
}

/**
 * Si la imagen pesa más de `maxBytes`, la reduce (JPEG) hasta que quepa y devuelve un item nuevo apuntando
 * a una copia temporal. Si ya cabe, devuelve el mismo item sin tocarlo.
 */
export async function fitImage(item, { maxBytes, label = 'La red', log } = {}) {
  const size = await fileSize(item);
  if (!size || size <= maxBytes) return item;
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { sharp = null; }
  const name = item.original_name || `imagen ${item.id ?? ''}`.trim();
  if (!sharp) {
    throw new ProviderError(`La imagen "${name}" pesa ${(size / MB).toFixed(1)} MB y ${label} admite como máximo ${(maxBytes / MB).toFixed(maxBytes % MB ? 1 : 0)} MB. Reduce su tamaño y vuelve a programarla.`);
  }
  const dir = path.join(os.tmpdir(), 'willypost-fit');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${item.id ?? 'x'}-${size}-${maxBytes}.jpg`);
  for (const side of [2560, 2048, 1600, 1440, 1080]) {
    for (const q of [88, 78, 68]) {
      let info;
      try {
        info = await sharp(item.path).rotate().flatten({ background: '#ffffff' })
          .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: q, mozjpeg: true }).toFile(out);
      } catch {
        throw new ProviderError(`No hemos podido leer la imagen "${name}" para reducirla. Prueba a subirla de nuevo en JPG o PNG.`);
      }
      if (info.size <= maxBytes) {
        log?.(`${label}: imagen reducida de ${(size / MB).toFixed(1)} MB a ${(info.size / MB).toFixed(1)} MB`);
        return { ...item, path: out, mime: 'image/jpeg', width: info.width, height: info.height };
      }
    }
  }
  throw new ProviderError(`No hemos podido reducir la imagen "${name}" por debajo de ${(maxBytes / MB).toFixed(maxBytes % MB ? 1 : 0)} MB, el máximo de ${label}.`);
}

/** Lanza un error en español si un vídeo supera el tamaño máximo de la red. */
export async function checkVideoSize(item, { maxBytes, label }) {
  const size = await fileSize(item);
  if (size > maxBytes) {
    throw new ProviderError(
      `El vídeo "${item.original_name || item.id}" pesa ${Math.round(size / MB)} MB y ${label} admite como máximo ${(maxBytes / MB).toFixed(maxBytes % MB ? 1 : 0)} MB. Comprímelo (por ejemplo con HandBrake) y vuelve a programarlo.`,
    );
  }
  return size;
}
