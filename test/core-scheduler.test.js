// Programador y límites "por dentro" (sin servidor HTTP): publicaciones colgadas, reintentos,
// cierres a mitad de publicación, ordenador dormido, cambio de hora y límites diarios.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'Europe/Madrid';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-core-s-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_NO_DESKTOP_NOTIFY = '1';
process.env.WILLYPOST_PUBLISH_TIMEOUT_MS = '400';

const { run, get, all, db } = await import('../server/db.js');
const { savePost } = await import('../server/posts.js');
const sched = await import('../server/scheduler.js');
const { providers } = await import('../server/providers/index.js');
const { checkLimits, countForDay, slots, nextQueueSlot } = await import('../server/limits.js');
const { ProviderError } = await import('../server/providers/_http.js');

const bsky = providers.bluesky;
const original = { publish: bsky.publish, refresh: bsky.refresh };
let user;
let accA;
let accB;

before(() => {
  const ts = new Date().toISOString();
  const r = run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', 'sched@test.com', 'S', 'x', ts);
  user = get('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
  for (const ext of ['a', 'b']) {
    run(
      `INSERT INTO accounts (user_id, network, external_id, name, username, access_token, meta, mode, connected_at, created_at)
       VALUES (?, 'bluesky', ?, ?, ?, 'tok', '{}', 'api', ?, ?)`,
      user.id, `did:${ext}`, `Cuenta ${ext}`, `${ext}.bsky.social`, ts, ts,
    );
  }
  [accA, accB] = all('SELECT * FROM accounts WHERE user_id = ? ORDER BY id', user.id);
});

after(() => {
  bsky.publish = original.publish;
  bsky.refresh = original.refresh;
  sched.stopScheduler();
  try { db.close(); } catch { /* */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

/** Crea una publicación de texto para ya (scheduled_at un poco en el pasado). */
function duePost(accounts, caption = 'hola', agoMin = 1) {
  const { post } = savePost(user, {
    type: 'post', caption, targets: accounts.map((a) => ({ account_id: a.id })),
    scheduled_at: new Date(Date.now() + 3600e3).toISOString(), action: 'schedule',
  });
  run('UPDATE posts SET scheduled_at = ? WHERE id = ?', new Date(Date.now() - agoMin * 60000).toISOString(), post.id);
  return post.id;
}
const targetsOf = (postId) => all('SELECT * FROM post_targets WHERE post_id = ? ORDER BY id', postId);
const postStatus = (postId) => get('SELECT status FROM posts WHERE id = ?', postId).status;
const clearAll = () => run('DELETE FROM posts');

test('publica una vez y marca publicado', async () => {
  clearAll();
  let calls = 0;
  bsky.publish = async () => { calls++; return { external_id: 'x1', url: 'https://bsky.app/x1' }; };
  const id = duePost([accA]);
  await sched.tick();
  assert.equal(calls, 1);
  assert.equal(targetsOf(id)[0].status, 'published');
  assert.equal(postStatus(id), 'published');
  // Un segundo ciclo no la vuelve a publicar.
  await sched.tick();
  assert.equal(calls, 1);
});

test('dos ciclos a la vez no publican dos veces', async () => {
  clearAll();
  let calls = 0;
  bsky.publish = async () => { calls++; await new Promise((r) => setTimeout(r, 100)); return { external_id: 'x' }; };
  const id = duePost([accA]);
  const t = targetsOf(id)[0].id;
  await Promise.all([sched.tick(), sched.tick(), sched.publishTarget(t), sched.publishTarget(t)]);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(calls, 1);
  assert.equal(postStatus(id), 'published');
});

test('una red que no responde no bloquea el programador: falla con mensaje claro', async () => {
  clearAll();
  bsky.publish = async ({ account }) => {
    if (account.external_id === 'did:a') return new Promise(() => {}); // colgada para siempre
    return { external_id: 'ok' };
  };
  const id = duePost([accA, accB]);
  const start = Date.now();
  await sched.tick();
  assert.ok(Date.now() - start < 3000, 'el ciclo debe terminar');
  const [ta, tb] = targetsOf(id);
  assert.equal(tb.status, 'published');
  assert.equal(ta.status, 'failed');
  assert.match(ta.error, /no ha respondido/);
  assert.equal(postStatus(id), 'partial');
  // El siguiente ciclo sigue funcionando.
  bsky.publish = async () => ({ external_id: 'ok2' });
  const id2 = duePost([accA]);
  await sched.tick();
  assert.equal(postStatus(id2), 'published');
});

test('reintentos: 1 intento + 3 reintentos (1, 5 y 15 min) y luego fallido', async () => {
  clearAll();
  let calls = 0;
  bsky.publish = async () => { calls++; throw new ProviderError('Bluesky está saturado.', { retryable: true }); };
  const id = duePost([accA]);
  const delays = [];
  for (let i = 0; i < 4; i++) {
    await sched.tick();
    const t = targetsOf(id)[0];
    if (t.next_attempt_at) {
      delays.push(Math.round((new Date(t.next_attempt_at).getTime() - Date.now()) / 60000));
      run('UPDATE post_targets SET next_attempt_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), t.id);
    }
  }
  const t = targetsOf(id)[0];
  assert.equal(calls, 4);
  assert.deepEqual(delays, [1, 5, 15]);
  assert.equal(t.status, 'failed');
  assert.equal(t.attempts, 4);
  assert.equal(postStatus(id), 'failed');
  // El límite diario no cuenta las fallidas.
  assert.equal(countForDay(accA.id, new Date().toISOString(), 'feed'), 0);
});

test('sin internet (no llega a conectar) se reintenta con mensaje en español', async () => {
  clearAll();
  bsky.publish = async () => {
    const e = new TypeError('fetch failed');
    e.cause = { code: 'ENOTFOUND' };
    throw e;
  };
  const id = duePost([accA]);
  await sched.tick();
  const t = targetsOf(id)[0];
  assert.equal(t.status, 'pending');
  assert.ok(t.next_attempt_at);
  assert.match(t.error, /No hay conexión con Bluesky/);
});

test('errores inesperados y de autenticación', async () => {
  clearAll();
  bsky.publish = async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); };
  let id = duePost([accA]);
  await sched.tick();
  let t = targetsOf(id)[0];
  assert.equal(t.status, 'failed');
  assert.match(t.error, /Error inesperado al publicar en Bluesky/);

  bsky.publish = async () => { throw new ProviderError('La sesión ha caducado.', { auth: true }); };
  id = duePost([accA]);
  await sched.tick();
  t = targetsOf(id)[0];
  assert.equal(t.status, 'failed');
  assert.match(t.error, /Reconecta Bluesky/);
  assert.ok(get('SELECT last_error FROM accounts WHERE id = ?', accA.id).last_error);
  // Al publicar bien se limpia el error de la cuenta.
  bsky.publish = async () => ({ external_id: 'ok' });
  id = duePost([accA]);
  await sched.tick();
  assert.equal(get('SELECT last_error FROM accounts WHERE id = ?', accA.id).last_error, null);
});

test('la red pide hacerlo a mano → pasa a "Para publicar a mano"', async () => {
  clearAll();
  bsky.publish = async () => { const e = new ProviderError('Story no admitida.'); e.manual = true; throw e; };
  const id = duePost([accA]);
  await sched.tick();
  const t = targetsOf(id)[0];
  assert.equal(t.status, 'manual_pending');
  assert.equal(t.delivery, 'manual');
  assert.equal(postStatus(id), 'manual');
});

test('cuenta caducada (30 días): no publica y pide reconectar', async () => {
  clearAll();
  let calls = 0;
  bsky.publish = async () => { calls++; return {}; };
  const old = new Date(Date.now() - 31 * 86400000).toISOString();
  run('UPDATE accounts SET connected_at = ? WHERE id = ?', old, accB.id);
  const id = duePost([accB]);
  await sched.tick();
  assert.equal(calls, 0);
  const t = targetsOf(id)[0];
  assert.equal(t.status, 'failed');
  assert.match(t.error, /caducado \(30 días\)/);
  run('UPDATE accounts SET connected_at = ? WHERE id = ?', new Date().toISOString(), accB.id);
});

test('WillyPost se cerró a mitad de publicación: no se queda "publicando" para siempre ni se duplica', async () => {
  clearAll();
  let calls = 0;
  bsky.publish = async () => { calls++; return {}; };
  const id = duePost([accA, accB]);
  const [ta, tb] = targetsOf(id);
  // Simula el estado que deja un cierre brusco.
  run(`UPDATE post_targets SET status = 'publishing', attempts = 1 WHERE id = ?`, ta.id);
  run(`UPDATE post_targets SET status = 'published' WHERE id = ?`, tb.id);
  run(`UPDATE posts SET status = 'publishing' WHERE id = ?`, id);
  assert.equal(sched.recoverInterrupted(), 1);
  const after = targetsOf(id);
  assert.equal(after[0].status, 'failed');
  assert.match(after[0].error, /se cerró mientras publicaba en Bluesky/);
  assert.equal(postStatus(id), 'partial');
  await sched.tick();
  assert.equal(calls, 0, 'no se repite sola');
  // Un post "publishing" sin envíos en marcha vuelve a "scheduled".
  const id2 = duePost([accA]);
  run(`UPDATE posts SET status = 'publishing', scheduled_at = ? WHERE id = ?`, new Date(Date.now() + 3600e3).toISOString(), id2);
  sched.recoverInterrupted();
  assert.equal(postStatus(id2), 'scheduled');
});

test('ordenador dormido: al despertar, lo muy atrasado pasa a "missed" y lo reciente se publica', async () => {
  clearAll();
  const published = [];
  bsky.publish = async ({ caption }) => { published.push(caption); return {}; };
  const late = duePost([accA], 'muy tarde', 120);
  const recent = duePost([accB], 'reciente', 3);
  sched.setLastBeat(Date.now() - 3 * 3600e3); // último latido hace 3 horas
  await sched.heartbeat(Date.now());
  assert.equal(postStatus(late), 'missed');
  assert.equal(postStatus(recent), 'published');
  assert.deepEqual(published, ['reciente']);
  assert.ok(get(`SELECT 1 AS x FROM notifications WHERE kind = 'missed'`));
  // Un reintento que tocaba mientras el ordenador estaba apagado también se pregunta.
  const retrying = duePost([accA], 'reintento', 180);
  run(`UPDATE post_targets SET attempts = 1, next_attempt_at = ? WHERE post_id = ?`, new Date(Date.now() - 170 * 60000).toISOString(), retrying);
  assert.equal(sched.detectMissed(), 1);
  assert.equal(postStatus(retrying), 'missed');
  // Sin salto de reloj no se marca nada (aunque vaya con algo de retraso).
  const late2 = duePost([accA], 'tarde sin dormir', 30);
  run('UPDATE post_targets SET next_attempt_at = ? WHERE post_id = ?', new Date(Date.now() + 3600e3).toISOString(), late2);
  sched.heartbeat(Date.now());
  assert.equal(postStatus(late2), 'scheduled');
});

test('mantenimiento: sin internet no marca la cuenta con error; si la red rechaza el token, sí', async () => {
  const soon = new Date(Date.now() + 86400000).toISOString();
  run('UPDATE accounts SET token_expires_at = ?, last_error = NULL WHERE id = ?', soon, accA.id);
  bsky.refresh = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  await sched.maintenance();
  assert.equal(get('SELECT last_error FROM accounts WHERE id = ?', accA.id).last_error, null);
  bsky.refresh = async () => { throw new ProviderError('Token revocado.', { auth: true }); };
  await sched.maintenance();
  assert.equal(get('SELECT last_error FROM accounts WHERE id = ?', accA.id).last_error, 'Token revocado.');
  run('UPDATE accounts SET token_expires_at = NULL, last_error = NULL WHERE id = ?', accA.id);
  bsky.refresh = original.refresh;
});

// ---------- Límites y zona horaria ----------
function insertAt(acc, iso, type = 'post', status = 'scheduled', tStatus = 'pending') {
  const ts = new Date().toISOString();
  const r = run(
    'INSERT INTO posts (user_id, type, caption, status, scheduled_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    user.id, type, 'x', status, iso, ts, ts,
  );
  const id = Number(r.lastInsertRowid);
  run('INSERT INTO post_targets (post_id, account_id, status, updated_at) VALUES (?, ?, ?, ?)', id, acc.id, tStatus, ts);
  return id;
}

test('cambio de hora (Europa/Madrid, 25-oct-2026): el día local se cuenta bien', () => {
  clearAll();
  // 00:30 hora local del 25 (aún UTC+2) y 23:30 hora local del 25 (ya UTC+1): mismo día.
  insertAt(accA, '2026-10-24T22:30:00.000Z');
  insertAt(accA, '2026-10-25T22:30:00.000Z');
  // 23:30 del 24 en hora local: otro día.
  insertAt(accA, '2026-10-24T21:30:00.000Z');
  assert.equal(countForDay(accA.id, '2026-10-25T10:00:00.000Z', 'feed'), 2);
  assert.equal(countForDay(accA.id, '2026-10-24T10:00:00.000Z', 'feed'), 1);
  const s = slots(user.id, '2026-10-20T00:00:00.000Z', '2026-10-30T00:00:00.000Z');
  assert.deepEqual(s.map((x) => [x.date, x.feed]), [['2026-10-24', 1], ['2026-10-25', 2]]);
});

test('límites: borradores, fallidos y omitidos no cuentan; stories aparte; 5 sí y 6 no', () => {
  clearAll();
  const day = '2026-12-01T09:00:00.000Z';
  const at = (h) => `2026-12-01T${String(h).padStart(2, '0')}:00:00.000Z`;
  for (let i = 0; i < 4; i++) insertAt(accA, at(8 + i));
  insertAt(accA, at(13), 'post', 'draft');
  insertAt(accA, at(14), 'post', 'failed', 'failed');
  insertAt(accA, at(15), 'post', 'partial', 'skipped');
  for (let i = 0; i < 9; i++) insertAt(accA, at(8 + i), 'story');
  assert.equal(checkLimits({ accounts: [accA], type: 'post', scheduledAt: day }).length, 0, 'el 5º cabe');
  assert.equal(checkLimits({ accounts: [accA], type: 'story', scheduledAt: day }).length, 0, 'la 10ª story cabe');
  insertAt(accA, at(16));
  insertAt(accA, at(17), 'story');
  const p = checkLimits({ accounts: [accA, accB], type: 'post', scheduledAt: day });
  assert.equal(p.length, 1, 'el 6º no cabe en A, sí en B');
  assert.equal(p[0].account_id, accA.id);
  assert.equal(p[0].count, 5);
  assert.equal(checkLimits({ accounts: [accA], type: 'story', scheduledAt: day }).length, 1, 'la 11ª story no cabe');
  // Mover una de ese mismo día no cuenta dos veces.
  const own = get(`SELECT p.id FROM posts p WHERE p.type = 'post' AND p.status = 'scheduled' LIMIT 1`).id;
  assert.equal(checkLimits({ accounts: [accA], type: 'post', scheduledAt: day, excludePostId: own }).length, 0);
});

test('Canarias y Latinoamérica: el día es el del reloj del ordenador', () => {
  clearAll();
  process.env.TZ = 'Atlantic/Canary';
  insertAt(accA, '2026-12-01T23:30:00.000Z'); // 23:30 del 1 en Canarias (UTC+0)
  assert.equal(countForDay(accA.id, '2026-12-01T12:00:00.000Z', 'feed'), 1);
  process.env.TZ = 'America/Mexico_City';
  // En México (UTC-6) esas 23:30Z son las 17:30 del día 1: mismo día; las 05:00Z del día 2 aún son día 1.
  insertAt(accA, '2026-12-02T05:00:00.000Z');
  assert.equal(countForDay(accA.id, '2026-12-01T18:00:00.000Z', 'feed'), 2);
  process.env.TZ = 'Europe/Madrid';
});

test('cola: salta los días llenos', () => {
  clearAll();
  const after = new Date(2027, 0, 10, 6, 0); // 10-ene-2027 06:00 local
  for (let i = 0; i < 5; i++) insertAt(accA, new Date(2027, 0, 10, 8 + i).toISOString());
  const iso = nextQueueSlot({ accounts: [accA], type: 'post', queueTimes: ['09:00'], after });
  const d = new Date(iso);
  assert.equal(d.getDate(), 11);
  assert.equal(d.getHours(), 9);
});
