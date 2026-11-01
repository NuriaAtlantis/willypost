import { all } from './db.js';
import { FEED_DAILY_MAX, STORY_DAILY_MAX } from './config.js';

// Los días se cuentan en la hora local del ordenador del alumno.
export function localDayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayBounds(iso) {
  const d = new Date(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

export const categoryOf = (type) => (type === 'story' ? 'story' : 'feed');
export const maxFor = (cat) => (cat === 'story' ? STORY_DAILY_MAX : FEED_DAILY_MAX);

// Publicaciones que "ocupan" hueco: todo lo que no sea borrador, fallido u omitido.
const COUNTED = `p.status NOT IN ('draft', 'failed') AND t.status NOT IN ('skipped', 'failed')`;

/** Cuántas publicaciones de esa categoría hay ese día para la cuenta (excluyendo un post). */
export function countForDay(accountId, iso, category, excludePostId = null) {
  const [from, to] = dayBounds(iso);
  const typeCond = category === 'story' ? `p.type = 'story'` : `p.type <> 'story'`;
  const rows = all(
    `SELECT COUNT(*) AS n FROM post_targets t JOIN posts p ON p.id = t.post_id
     WHERE t.account_id = ? AND p.scheduled_at >= ? AND p.scheduled_at < ? AND ${typeCond} AND ${COUNTED}
       AND p.id <> ?`,
    accountId, from, to, excludePostId ?? -1,
  );
  return rows[0].n;
}

/** Devuelve [] si cabe, o una lista de cuentas que superarían el límite. */
export function checkLimits({ accounts, type, scheduledAt, excludePostId }) {
  const cat = categoryOf(type);
  const max = maxFor(cat);
  const problems = [];
  for (const acc of accounts) {
    const n = countForDay(acc.id, scheduledAt, cat, excludePostId);
    if (n + 1 > max) problems.push({ account_id: acc.id, network: acc.network, name: acc.name, count: n, max });
  }
  return problems;
}

/** Recuento por día y cuenta entre dos fechas. */
export function slots(userId, fromIso, toIso) {
  const rows = all(
    `SELECT t.account_id, p.scheduled_at, p.type FROM post_targets t
     JOIN posts p ON p.id = t.post_id
     WHERE p.user_id = ? AND p.scheduled_at >= ? AND p.scheduled_at < ? AND ${COUNTED}`,
    userId, fromIso, toIso,
  );
  const map = new Map();
  for (const r of rows) {
    const date = localDayKey(r.scheduled_at);
    const key = `${date}|${r.account_id}`;
    if (!map.has(key)) map.set(key, { date, account_id: r.account_id, feed: 0, story: 0, feedMax: FEED_DAILY_MAX, storyMax: STORY_DAILY_MAX });
    map.get(key)[categoryOf(r.type)]++;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.account_id - b.account_id);
}

/** Siguiente hueco de la cola (horas queue_times) libre en todas las cuentas indicadas. */
export function nextQueueSlot({ accounts, type, queueTimes, after = new Date() }) {
  const times = (queueTimes?.length ? queueTimes : ['09:00']).slice().sort();
  const minStart = new Date(after.getTime() + 5 * 60 * 1000);
  for (let dayOffset = 0; dayOffset < 120; dayOffset++) {
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + dayOffset, h, m || 0, 0, 0);
      if (d < minStart) continue;
      const iso = d.toISOString();
      // Evita dos publicaciones a la misma hora en la misma cuenta.
      const busy = accounts.some((a) =>
        all(
          `SELECT 1 FROM post_targets t JOIN posts p ON p.id = t.post_id
           WHERE t.account_id = ? AND p.scheduled_at = ? AND ${COUNTED} LIMIT 1`, a.id, iso,
        ).length,
      );
      if (busy) continue;
      if (checkLimits({ accounts, type, scheduledAt: iso }).length) continue;
      return iso;
    }
  }
  return null;
}
