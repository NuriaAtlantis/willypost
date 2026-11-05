// Segunda revisión del programador: carreras entre la cola de una cuenta y el alumno (atrasadas, borradores),
// respuestas tardías de una red tras el tiempo máximo y mensajes cuando se agotan los reintentos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'Europe/Madrid';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rev-s-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_NO_DESKTOP_NOTIFY = '1';
process.env.WILLYPOST_PUBLISH_TIMEOUT_MS = '300';

const { run, get, all, db } = await import('../server/db.js');
const { savePost } = await import('../server/posts.js');
const sched = await import('../server/scheduler.js');
const accounts = await import('../server/accounts.js');
const { providers } = await import('../server/providers/index.js');
const { ProviderError } = await import('../server/providers/_http.js');

const bsky = providers.bluesky;
const original = { publish: bsky.publish, refresh: bsky.refresh };
let user;
let accA;

before(() => {
  const ts = new Date().toISOString();
  const r = run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', 'rev@test.com', 'R', 'x', ts);
  user = get('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
  run(
    `INSERT INTO accounts (user_id, network, external_id, name, username, access_token, refresh_token, meta, mode, connected_at, created_at)
     VALUES (?, 'bluesky', 'did:rev', 'Cuenta', 'rev.bsky.social', 'tok', 'ref0', '{}', 'api', ?, ?)`,
    user.id, ts, ts,
  );
  accA = get('SELECT * FROM accounts WHERE user_id = ?', user.id);
});

after(() => {
  bsky.publish = original.publish;
  bsky.refresh = original.refresh;
  sched.stopScheduler();
  try { db.close(); } catch { /* */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

function duePost(caption, agoMin = 1) {
  const { post } = savePost(user, {
    type: 'post', caption, targets: [{ account_id: accA.id }],
    scheduled_at: new Date(Date.now() + 3600e3).toISOString(), action: 'schedule',
  });
  run('UPDATE posts SET scheduled_at = ? WHERE id = ?', new Date(Date.now() - agoMin * 60000).toISOString(), post.id);
  return post.id;
}
const targetOf = (postId) => get('SELECT * FROM post_targets WHERE post_id = ?', postId);
const postStatus = (postId) => get('SELECT status FROM posts WHERE id = ?', postId).status;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('un envío que esperaba en la cola de su cuenta NO sale si su publicación pasó a "missed" o a borrador', async () => {
  run('DELETE FROM posts');
  const published = [];
  bsky.publish = async ({ caption }) => {
    published.push(caption);
    await wait(150); // la primera tarda: las demás esperan en la cola de la cuenta
    return { external_id: caption };
  };
  const first = duePost('primera');
  const missed = duePost('atrasada');
  const draft = duePost('vuelve a borrador');
  const done = sched.tick();
  // Mientras la primera se publica, el alumno ve la segunda como atrasada y convierte la tercera en borrador
  // ("Omitir" de una atrasada la deja como borrador sin fecha).
  await wait(30);
  run(`UPDATE posts SET status = 'missed' WHERE id = ?`, missed);
  run(`UPDATE posts SET status = 'draft', scheduled_at = NULL WHERE id = ?`, draft);
  await done;
  assert.deepEqual(published, ['primera'], 'solo sale la que seguía en marcha');
  assert.equal(postStatus(first), 'published');
  assert.equal(postStatus(missed), 'missed');
  assert.equal(targetOf(missed).status, 'pending');
  assert.equal(postStatus(draft), 'draft');
  assert.equal(targetOf(draft).status, 'pending');
});

test('un envío de una publicación reprogramada al futuro no se adelanta aunque estuviera en la cola', async () => {
  run('DELETE FROM posts');
  const published = [];
  bsky.publish = async ({ caption }) => { published.push(caption); await wait(100); return {}; };
  duePost('ya');
  const later = duePost('luego');
  const done = sched.tick();
  await wait(20);
  run('UPDATE posts SET scheduled_at = ? WHERE id = ?', new Date(Date.now() + 2 * 3600e3).toISOString(), later);
  await done;
  assert.deepEqual(published, ['ya']);
  assert.equal(targetOf(later).status, 'pending');
});

test('la red contesta DESPUÉS del tiempo máximo: no se duplica y el envío acaba como publicado', async () => {
  run('DELETE FROM posts');
  let calls = 0;
  bsky.publish = async () => { calls++; await wait(600); return { external_id: 'tarde', url: 'https://bsky.app/tarde' }; };
  const id = duePost('lenta');
  await sched.tick();
  let t = targetOf(id);
  assert.equal(t.status, 'failed');
  assert.match(t.error, /no ha respondido/);
  assert.equal(sched.isLingering(t.id), true, 'seguimos esperando la respuesta tardía');
  // Aunque se vuelva a poner en marcha (p. ej. "Publicar ahora"), no se publica otra vez mientras tanto.
  run(`UPDATE post_targets SET status = 'pending', attempts = 0 WHERE id = ?`, t.id);
  run(`UPDATE posts SET status = 'scheduled' WHERE id = ?`, id);
  await sched.tick();
  await sched.publishTarget(t.id);
  assert.equal(calls, 1, 'una sola petición a la red');
  await wait(500);
  t = targetOf(id);
  assert.equal(t.status, 'published');
  assert.equal(t.external_id, 'tarde');
  assert.match(t.warning, /contestó tarde/);
  assert.equal(postStatus(id), 'published');
  assert.equal(sched.isLingering(t.id), false);
  assert.ok(get(`SELECT 1 AS x FROM notifications WHERE title LIKE '%con retraso%'`));
  await sched.tick();
  assert.equal(calls, 1);
});

test('la red contesta tarde con un error: el envío sigue fallido y se puede reintentar', async () => {
  run('DELETE FROM posts');
  bsky.publish = async () => { await wait(500); throw new ProviderError('Rechazado.'); };
  const id = duePost('falla tarde');
  await sched.tick();
  const t = targetOf(id);
  assert.equal(t.status, 'failed');
  assert.equal(sched.isLingering(t.id), true);
  await wait(400);
  assert.equal(sched.isLingering(t.id), false);
  assert.equal(targetOf(id).status, 'failed');
});

test('se agotan los reintentos: el mensaje final ya no promete "lo reintentaremos"', async () => {
  run('DELETE FROM posts');
  bsky.publish = async () => { throw new ProviderError('Bluesky está teniendo problemas ahora mismo (error 503). Lo reintentaremos en unos minutos.', { retryable: true }); };
  const id = duePost('caída');
  for (let i = 0; i < 4; i++) {
    await sched.tick();
    run('UPDATE post_targets SET next_attempt_at = ? WHERE post_id = ?', new Date(Date.now() - 1000).toISOString(), id);
  }
  const t = targetOf(id);
  assert.equal(t.status, 'failed');
  assert.doesNotMatch(t.error, /reintentaremos|volveremos a intentar/i);
  assert.match(t.error, /error 503\)\. Lo hemos intentado 4 veces sin éxito: cuando se solucione, pulsa Reintentar\./);
  assert.equal(
    sched.withoutRetryPromise('No hay conexión con Bluesky. Revisa tu internet: lo volveremos a intentar.'),
    'No hay conexión con Bluesky. Revisa tu internet.',
  );
  assert.equal(sched.withoutRetryPromise('El túnel de Cloudflare no arrancó a tiempo. Lo reintentaremos.'), 'El túnel de Cloudflare no arrancó a tiempo.');
});

test('renovación del token: dos renovaciones a la vez de la misma cuenta hacen UNA sola petición', async () => {
  let calls = 0;
  bsky.refresh = async ({ account }) => {
    calls++;
    await wait(80);
    // Las redes que rotan el refresh_token invalidan el anterior: una segunda petición con él fallaría.
    if (account.refresh_token !== 'ref0') throw new ProviderError('refresh_token ya usado', { auth: true });
    return { access_token: 'nuevo', refresh_token: 'ref1', token_expires_at: new Date(Date.now() + 86400e3).toISOString() };
  };
  run('UPDATE accounts SET refresh_token = ?, token_expires_at = ? WHERE id = ?', 'ref0', new Date(Date.now() + 60e3).toISOString(), accA.id);
  const acc = get('SELECT * FROM accounts WHERE id = ?', accA.id);
  const [a, b] = await Promise.all([
    accounts.ensureFreshToken(acc),
    accounts.ensureFreshToken(acc, { force: true }),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.access_token, 'nuevo');
  assert.equal(b.access_token, 'nuevo');
  assert.equal(get('SELECT refresh_token FROM accounts WHERE id = ?', accA.id).refresh_token, 'ref1');
  // Con una fila "vieja" en memoria (refresh_token ya rotado) se usa el guardado, no el caducado.
  calls = 0;
  bsky.refresh = async ({ account }) => {
    calls++;
    if (account.refresh_token !== 'ref1') throw new ProviderError('refresh_token ya usado', { auth: true });
    return { access_token: 'otro', refresh_token: 'ref2' };
  };
  const fresh = await accounts.ensureFreshToken(acc, { force: true });
  assert.equal(calls, 1);
  assert.equal(fresh.access_token, 'otro');
  bsky.refresh = original.refresh;
  run('UPDATE accounts SET token_expires_at = NULL WHERE id = ?', accA.id);
});

test('mantenimiento (cada hora): el aviso de "reconecta" sale UNA vez al día, no cada hora', async () => {
  run(`DELETE FROM notifications`);
  run(`DELETE FROM settings WHERE key LIKE 'warned%'`);
  // Conectada hace 26 días: le quedan 4 (aviso de "a punto de caducar").
  run('UPDATE accounts SET connected_at = ?, token_expires_at = NULL, last_error = NULL WHERE id = ?', new Date(Date.now() - 26 * 86400e3).toISOString(), accA.id);
  // Un aviso de ayer, que sí se debe limpiar.
  const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  run('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)', user.id, `warned_${accA.id}_${yesterday}`, '1');
  await sched.maintenance();
  await sched.maintenance();
  await sched.maintenance();
  const n = get(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'reconnect'`).n;
  assert.equal(n, 1);
  assert.equal(get(`SELECT COUNT(*) AS n FROM settings WHERE key = ?`, `warned_${accA.id}_${yesterday}`).n, 0);
  run('UPDATE accounts SET connected_at = ? WHERE id = ?', new Date().toISOString(), accA.id);
});

test('Claude edita una publicación ya programada (modo borrador): vuelve a borrador Y el alumno recibe un aviso en WillyPost', () => {
  run('DELETE FROM posts');
  run('DELETE FROM notifications');
  const when = new Date(Date.now() + 2 * 86400e3).toISOString();
  const { post } = savePost(user, { type: 'post', caption: 'Bautismo', targets: [{ account_id: accA.id }], scheduled_at: when, action: 'schedule' });
  assert.equal(post.status, 'scheduled');
  const r = savePost(user, { type: 'post', caption: 'Bautismo (texto mejorado)', targets: [{ account_id: accA.id }], scheduled_at: when, action: 'schedule', created_by: 'claude' }, post.id);
  assert.equal(r.post.status, 'draft');
  const n = get(`SELECT * FROM notifications WHERE post_id = ?`, post.id);
  assert.ok(n, 'hay aviso');
  assert.match(n.title, /Claude ha cambiado una publicación programada/);
  assert.match(n.body, /apruébala/);
  // Si la edita el propio alumno no hay aviso.
  run('DELETE FROM notifications');
  savePost(user, { type: 'post', caption: 'otra', targets: [{ account_id: accA.id }], scheduled_at: when, action: 'schedule' }, post.id);
  assert.equal(get('SELECT COUNT(*) AS n FROM notifications').n, 0);
});

test('la red dice que SÍ pero falla algo nuestro después (p. ej. guardar el aviso): el envío queda PUBLICADO, no fallido', async () => {
  run('DELETE FROM posts');
  let calls = 0;
  bsky.publish = async () => { calls++; return { external_id: 'ok-1', url: 'https://bsky.app/ok-1' }; };
  const id = duePost('aviso roto');
  db.exec('ALTER TABLE notifications RENAME TO notifications_rota');
  try {
    await sched.tick();
  } finally {
    db.exec('ALTER TABLE notifications_rota RENAME TO notifications');
  }
  const t = targetOf(id);
  assert.equal(t.status, 'published', t.error || '');
  assert.equal(t.external_id, 'ok-1');
  assert.equal(postStatus(id), 'published');
  await sched.tick();
  assert.equal(calls, 1, 'no se repite');
});
