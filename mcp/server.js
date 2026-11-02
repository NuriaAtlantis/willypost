#!/usr/bin/env node
// Servidor MCP de WillyPost (stdio). Habla con la API REST local (SPEC §5) con un token Bearer.
// Variables de entorno: WILLYPOST_URL (def. http://localhost:4747) y WILLYPOST_TOKEN.
// IMPORTANTE: por stdout solo circula el protocolo MCP. Todo el registro va a stderr.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TIKTOK_HUMAN_KEYS } from '../server/compliance.js';

// Blindaje: cualquier console.log accidental NO debe ensuciar stdout.
console.log = (...a) => console.error(...a);
console.info = (...a) => console.error(...a);

const BASE = (process.env.WILLYPOST_URL || 'http://localhost:4747').replace(/\/+$/, '');
const TOKEN = process.env.WILLYPOST_TOKEN || '';
const NOT_OPEN = 'WillyPost no está abierto. Ábrelo (doble clic en el icono de WillyPost) y vuelve a intentarlo.';

let VERSION = '1.0.0';
try {
  VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || VERSION;
} catch { /* sin versión */ }

const FEED_MAX = 5;
const STORY_MAX = 10;
const MEDIA_EXT = /\.(jpe?g|jfif|png|webp|gif|heic|heif|avif|tiff?|mp4|m4v|mov|qt|webm)$/i;
const NETWORKS = ['instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'gbp', 'linkedin', 'bluesky'];
const TYPES = ['post', 'carousel', 'reel', 'story'];
const NETWORK_LABEL = {
  instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads', tiktok: 'TikTok',
  youtube: 'YouTube Shorts', gbp: 'Google Business Profile', linkedin: 'LinkedIn', bluesky: 'Bluesky',
};
const STATUS_LABEL = {
  draft: 'borrador', scheduled: 'programada', publishing: 'publicándose', published: 'publicada',
  partial: 'publicada en parte', failed: 'fallida', missed: 'perdida (el ordenador estaba apagado)',
  manual: 'pendiente de publicar a mano',
};
const ACCOUNT_STATUS_LABEL = {
  ok: 'conectada', expiring: 'a punto de caducar (reconectar pronto)', expired: 'CADUCADA (reconectar)',
  error: 'con error (reconectar)', manual: 'modo manual',
};

// ------------------------------------------------------------------ errores y API

class UserError extends Error {}
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function api(method, pathname, { body, query, timeout = 45000 } = {}) {
  if (!TOKEN) {
    throw new UserError(
      'Falta el token de WillyPost en la configuración de Claude (WILLYPOST_TOKEN). Abre WillyPost > Claude, genera un token y vuelve a conectar Claude.',
    );
  }
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new UserError('WillyPost tarda demasiado en responder. Comprueba que sigue abierto y vuelve a intentarlo.');
    }
    console.error('[willypost-mcp] fetch falló:', e?.cause?.code || e?.message || e);
    throw new UserError(NOT_OPEN);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = null; }
  if (res.status === 401) {
    throw new UserError('WillyPost no reconoce el token de Claude. Abre WillyPost > Claude, genera un token nuevo y vuelve a conectar Claude.');
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Error ${res.status} de WillyPost`, data?.details);
  }
  if (data === null) throw new UserError(`La dirección ${BASE} no responde como WillyPost. Comprueba WILLYPOST_URL.`);
  return data;
}

// ------------------------------------------------------------------ resultados

const MAX_JSON = 24000;
function out(text, data) {
  let t = text;
  if (data !== undefined) {
    let j = JSON.stringify(data);
    if (j.length > MAX_JSON) j = `${j.slice(0, MAX_JSON)}… (recortado)`;
    t += `\n\nJSON:\n${j}`;
  }
  return { content: [{ type: 'text', text: t }] };
}
function fail(text) {
  return { content: [{ type: 'text', text }], isError: true };
}
function formatDetails(details) {
  if (!Array.isArray(details) || !details.length) return '';
  return `\n${details.map((d) => `- ${d.network ? `${NETWORK_LABEL[d.network] || d.network}: ` : ''}${d.message || JSON.stringify(d)}`).join('\n')}`;
}
function errorText(e) {
  if (e instanceof UserError) return e.message;
  if (e instanceof ApiError) {
    let extra = '';
    if (e.status === 409) extra = '\n(Pista: usa get_free_slots para elegir otro día, o cambia la hora/día.)';
    if (e.status === 403) extra = '\n(Esto lo tiene que hacer el alumno directamente en WillyPost: Claude no puede aprobar, publicar al momento ni cambiar ajustes. Díselo tal cual.)';
    return `${e.message}${formatDetails(e.details)}${extra}`;
  }
  console.error('[willypost-mcp] error inesperado:', e);
  return `Error inesperado: ${e?.message || e}`;
}

// ------------------------------------------------------------------ fechas y zona horaria

let tzCache = null;
let settingsCache = null;
async function getSettings({ fresh = false } = {}) {
  if (settingsCache && !fresh) return settingsCache;
  const me = await api('GET', '/api/me');
  settingsCache = { user: me.user, ...(me.settings || {}) };
  tzCache = settingsCache.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return settingsCache;
}
async function getTz() {
  if (tzCache) return tzCache;
  try { await getSettings(); } catch { /* usamos la del sistema */ }
  return tzCache || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function zonedParts(date, tz) {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return p;
}
function tzOffsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
function offsetString(date, tz) {
  const min = Math.round(tzOffsetMs(date, tz) / 60000);
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function localIso(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offsetString(date, tz)}`;
}
function dayKey(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
function startOfLocalDay(ymd, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const off1 = tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(guess - off1), tz);
  return new Date(guess - off2);
}
function fmtWhen(iso, tz) {
  if (!iso) return 'sin fecha';
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/** from/to aceptan 'YYYY-MM-DD' (día local) o ISO completo. `to` en formato fecha incluye ese día entero. */
async function rangeToIso(from, to, defaultDays = 30) {
  const tz = await getTz();
  const now = new Date();
  let f;
  let t;
  if (!from) f = startOfLocalDay(dayKey(now, tz), tz);
  else if (DATE_ONLY.test(from)) f = startOfLocalDay(from, tz);
  else f = new Date(from);
  if (!to) t = new Date(f.getTime() + defaultDays * 86400000);
  else if (DATE_ONLY.test(to)) {
    const next = new Date(startOfLocalDay(to, tz).getTime() + 36 * 3600000);
    t = startOfLocalDay(dayKey(next, tz), tz);
  } else t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
    throw new UserError('Las fechas no son válidas. Usa el formato 2026-11-03 o 2026-11-03T09:30:00+01:00.');
  }
  return { from: f.toISOString(), to: t.toISOString(), tz };
}

async function normalizeScheduledAt(value) {
  const tz = await getTz();
  const s = String(value).trim();
  if (!/T/.test(s) || !HAS_OFFSET.test(s)) {
    const ex = localIso(new Date(Date.now() + 86400000), tz);
    throw new UserError(
      `scheduled_at debe ser una fecha-hora ISO con desfase horario, en la hora local del usuario (${tz}). Ejemplo: ${ex}. Recibido: "${s}".`,
    );
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new UserError(`scheduled_at no es una fecha válida: "${s}".`);
  if (d.getTime() < Date.now() - 60000) {
    throw new UserError(`scheduled_at ya ha pasado ("${s}"). Ahora son las ${localIso(new Date(), tz)}. Elige una fecha futura (llama a willypost_status para ver la hora actual).`);
  }
  return d.toISOString();
}

/** Comprueba que cada cuenta tiene hueco ese día (los borradores no cuentan en el servidor, pero no se podrían aprobar luego). */
async function assertDayHasRoom(accounts, type, scheduledIso, tz) {
  const day = dayKey(new Date(scheduledIso), tz);
  const cat = type === 'story' ? 'story' : 'feed';
  const max = cat === 'story' ? STORY_MAX : FEED_MAX;
  let slots;
  try {
    const from = startOfLocalDay(day, tz);
    slots = await api('GET', '/api/slots', { query: { from: from.toISOString(), to: new Date(from.getTime() + 25 * 3600000).toISOString() } });
  } catch { return; /* si no se puede comprobar, valida el servidor al programar */ }
  for (const a of accounts) {
    const s = slots.find((x) => x.account_id === a.id && x.date === day);
    const n = s ? s[cat] : 0;
    if (n + 1 > max) {
      throw new UserError(`El ${day} ${accFull(a)} ya tiene ${n} ${cat === 'story' ? 'stories' : 'publicaciones de feed'} (máximo ${max} al día). Elige otro día (get_free_slots).`);
    }
  }
}

/** Ruta local tal y como la escribe un alumno: con comillas, file://, ~, tildes (Mac guarda los nombres descompuestos). */
function resolveLocalPath(input) {
  let p = String(input || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  if (!p) throw new UserError('Falta la ruta del archivo. Ejemplo: C:\\Users\\ana\\Videos\\reel1.mp4 o /Users/ana/Fotos/foto.jpg');
  if (/^file:\/\//i.test(p)) {
    try { p = fileURLToPath(p); } catch { p = decodeURIComponent(p.replace(/^file:\/+/i, process.platform === 'win32' ? '' : '/')); }
  }
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  if (!path.isAbsolute(p)) {
    throw new UserError(`La ruta "${p}" no es absoluta. Pide al alumno la ruta completa (en Windows empieza por C:\\, en Mac por /Users/…).`);
  }
  for (const cand of [p, p.normalize('NFC'), p.normalize('NFD')]) {
    if (fs.existsSync(cand)) return cand;
  }
  const dir = path.dirname(p);
  const hint = fs.existsSync(dir)
    ? ` La carpeta existe pero no hay ningún archivo con ese nombre: revisa tildes, espacios y la extensión.`
    : ' La carpeta tampoco existe: revisa la ruta completa.';
  throw new UserError(`No encuentro "${p}".${hint}`);
}

// ------------------------------------------------------------------ cuentas y formato

const accLabel = (a) => (a.username ? `@${String(a.username).replace(/^@/, '')}` : a.name);
const accFull = (a) => `${NETWORK_LABEL[a.network] || a.network} ${accLabel(a)} (id ${a.id})`;

function summarizePost(p, tz) {
  const targets = (p.targets || [])
    .map((t) => `${t.network}${t.account_name ? ` ${t.account_name}` : ''}${t.delivery === 'manual' ? ' [manual]' : ''}${['failed'].includes(t.status) ? ' [FALLÓ]' : ''}`)
    .join(', ');
  const cap = String(p.caption || '').replace(/\s+/g, ' ').slice(0, 70);
  return `#${p.id} · ${p.type} · ${STATUS_LABEL[p.status] || p.status}${p.created_by === 'claude' ? ' · propuesto por Claude' : ''} · ${p.scheduled_at ? fmtWhen(p.scheduled_at, tz) : 'sin fecha'}${p.campaign ? ` · campaña "${p.campaign.name}"` : ''} · ${targets || 'sin redes'} · "${cap}${(p.caption || '').length > 70 ? '…' : ''}"`;
}

// ------------------------------------------------------------------ creación de publicaciones

const networkEnum = z.enum(NETWORKS);
const postItemShape = {
  type: z.enum(TYPES).describe('Tipo de pieza: post (texto y/o 1 imagen), carousel (2 o más imágenes), reel (1 vídeo vertical) o story (1 imagen/vídeo vertical, caduca en 24 h).'),
  caption: z.string().optional().describe('Texto base de la publicación (incluye hashtags y llamada a la acción). Se usa en todas las redes que no tengan texto propio en captions_by_network.'),
  networks: z.array(networkEnum).optional().describe('Redes donde publicar: se usan TODAS las cuentas conectadas de cada red. Alternativa a account_ids.'),
  account_ids: z.array(z.number().int()).optional().describe('IDs concretos de cuentas (ver list_accounts). Úsalo si el alumno tiene varias cuentas de una misma red y quieres solo algunas.'),
  captions_by_network: z.record(z.string(), z.string()).optional().describe('Texto propio por red, p. ej. {"linkedin":"…","instagram":"…"}. Sustituye al texto base en esa red. Respeta los límites de cada red (get_network_specs).'),
  options_by_network: z.record(z.string(), z.record(z.string(), z.any())).optional().describe('Opciones específicas por red, p. ej. {"youtube":{"title":"…","privacy":"public"},"gbp":{"cta":{"actionType":"LEARN_MORE","url":"https://…"}},"tiktok":{"tiktok_mode":"direct"}}. En TikTok NO se puede poner la privacidad, comentarios/dúos/stitch ni el contenido comercial: los elige el alumno al aprobar.'),
  media_ids: z.array(z.number().int()).optional().describe('IDs de archivos ya subidos con upload_media, en orden (el primero es la portada del carrusel). Los medios se suben ANTES de crear la pieza.'),
  scheduled_at: z.string().optional().describe('Fecha y hora de publicación en la HORA LOCAL del usuario, en ISO 8601 CON desfase, p. ej. 2026-11-03T09:30:00+01:00. Si no la pones, se guarda como borrador sin fecha.'),
  notes: z.string().optional().describe('Nota interna para el alumno (idea, objetivo de la pieza, qué grabar…). No se publica.'),
};

/**
 * Reglas de TikTok (Content Sharing Guidelines): la privacidad, Comentarios/Dúo/Stitch y la divulgación de
 * contenido comercial las elige SIEMPRE la persona en WillyPost, al aprobar. Claude no puede fijarlas.
 */
function assertNoTikTokHumanChoices(optionsByNetwork) {
  const tt = optionsByNetwork?.tiktok;
  const bad = tt && typeof tt === 'object' ? Object.keys(tt).filter((k) => TIKTOK_HUMAN_KEYS.includes(k)) : [];
  if (bad.length) {
    throw new UserError(
      `En TikTok no puedes elegir ${bad.join(', ')}: la privacidad (quién puede verlo), los comentarios/dúos/stitch y la divulgación de contenido comercial los elige el alumno en WillyPost al aprobar. Quita esas claves de options_by_network.tiktok (puedes dejar "tiktok_mode") y crea la pieza: quedará como borrador "Propuesto por Claude" para que el alumno lo complete.`,
    );
  }
}

function resolveTargets(a, accounts) {
  assertNoTikTokHumanChoices(a.options_by_network);
  const warnings = [];
  const chosen = new Map();
  for (const id of a.account_ids || []) {
    const acc = accounts.find((x) => x.id === Number(id));
    if (!acc) throw new UserError(`La cuenta ${id} no existe. Usa list_accounts para ver los IDs.`);
    chosen.set(acc.id, acc);
  }
  for (const net of a.networks || []) {
    const list = accounts.filter((x) => x.network === net);
    if (!list.length) {
      throw new UserError(`No hay ninguna cuenta de ${NETWORK_LABEL[net] || net} conectada. Dile al alumno que la conecte en WillyPost > Redes (o añádela en modo manual).`);
    }
    const usable = list.filter((x) => x.status !== 'expired');
    for (const x of list.filter((y) => y.status === 'expired')) {
      warnings.push(`${accFull(x)} está caducada y se ha omitido (hay que reconectarla en WillyPost > Redes).`);
    }
    if (!usable.length) throw new UserError(`Todas las cuentas de ${NETWORK_LABEL[net] || net} están caducadas. Hay que reconectarlas en WillyPost > Redes.`);
    for (const x of usable) {
      chosen.set(x.id, x);
      if (x.status === 'error') warnings.push(`${accFull(x)} tiene un error de conexión; puede que falle al publicar (reconectar).`);
    }
  }
  if (!chosen.size) throw new UserError('Indica dónde publicar: networks (p. ej. ["instagram","tiktok"]) o account_ids.');
  const targets = [...chosen.values()].map((acc) => ({
    account_id: acc.id,
    caption: a.captions_by_network?.[acc.network] ?? null,
    options: a.options_by_network?.[acc.network] ?? {},
  }));
  const nets = new Set([...chosen.values()].map((x) => x.network));
  for (const k of Object.keys(a.captions_by_network || {})) {
    if (!nets.has(k)) warnings.push(`captions_by_network["${k}"] se ha ignorado porque esa red no está entre los destinos.`);
  }
  return { targets, warnings, accounts: [...chosen.values()] };
}

async function resolveCampaignId(campaign, cache) {
  if (campaign === undefined || campaign === null || campaign === '') return null;
  if (typeof campaign === 'number' || /^\d+$/.test(String(campaign))) return Number(campaign);
  const name = String(campaign).trim();
  if (!cache.list) cache.list = await api('GET', '/api/campaigns');
  const found = cache.list.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const created = await api('POST', '/api/campaigns', { body: { name } });
  cache.list.push(created);
  return created.id;
}

async function buildPostBody(a, env) {
  const { targets, warnings, accounts } = resolveTargets(a, env.accounts);
  const scheduled = a.scheduled_at ? await normalizeScheduledAt(a.scheduled_at) : null;
  let caption = a.caption;
  if (caption === undefined || caption === null || caption === '') {
    caption = Object.values(a.captions_by_network || {}).find((v) => v) || '';
  }
  return {
    warnings,
    accounts,
    scheduled,
    body: {
      type: a.type,
      caption,
      media_ids: (a.media_ids || []).map(Number),
      targets,
      scheduled_at: scheduled,
      action: scheduled ? 'schedule' : 'draft',
      campaign_id: env.campaignId ?? null,
      notes: a.notes || '',
      created_by: 'claude',
    },
  };
}

function describeResult(post, extraWarnings, tz) {
  const lines = [];
  const proposed = post.status === 'draft' && post.scheduled_at;
  lines.push(`Pieza #${post.id} (${post.type}) creada: ${STATUS_LABEL[post.status] || post.status}${post.created_by === 'claude' ? ' · propuesta por Claude' : ''}.`);
  if (post.scheduled_at) lines.push(`  ${proposed ? 'Fecha propuesta' : 'Fecha'}: ${fmtWhen(post.scheduled_at, tz)} (${post.scheduled_at})`);
  if (post.campaign) lines.push(`  Campaña: ${post.campaign.name} (id ${post.campaign.id})`);
  for (const t of post.targets || []) {
    lines.push(`  - ${NETWORK_LABEL[t.network] || t.network} ${t.account_name || ''}: ${t.delivery === 'manual' ? 'MODO MANUAL (a su hora saltará un aviso para que el alumno lo publique a mano)' : 'automática por API'}`);
  }
  const ws = [...(extraWarnings || []), ...((post.warnings || []).map((w) => (typeof w === 'string' ? w : `${w.network ? `${NETWORK_LABEL[w.network] || w.network}: ` : ''}${w.message}`)))];
  for (const w of ws) lines.push(`  Aviso: ${w}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ especificaciones por red

const SPECS = {
  instagram: {
    nombre: 'Instagram',
    tipos_en_willypost: 'post (1 imagen; no admite solo texto), carousel (2-20 imágenes), reel, story. Todo automático por API.',
    imagen: 'JPEG (WillyPost convierte PNG/WebP solo). Máx. 8 MB. Formato recomendado vertical 4:5 = 1080x1350 px (ocupa más pantalla). Válidos de 4:5 a 1,91:1; 1:1 = 1080x1080. En carrusel todas las imágenes deben tener la misma proporción (manda la primera).',
    carrusel: '2-20 imágenes (límite actual de Instagram; con 6-10 suele rendir mejor). Portada con gancho claro; última diapositiva con llamada a la acción. Los carruseles guardan y comparten mucho: ideales para contenido educativo.',
    reel: 'Vídeo vertical 9:16 = 1080x1920 px, MP4/MOV (H.264 o HEVC), 3 s a 15 min, máx. 300 MB, 23-60 fps. Lo más eficaz: 15-45 s, gancho en los primeros 2 s y subtítulos incrustados (mucha gente lo ve sin sonido).',
    story: 'Vertical 9:16 = 1080x1920 px. Imagen JPEG máx. 8 MB o vídeo de 3-60 s (máx. 100 MB). Deja libres los márgenes superior e inferior (~250 px). Dura 24 h. Por API no se pueden poner stickers, encuestas ni enlaces: si los necesitas, mejor publícala a mano.',
    texto: 'Hasta 2.200 caracteres; solo se ven ~125 antes de "más": pon el gancho en la primera línea. Los enlaces del texto NO son clicables.',
    hashtags: '3-5 hashtags muy relevantes al final del texto (mezcla de nicho y generales). Más no mejora el alcance.',
    notas: 'Requiere cuenta profesional (Empresa o Creador). Las imágenes se publican vía un enlace temporal que abre WillyPost, por eso el ordenador debe estar encendido.',
  },
  facebook: {
    nombre: 'Facebook (Página)',
    tipos_en_willypost: 'post (solo texto, enlace o 1 foto), carousel (varias fotos, hasta 10), reel, story (se intenta por API; si Facebook la rechaza pasa a modo manual).',
    imagen: 'JPG/PNG. Recomendado 1080x1350 (4:5), 1080x1080 (1:1) o 1200x630 para enlaces. Máx. 10 fotos por publicación.',
    reel: 'Vertical 9:16 = 1080x1920 px, MP4 H.264, 3-90 s (máx. 90 s en WillyPost). Subtítulos incrustados.',
    story: '9:16 = 1080x1920; imagen o vídeo hasta ~60 s. Puede acabar en modo manual.',
    texto: 'Admite textos largos (63.206 caracteres) pero rinde mejor corto (1-3 frases + llamada a la acción). Los enlaces del texto SÍ son clicables (options.link añade enlace destacado).',
    hashtags: '0-3; en Facebook influyen poco.',
    notas: 'Publica en Páginas de las que el alumno es administrador. Para que el público vea los posts, la app de Meta debe estar en modo Live.',
  },
  threads: {
    nombre: 'Threads',
    tipos_en_willypost: 'post (texto solo o 1 imagen), carousel (2-20 imágenes), reel (vídeo). No existen stories (irían a modo manual).',
    texto: 'Máx. 500 caracteres por publicación. Tono conversacional, una idea por post, termina con una pregunta para generar respuestas. Hasta 5 enlaces distintos.',
    imagen: 'JPEG/PNG, máx. 8 MB, ancho 320-1440 px. Carrusel de 2 a 20.',
    reel: 'Vídeo MP4/MOV (H.264/HEVC), hasta 5 min y 1 GB. Mejor vertical 9:16.',
    hashtags: 'Máximo 1 (Threads lo usa como "tema"); en Threads no funcionan como en Instagram.',
    notas: 'Se publica vía enlace temporal de los medios; ordenador encendido.',
  },
  tiktok: {
    nombre: 'TikTok',
    tipos_en_willypost: 'SOLO reel (vídeo). Posts, carruseles de fotos y stories no se pueden publicar por API: irán a modo manual.',
    reel: 'Vídeo 9:16 = 1080x1920 px, MP4/WebM/MOV, H.264/H.265, 23-60 fps, lados entre 360 y 4096 px. Hasta 10 min por API (4 GB), pero lo habitual es 15-60 s. Gancho en el primer segundo, subtítulos incrustados, formato nativo (no reutilices el vídeo con marca de agua de otra red).',
    texto: 'Descripción hasta 2.200 caracteres; lo importante en la primera línea.',
    hashtags: '3-5: 1-2 amplios + 2-3 de nicho. Palabras clave del tema en el texto ayudan a la búsqueda de TikTok.',
    notas: 'options: {"tiktok_mode":"direct"|"inbox"} ("direct" publica directamente; "inbox" lo deja en la bandeja de TikTok del alumno para terminarlo en la app). Reglas de TikTok: la privacidad (quién puede verlo, sin opción por defecto), permitir comentarios/dúos/stitch y la divulgación de contenido comercial las elige SIEMPRE el alumno en WillyPost al aprobar; tú no puedes ponerlas (error si lo intentas). Por eso una pieza de TikTok en modo directo queda como borrador "Propuesto por Claude" aunque lleve fecha: avisa al alumno de que la abra, elija esas opciones y pulse Programar. No añadas marcas de agua ni logos de WillyPost al contenido.',
  },
  youtube: {
    nombre: 'YouTube Shorts',
    tipos_en_willypost: 'SOLO reel (vídeo vertical). El resto de tipos va a modo manual.',
    reel: 'Vertical 9:16 (o cuadrado), MP4. Un vídeo vertical de hasta 3 min se clasifica como Short; para máxima compatibilidad usa ≤ 60 s. 1080x1920 px.',
    texto: 'Título OBLIGATORIO (options_by_network.youtube.title) hasta 100 caracteres, con la palabra clave al principio. La descripción es el texto (hasta 5.000 caracteres). Incluye #Shorts.',
    hashtags: '2-3 hashtags + #Shorts (los 3 primeros aparecen sobre el título).',
    notas: 'Visibilidad OBLIGATORIA: options_by_network.youtube.privacy = public | unlisted | private (propón una; el alumno la revisa al aprobar). Sin título o sin visibilidad la pieza queda como borrador hasta que el alumno los ponga. Si el vídeo aparece en privado, el alumno puede ponerlo en público en YouTube Studio.',
  },
  gbp: {
    nombre: 'Google Business Profile (ficha de Google)',
    tipos_en_willypost: 'post (texto, con 1 foto opcional). Carrusel, reel y story no existen (modo manual).',
    imagen: 'Una sola foto JPG/PNG, mínimo 250x250 px (recomendado 4:3, p. ej. 1200x900), sin texto excesivo ni logos gigantes. Sin vídeo.',
    texto: 'Hasta 1.500 caracteres; lo visible empieza por los primeros ~100: pon ahí servicio + ciudad/zona. Idioma español por defecto.',
    boton: 'options_by_network.gbp.cta = {"actionType":"LEARN_MORE|BOOK|ORDER|SHOP|SIGN_UP|CALL","url":"https://…"} (CALL no lleva url). Si hay un enlace en el texto se usa LEARN_MORE automáticamente.',
    hashtags: 'No uses hashtags. SEO local: nombre del servicio + ciudad/barrio de forma natural, oferta o novedad concreta, teléfono/enlace de reserva en el botón.',
    notas: 'Requiere que Google haya aprobado el acceso a la API de Business Profile. Publicar de forma regular (semanal) ayuda a la ficha.',
  },
  linkedin: {
    nombre: 'LinkedIn (perfil personal)',
    tipos_en_willypost: 'post (texto solo o 1 imagen), carousel (2-20 imágenes, se publica como multiimagen), reel (1 vídeo). Stories no existen (modo manual).',
    texto: 'Hasta 3.000 caracteres. Solo se ven ~140-210 antes de "ver más": primera línea = gancho. Frases cortas, líneas en blanco, 1 idea por post, termina con pregunta o llamada a la acción.',
    imagen: 'JPG/PNG/GIF. Recomendado 1080x1350 (4:5) o 1200x627. Multiimagen: 2-20.',
    reel: 'Vídeo MP4, 3 s a 30 min, 75 KB a 500 MB. Vertical 9:16 o cuadrado 1:1 funcionan bien en móvil; subtítulos incrustados.',
    hashtags: '3-5 al final, específicos del sector.',
    notas: 'Los enlaces externos en el texto reducen el alcance: mejor ponerlos en un comentario (a mano) o al final.',
  },
  bluesky: {
    nombre: 'Bluesky',
    tipos_en_willypost: 'post (texto solo o con imágenes), carousel (2-4 imágenes), reel (1 vídeo). Sin stories.',
    texto: 'Máx. 300 caracteres (grafemas). Los enlaces y #hashtags se convierten en enlaces clicables automáticamente.',
    imagen: 'Hasta 4 imágenes por post; WillyPost las reduce solo si pesan más de ~950 KB.',
    reel: 'Vídeo MP4 corto (hasta ~3 min según el límite vigente de Bluesky). Exige email verificado en Bluesky. Si falla la subida el envío falla con un aviso claro.',
    hashtags: '1-2 como mucho.',
    notas: 'Se conecta con una contraseña de aplicación (no hace falta carné de desarrollador).',
  },
};

const GENERAL_SPECS = {
  limites_willypost: `Máximo ${FEED_MAX} publicaciones de feed (post+carrusel+reel) y ${STORY_MAX} stories por cuenta y día natural (hora local). Con más, WillyPost responde con error.`,
  horas: 'Las horas son la hora local del usuario y se envían en ISO con desfase (2026-11-03T09:30:00+01:00).',
  medios: 'Sube siempre los archivos antes (upload_media) y usa los media_id. El tipo de pieza debe coincidir con los medios: post = 0-1 imagen, carousel = 2+ imágenes, reel = 1 vídeo, story = 1 imagen o vídeo.',
  modo_manual: 'Si una red no admite ese tipo por API (p. ej. carrusel en TikTok, story en Threads) o la cuenta está en modo manual, la pieza se crea igualmente y a su hora salta un aviso para que el alumno la publique a mano.',
  aprobacion: 'Por defecto lo que crea Claude llega como borrador "Propuesto por Claude" y el alumno debe aprobarlo en WillyPost. Solo se programa directamente si el alumno cambió el ajuste a "Claude programa directamente".',
  frecuencia_orientativa: 'Para empezar: Instagram 3-4 posts/semana + stories a diario, Facebook 2-3/semana, TikTok 3-5 vídeos/semana, LinkedIn 2-3/semana, Threads/Bluesky a diario si hay tiempo, GBP 1/semana.',
};

function renderSpec(s) {
  const lines = [`## ${s.nombre}`];
  for (const [k, v] of Object.entries(s)) if (k !== 'nombre') lines.push(`- ${k.replace(/_/g, ' ')}: ${v}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ servidor MCP

const server = new McpServer(
  { name: 'willypost', version: VERSION },
  {
    instructions:
      'WillyPost es el programador de redes sociales del alumno de la Willy SEO Academy. Antes de planificar, llama a willypost_status (hora local, redes conectadas, modo borrador/programar) y get_free_slots. Sube los medios con upload_media antes de crear piezas. Envía siempre scheduled_at como ISO con desfase en la hora local del usuario. Límites por cuenta y día: 5 publicaciones de feed y 10 stories. Lo que crees llega como borrador que el alumno aprueba en WillyPost (salvo que haya activado programación directa). Tú NO puedes aprobar, publicar al momento, reintentar envíos ni cambiar ajustes: si una herramienta devuelve un error 403 o 409, cuéntaselo al alumno con las mismas palabras del mensaje y dile qué hacer en WillyPost.',
  },
);

function tool(name, config, handler) {
  server.registerTool(name, config, async (args, extra) => {
    try {
      return await handler(args || {}, extra);
    } catch (e) {
      return fail(errorText(e));
    }
  });
}

// --- willypost_status
tool('willypost_status', {
  title: 'Estado de WillyPost',
  description:
    'Comprueba que WillyPost está abierto y devuelve: usuario, fecha y hora actuales en la zona horaria local, redes/cuentas conectadas con su estado (conectada, a punto de caducar, caducada, modo manual), el modo de Claude (draft = lo que crees llega como borrador "Propuesto por Claude" para que el alumno lo apruebe; schedule = se programa directamente), las horas de la cola y los límites (5 publicaciones de feed y 10 stories por cuenta y día). Llámala SIEMPRE al empezar a planificar.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  const [health, me, accounts] = await Promise.all([api('GET', '/api/health'), getSettings({ fresh: true }), api('GET', '/api/accounts')]);
  const tz = await getTz();
  const now = new Date();
  const nowTxt = now.toLocaleString('es-ES', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
  const lines = [
    `WillyPost ${health.version || ''} está abierto.`,
    `Usuario: ${me.user?.name || ''} <${me.user?.email || ''}>`,
    `Ahora: ${nowTxt} (${tz}, UTC${offsetString(now, tz)}). Hora local ISO: ${localIso(now, tz)}`,
    `Modo de Claude: ${me.claude_mode === 'schedule' ? 'schedule (lo que programes se publica directamente)' : 'draft (lo que crees llega como borrador "Propuesto por Claude" y el alumno debe aprobarlo en WillyPost)'}`,
    `Horas de la cola: ${(me.queue_times || []).join(', ') || '—'}`,
    `Límites por cuenta y día: ${FEED_MAX} publicaciones de feed (post/carrusel/reel) y ${STORY_MAX} stories.`,
    '',
    accounts.length ? 'Cuentas:' : 'No hay ninguna cuenta conectada. Pide al alumno que conecte sus redes en WillyPost > Redes.',
  ];
  for (const a of accounts) {
    lines.push(`- [${a.id}] ${NETWORK_LABEL[a.network] || a.network} ${accLabel(a)} — ${ACCOUNT_STATUS_LABEL[a.status] || a.status}${a.days_left != null && a.status !== 'expired' && a.mode !== 'manual' ? `, quedan ${a.days_left} días de conexión` : ''}${a.last_error ? ` · último error: ${a.last_error}` : ''}`);
  }
  return out(lines.join('\n'), {
    version: health.version, user: me.user, now: localIso(now, tz), timezone: tz,
    claude_mode: me.claude_mode, queue_times: me.queue_times,
    limits: { feed_per_day: FEED_MAX, stories_per_day: STORY_MAX },
    accounts: accounts.map((a) => ({ id: a.id, network: a.network, name: a.name, username: a.username, status: a.status, mode: a.mode, days_left: a.days_left })),
  });
});

// --- list_accounts
tool('list_accounts', {
  title: 'Listar cuentas conectadas',
  description:
    'Lista las cuentas de redes sociales del alumno (Instagram, Facebook, TikTok, Google Business Profile, YouTube Shorts, LinkedIn, Threads, Bluesky) con su id, estado y días que quedan de conexión (las conexiones caducan a los 30 días). Los id sirven para account_ids en create_post cuando hay varias cuentas de una misma red. Las cuentas caducadas no publican.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  const accounts = await api('GET', '/api/accounts');
  if (!accounts.length) return out('No hay cuentas conectadas. El alumno debe conectarlas en WillyPost > Redes.', []);
  const lines = accounts.map((a) => `[${a.id}] ${NETWORK_LABEL[a.network] || a.network} · ${accLabel(a)} · ${ACCOUNT_STATUS_LABEL[a.status] || a.status}${a.days_left != null ? ` · ${a.days_left} días` : ''}${a.mode === 'manual' ? ' · se publica a mano' : ''}`);
  return out(lines.join('\n'), accounts);
});

// --- get_calendar
tool('get_calendar', {
  title: 'Ver calendario',
  description:
    'Devuelve las publicaciones del calendario entre dos fechas (programadas, publicadas, borradores con fecha, fallidas…) y, aparte, los borradores sin fecha. Úsala antes de planificar para no solapar contenido y para revisar una campaña. from/to en formato 2026-11-03 (día local; to incluye el día entero) o ISO completo. Si no indicas fechas devuelve los próximos 30 días.',
  inputSchema: {
    from: z.string().optional().describe('Inicio, p. ej. 2026-11-01 (día local) o ISO con desfase.'),
    to: z.string().optional().describe('Fin (inclusive si es solo fecha), p. ej. 2026-11-30.'),
    status: z.string().optional().describe('Filtro opcional por estado, separados por comas: draft,scheduled,published,failed,missed,manual,partial.'),
    campaign_id: z.number().int().optional().describe('Filtra por campaña.'),
  },
  annotations: { readOnlyHint: true },
}, async ({ from, to, status, campaign_id }) => {
  const r = await rangeToIso(from, to);
  const posts = await api('GET', '/api/posts', { query: { from: r.from, to: r.to, status, campaign_id } });
  const dated = posts.filter((p) => p.scheduled_at);
  const undated = posts.filter((p) => !p.scheduled_at);
  const head = `Calendario del ${fmtWhen(r.from, r.tz)} al ${fmtWhen(r.to, r.tz)} (${r.tz}): ${dated.length} publicaciones con fecha, ${undated.length} borradores sin fecha.`;
  const lines = [head];
  if (dated.length) lines.push('', ...dated.map((p) => summarizePost(p, r.tz)));
  if (undated.length) lines.push('', 'Borradores sin fecha:', ...undated.map((p) => summarizePost(p, r.tz)));
  return out(lines.join('\n'), posts.map((p) => ({
    id: p.id, type: p.type, status: p.status, scheduled_at: p.scheduled_at, created_by: p.created_by,
    campaign: p.campaign?.name || null, caption: String(p.caption || '').slice(0, 200),
    targets: (p.targets || []).map((t) => ({ network: t.network, account: t.account_name, delivery: t.delivery, status: t.status, url: t.external_url })),
  })));
});

// --- get_free_slots
tool('get_free_slots', {
  title: 'Ver huecos libres',
  description:
    `Muestra cuántas publicaciones hay ya programadas por cuenta y día frente al límite (${FEED_MAX} de feed —post, carrusel, reel— y ${STORY_MAX} stories por cuenta y día natural). Los días que no aparecen están completamente libres. Ojo: los borradores no cuentan hasta que se aprueban, así que no sobrepases los límites al proponer varias piezas el mismo día. Úsala antes de fijar fechas en una campaña.`,
  inputSchema: {
    from: z.string().describe('Inicio, p. ej. 2026-11-03 (día local).'),
    to: z.string().describe('Fin inclusive, p. ej. 2026-11-30.'),
  },
  annotations: { readOnlyHint: true },
}, async ({ from, to }) => {
  const r = await rangeToIso(from, to);
  const [slots, accounts, me] = await Promise.all([api('GET', '/api/slots', { query: { from: r.from, to: r.to } }), api('GET', '/api/accounts'), getSettings()]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const lines = [
    `Ocupación entre ${dayKey(new Date(r.from), r.tz)} y ${dayKey(new Date(new Date(r.to).getTime() - 1), r.tz)}. Límite por cuenta y día: ${FEED_MAX} feed + ${STORY_MAX} stories. Los días no listados están libres. Horas habituales de la cola: ${(me.queue_times || []).join(', ')}.`,
  ];
  if (!slots.length) lines.push('Ningún día tiene publicaciones programadas en ese rango: todo está libre.');
  for (const s of slots) {
    const a = byId.get(s.account_id);
    const full = s.feed >= (s.feedMax || FEED_MAX) || s.story >= (s.storyMax || STORY_MAX);
    lines.push(`${s.date} · ${a ? `${NETWORK_LABEL[a.network] || a.network} ${accLabel(a)}` : `cuenta ${s.account_id}`}: feed ${s.feed}/${s.feedMax || FEED_MAX}, stories ${s.story}/${s.storyMax || STORY_MAX}${full ? ' ← LLENO' : ''}`);
  }
  return out(lines.join('\n'), slots);
});

// --- upload_media
tool('upload_media', {
  title: 'Subir archivo',
  description:
    'Sube a la biblioteca de WillyPost un archivo (imagen o vídeo) que está en el ordenador del alumno, dando su ruta absoluta (p. ej. C:\\Users\\ana\\Videos\\reel1.mp4 o /Users/ana/Fotos/foto.jpg; valen espacios y tildes). Si en vez de un archivo das la ruta de una CARPETA, sube todas las imágenes y vídeos que contiene (sin subcarpetas, máx. 30, por orden alfabético) y devuelve un media_id por archivo. Devuelve el media_id que debes usar en create_post/create_campaign. Hay que subir los medios ANTES de crear las piezas. Formatos: JPG, PNG, WebP, GIF, HEIC/AVIF/TIFF (se convierten a JPG), MP4, MOV, WebM. Las imágenes para Instagram se convierten a JPEG automáticamente.',
  inputSchema: { path: z.string().min(1).describe('Ruta absoluta de un archivo, o de una carpeta con imágenes/vídeos, en el ordenador del alumno.') },
}, async ({ path: input }) => {
  const p = resolveLocalPath(input);
  const describe = (m) => {
    const size = m.size ? `${(m.size / 1048576).toFixed(1)} MB` : '';
    return `media_id ${m.id} (${m.kind}${m.width ? `, ${m.width}x${m.height}` : ''}${m.duration ? `, ${Math.round(m.duration)} s` : ''}${size ? `, ${size}` : ''}) — ${m.original_name}`;
  };
  if (fs.statSync(p).isDirectory()) {
    const files = fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isFile() && MEDIA_EXT.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    if (!files.length) throw new UserError(`La carpeta "${p}" no tiene imágenes (jpg, png, webp, heic) ni vídeos (mp4, mov).`);
    const chosen = files.slice(0, 30);
    const done = [];
    const failed = [];
    for (const name of chosen) {
      try {
        done.push(await api('POST', '/api/media/from-path', { body: { path: path.join(p, name) }, timeout: 180000 }));
      } catch (e) {
        failed.push(`${name}: ${errorText(e)}`);
        if (e instanceof UserError) break; // WillyPost cerrado o token incorrecto: no seguimos
      }
    }
    const lines = [
      `Carpeta "${p}": ${done.length} archivos subidos${failed.length ? `, ${failed.length} con problemas` : ''}${files.length > chosen.length ? ` (había ${files.length}; se han subido los 30 primeros)` : ''}.`,
      ...done.map((m) => `- ${describe(m)}`),
    ];
    if (failed.length) lines.push('', 'Problemas:', ...failed.map((x) => `- ${x}`));
    const res = out(lines.join('\n'), done.map((m) => ({ id: m.id, kind: m.kind, name: m.original_name, width: m.width, height: m.height, size: m.size })));
    if (!done.length) res.isError = true;
    return res;
  }
  const m = await api('POST', '/api/media/from-path', { body: { path: p }, timeout: 180000 });
  return out(`Archivo subido: ${describe(m)}.`, m);
});

// --- list_media
tool('list_media', {
  title: 'Listar biblioteca de medios',
  description: 'Lista los archivos ya subidos a la biblioteca de WillyPost (más recientes primero) con su media_id, tipo, dimensiones y tamaño. Útil para reutilizar medios sin volver a subirlos.',
  inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Máximo de archivos a devolver (por defecto 50).') },
  annotations: { readOnlyHint: true },
}, async ({ limit }) => {
  const all = await api('GET', '/api/media');
  const items = all.slice(0, limit || 50);
  if (!items.length) return out('La biblioteca está vacía. Sube archivos con upload_media.', []);
  const lines = items.map((m) => `[${m.id}] ${m.kind} · ${m.original_name} · ${m.width ? `${m.width}x${m.height} · ` : ''}${m.size ? `${(m.size / 1048576).toFixed(1)} MB` : ''}`);
  return out(`${items.length} de ${all.length} archivos:\n${lines.join('\n')}`, items.map((m) => ({ id: m.id, kind: m.kind, name: m.original_name, width: m.width, height: m.height, size: m.size })));
});

// --- create_post
tool('create_post', {
  title: 'Crear publicación',
  description:
    `Crea UNA publicación (post, carrusel, reel o story) en una o varias redes. Reglas importantes: (1) sube antes los medios con upload_media; (2) scheduled_at va en la HORA LOCAL del usuario, ISO con desfase (2026-11-03T09:30:00+01:00); consulta la hora actual con willypost_status; (3) límite por cuenta y día: ${FEED_MAX} publicaciones de feed y ${STORY_MAX} stories (si lo superas, error 409; mira get_free_slots); (4) networks=["instagram","tiktok"] usa todas las cuentas conectadas de esas redes, o usa account_ids; (5) captions_by_network permite un texto nativo distinto por red (recomendado: no copies el mismo texto en todas partes); (6) si una red no admite ese tipo por API (p. ej. carrusel en TikTok, story en Threads) la pieza se crea en MODO MANUAL: a su hora saltará un aviso para que el alumno la publique a mano; (7) sin scheduled_at se guarda como borrador; con scheduled_at se programa, pero si el alumno tiene el modo "borrador" (por defecto) queda como borrador "Propuesto por Claude" con esa fecha, y debe aprobarlo en WillyPost; (8) TikTok: NO pongas privacidad, comentarios/dúos/stitch ni contenido comercial (los elige el alumno al aprobar; con modo directo la pieza queda como borrador aunque lleve fecha); YouTube: pon title y privacy (public|unlisted|private) en options_by_network.youtube o quedará como borrador. Consulta get_network_specs para formatos, longitudes y hashtags.`,
  inputSchema: { ...postItemShape, campaign: z.union([z.string(), z.number().int()]).optional().describe('Campaña a la que pertenece: nombre (se crea si no existe) o id. Para varias piezas relacionadas usa mejor create_campaign.') },
}, async (args) => {
  const accounts = await api('GET', '/api/accounts');
  const cache = {};
  const campaignId = await resolveCampaignId(args.campaign, cache);
  const tz = await getTz();
  const built = await buildPostBody(args, { accounts, campaignId });
  if (built.scheduled) await assertDayHasRoom(built.accounts, args.type, built.scheduled, tz);
  const post = await api('POST', '/api/posts', { body: built.body });
  return out(describeResult(post, built.warnings, tz), post);
});

// --- create_campaign
tool('create_campaign', {
  title: 'Crear campaña completa',
  description:
    `Crea una campaña (agrupa piezas con un color y un nombre en el calendario) y TODAS sus piezas de una vez. "posts" es una lista donde cada elemento tiene el mismo formato que create_post (type, caption, networks/account_ids, captions_by_network, media_ids, scheduled_at, notes…). Si una pieza falla (límite diario, medio inexistente, red no conectada…) NO se aborta el resto: al final recibes un resumen con las piezas creadas y las incidencias para corregirlas. Antes de crear, comprueba los límites (${FEED_MAX} feed + ${STORY_MAX} stories por cuenta y día) y descarta las piezas que los superarían. Reglas: medios subidos antes (upload_media); scheduled_at en hora local con desfase ISO; cada red con su texto nativo; distribuye las piezas por días y horas distintas. Si ya existe una campaña con ese nombre se reutiliza.`,
  inputSchema: {
    name: z.string().min(1).describe('Nombre de la campaña, p. ej. "Black Friday 2026".'),
    description: z.string().optional().describe('Objetivo y resumen de la campaña.'),
    color: z.string().optional().describe('Color hexadecimal opcional (p. ej. #5881B9).'),
    posts: z.array(z.object(postItemShape)).min(1).max(80).describe('Piezas de la campaña.'),
  },
}, async ({ name, description, color, posts }) => {
  const accounts = await api('GET', '/api/accounts');
  const tz = await getTz();

  // Campaña (reutiliza si existe).
  const campaigns = await api('GET', '/api/campaigns');
  let campaign = campaigns.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  let reused = !!campaign;
  if (campaign && (description || color)) {
    try { campaign = await api('PUT', `/api/campaigns/${campaign.id}`, { body: { description, color } }); } catch { /* no crítico */ }
  }
  if (!campaign) campaign = await api('POST', '/api/campaigns', { body: { name, description, color } });

  // Ocupación previa para no pasarnos de límite.
  const used = new Map();
  const sched = posts.map((p) => p.scheduled_at).filter((s) => s && HAS_OFFSET.test(s)).map((s) => new Date(s).getTime()).filter((n) => !Number.isNaN(n));
  if (sched.length) {
    try {
      const lo = new Date(Math.min(...sched) - 2 * 86400000).toISOString();
      const hi = new Date(Math.max(...sched) + 3 * 86400000).toISOString();
      for (const s of await api('GET', '/api/slots', { query: { from: lo, to: hi } })) {
        used.set(`${s.account_id}|${s.date}|feed`, s.feed);
        used.set(`${s.account_id}|${s.date}|story`, s.story);
      }
    } catch { /* si falla, el servidor validará al programar */ }
  }

  const results = [];
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const tag = `Pieza ${i + 1} (${p.type}${p.scheduled_at ? `, ${p.scheduled_at}` : ''})`;
    let reserved = [];
    try {
      const built = await buildPostBody(p, { accounts, campaignId: campaign.id });
      // Comprobación previa de límites (el servidor no cuenta borradores).
      if (built.scheduled) {
        const day = dayKey(new Date(built.scheduled), tz);
        const cat = p.type === 'story' ? 'story' : 'feed';
        const max = cat === 'story' ? STORY_MAX : FEED_MAX;
        const over = built.accounts.find((a) => (used.get(`${a.id}|${day}|${cat}`) || 0) + 1 > max);
        if (over) {
          throw new UserError(`Se omite: el ${day} ${accFull(over)} ya tendría más de ${max} ${cat === 'story' ? 'stories' : 'publicaciones de feed'}. Muévela a otro día (get_free_slots).`);
        }
        reserved = built.accounts.map((a) => `${a.id}|${day}|${cat}`);
        for (const k of reserved) used.set(k, (used.get(k) || 0) + 1);
      }
      const post = await api('POST', '/api/posts', { body: built.body });
      results.push({ ok: true, index: i + 1, tag, post, warnings: built.warnings });
    } catch (e) {
      for (const k of reserved) used.set(k, Math.max(0, (used.get(k) || 0) - 1)); // devolvemos el hueco reservado
      results.push({ ok: false, index: i + 1, tag, error: errorText(e) });
    }
  }

  const okList = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const lines = [
    `Campaña "${campaign.name}" (id ${campaign.id})${reused ? ' [ya existía, se reutiliza]' : ' creada'}: ${okList.length} piezas creadas, ${bad.length} con incidencias.`,
  ];
  if (okList.length) {
    lines.push('', 'Piezas creadas:');
    for (const r of okList) {
      lines.push(`- ${summarizePost(r.post, tz)}`);
      for (const w of [...r.warnings, ...((r.post.warnings || []).map((x) => (typeof x === 'string' ? x : x.message)))]) lines.push(`    Aviso: ${w}`);
    }
  }
  if (bad.length) {
    lines.push('', 'Incidencias (estas piezas NO se han creado; corrígelas y créalas con create_post usando campaign: ' + campaign.id + '):');
    for (const r of bad) lines.push(`- ${r.tag}: ${r.error}`);
  }
  const drafts = okList.filter((r) => r.post.status === 'draft').length;
  if (drafts) lines.push('', `Recuerda: ${drafts} piezas han quedado como borrador "Propuesto por Claude". El alumno debe revisarlas y aprobarlas en WillyPost (calendario o panel de pendientes) para que se programen.`);
  const manual = okList.flatMap((r) => (r.post.targets || []).filter((t) => t.delivery === 'manual'));
  if (manual.length) lines.push(`Hay ${manual.length} envíos en modo manual (la red no permite ese tipo por API o la cuenta está en modo manual): saltará un aviso para publicarlos a mano.`);
  return out(lines.join('\n'), {
    campaign: { id: campaign.id, name: campaign.name },
    created: okList.map((r) => ({ id: r.post.id, type: r.post.type, status: r.post.status, scheduled_at: r.post.scheduled_at })),
    failed: bad.map((r) => ({ piece: r.index, error: r.error })),
  });
});

// --- update_post
tool('update_post', {
  title: 'Modificar publicación',
  description:
    'Modifica una publicación que aún NO se ha publicado (borrador, programada, fallida o perdida). Solo envía los campos que quieras cambiar; el resto se conserva. scheduled_at en hora local con desfase ISO (o null para quitarle la fecha y dejarla como borrador). Si cambias networks/account_ids se reemplazan los destinos. Ojo: al editar, la pieza se marca como creada por Claude y, si el alumno usa el modo "borrador", volverá a quedar pendiente de aprobación.',
  inputSchema: {
    id: z.number().int().describe('ID de la publicación (ver get_calendar).'),
    type: z.enum(TYPES).optional(),
    caption: z.string().optional(),
    networks: z.array(networkEnum).optional(),
    account_ids: z.array(z.number().int()).optional(),
    captions_by_network: z.record(z.string(), z.string()).optional().describe('Texto por red; se aplica sobre los destinos actuales o los nuevos.'),
    options_by_network: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    media_ids: z.array(z.number().int()).optional().describe('Lista COMPLETA de medios (sustituye a la actual).'),
    scheduled_at: z.string().nullable().optional().describe('Nueva fecha-hora ISO con desfase, o null para quitarla.'),
    campaign: z.union([z.string(), z.number().int()]).nullable().optional().describe('Campaña (nombre o id), o null para sacarla de la campaña.'),
    notes: z.string().optional(),
  },
}, async (args) => {
  const tz = await getTz();
  const cur = await api('GET', `/api/posts/${args.id}`);
  if (['published', 'publishing', 'partial'].includes(cur.status)) {
    throw new UserError(`La publicación #${cur.id} ya está ${STATUS_LABEL[cur.status]} y no se puede modificar. Puedes crear una nueva pieza.`);
  }
  const accounts = await api('GET', '/api/accounts');
  let targets;
  let warnings = [];
  assertNoTikTokHumanChoices(args.options_by_network);
  if (args.networks?.length || args.account_ids?.length) {
    const r = resolveTargets(args, accounts);
    targets = r.targets;
    warnings = r.warnings;
  } else {
    targets = (cur.targets || []).map((t) => ({
      account_id: t.account_id,
      caption: args.captions_by_network?.[t.network] ?? t.caption_override ?? null,
      options: args.options_by_network?.[t.network] ?? t.options ?? {},
    }));
  }
  let scheduled = cur.scheduled_at;
  if (args.scheduled_at === null) scheduled = null;
  else if (args.scheduled_at) scheduled = await normalizeScheduledAt(args.scheduled_at);
  const cache = {};
  let campaignId = cur.campaign?.id ?? null;
  if (args.campaign === null) campaignId = null;
  else if (args.campaign !== undefined) campaignId = await resolveCampaignId(args.campaign, cache);
  const wasDraft = cur.status === 'draft';
  const action = scheduled && (args.scheduled_at || !wasDraft) ? 'schedule' : 'draft';
  const body = {
    type: args.type || cur.type,
    caption: args.caption !== undefined ? args.caption : cur.caption,
    media_ids: args.media_ids ? args.media_ids.map(Number) : (cur.media || []).map((m) => m.id),
    targets,
    scheduled_at: scheduled,
    action,
    campaign_id: campaignId,
    notes: args.notes !== undefined ? args.notes : cur.notes,
    created_by: 'claude',
  };
  const post = await api('PUT', `/api/posts/${cur.id}`, { body });
  return out(`Publicación #${post.id} actualizada.\n${describeResult(post, warnings, tz)}`, post);
});

// --- delete_post
tool('delete_post', {
  title: 'Eliminar publicación',
  description: 'Elimina una publicación que todavía no se ha publicado (borrador, programada, fallida…). No borra publicaciones ya publicadas en las redes. Pide confirmación al alumno antes de borrar piezas que no hayas creado tú en esta conversación.',
  inputSchema: { id: z.number().int().describe('ID de la publicación.') },
  annotations: { destructiveHint: true },
}, async ({ id }) => {
  const tz = await getTz();
  const cur = await api('GET', `/api/posts/${id}`);
  if (['published', 'partial', 'publishing'].includes(cur.status)) {
    throw new UserError(`La publicación #${id} ya está ${STATUS_LABEL[cur.status]}: no se puede eliminar desde WillyPost (bórrala directamente en la red social).`);
  }
  await api('DELETE', `/api/posts/${id}`);
  return out(`Publicación eliminada: ${summarizePost(cur, tz)}`, { ok: true, id });
});

// --- get_network_specs
tool('get_network_specs', {
  title: 'Especificaciones por red',
  description:
    'Devuelve, por red social, los formatos y tamaños de imagen y vídeo, proporciones, duraciones, longitud máxima de texto, qué tipos de pieza admite WillyPost por API (y cuáles irán a modo manual), consejos de hashtags y buenas prácticas. Consúltala antes de escribir los textos y de pedir/crear los medios. Sin parámetros devuelve todas las redes.',
  inputSchema: { network: networkEnum.optional().describe('Una red concreta (opcional).') },
  annotations: { readOnlyHint: true },
}, async ({ network }) => {
  const keys = network ? [network] : NETWORKS;
  const parts = keys.map((k) => renderSpec(SPECS[k]));
  const general = Object.entries(GENERAL_SPECS).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`).join('\n');
  const data = network ? { [network]: SPECS[network], general: GENERAL_SPECS } : { ...SPECS, general: GENERAL_SPECS };
  return out(`# Reglas generales de WillyPost\n${general}\n\n${parts.join('\n\n')}\n\n(Datos de las APIs oficiales a noviembre de 2026; los límites de las plataformas pueden cambiar.)`, data);
});

// ------------------------------------------------------------------ prompt «campana»

server.registerPrompt('campana', {
  title: 'Planificar una campaña',
  description: 'Guía a Claude para planificar y crear en WillyPost una campaña de redes sociales (calendario de contenido) a partir de un objetivo.',
  argsSchema: {
    objetivo: z.string().describe('Objetivo de la campaña (p. ej. "vender plazas del curso de SEO local de enero").'),
    redes: z.string().optional().describe('Redes a usar (p. ej. "Instagram, TikTok y LinkedIn"). Si no se indica, se proponen según las cuentas conectadas.'),
    duracion: z.string().optional().describe('Duración o fechas (p. ej. "2 semanas desde el 3 de noviembre").'),
  },
}, ({ objetivo, redes, duracion }) => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: [
        `Quiero que planifiques y crees en WillyPost una campaña de redes sociales.`,
        ``,
        `Objetivo: ${objetivo}`,
        `Redes: ${redes || '(propónmelas según las cuentas que tenga conectadas)'}`,
        `Duración / fechas: ${duracion || '(propón una duración razonable)'}`,
        ``,
        `Sigue este método:`,
        `1. Llama a willypost_status (hora local, cuentas conectadas, modo borrador/programar). Si falta alguna red o hay cuentas caducadas, dímelo.`,
        `2. Si no tienes claro el público, la oferta, el enlace/CTA, el tono o las fechas clave, pregúntamelo ANTES de seguir (máximo 4 preguntas, de golpe).`,
        `3. Llama a get_network_specs para respetar formatos y longitudes, y a get_free_slots/get_calendar para ver qué hay ya en el calendario. Recuerda: máximo 5 publicaciones de feed y 10 stories por cuenta y día.`,
        `4. Diseña un mix de contenido por red y etapa del embudo (atraer, educar, convencer, convertir): reels, carruseles, posts, stories. Un texto NATIVO por red (gancho en la primera línea, CTA clara, hashtags según la red; para Google Business Profile, ángulo de SEO local con servicio + zona y sin hashtags).`,
        `5. Si tengo archivos (fotos/vídeos), pídeme las rutas y súbelos con upload_media antes de crear nada. Si faltan medios para alguna pieza, dímelo y dime qué grabar o diseñar.`,
        `6. Muéstrame el plan en una tabla (fecha y hora local, red, tipo, tema/gancho, medio necesario) y espera mi OK antes de crear.`,
        `7. Con mi OK, crea todo con create_campaign (horas en hora local con desfase ISO). Revisa las incidencias que devuelva y corrígelas con create_post.`,
        `8. Termina con una tabla resumen y recuérdame que las piezas llegan como borrador "Propuesto por Claude" y que debo aprobarlas en WillyPost (salvo que tenga activada la programación directa), y que el ordenador debe estar encendido a la hora de publicar.`,
      ].join('\n'),
    },
  }],
}));

// ------------------------------------------------------------------ arranque

process.on('unhandledRejection', (e) => console.error('[willypost-mcp] unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('[willypost-mcp] uncaughtException:', e));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[willypost-mcp] listo · API ${BASE} · token ${TOKEN ? 'configurado' : 'NO configurado'}`);
