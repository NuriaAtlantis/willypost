const dtf = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const dfs = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const tf = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (iso) => (iso ? dtf.format(new Date(iso)).replace(/\./g, '') : 'Sin fecha');
export const fmtDay = (iso) => (iso ? df.format(new Date(iso)) : '');
export const fmtDayShort = (iso) => (iso ? dfs.format(new Date(iso)).replace(/\./g, '') : '');
export const fmtTime = (iso) => (iso ? tf.format(new Date(iso)) : '');

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ISO UTC -> valor para <input type="datetime-local">
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

export function snippet(text, n = 80) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Los ajustes pueden llegar como texto JSON o ya como objeto.
export function parseSetting(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

// Texto efectivo de una publicación: caption base o el de la red
export const effectiveCaption = (target, base) => (target && target.caption_override != null ? target.caption_override : base) || '';
