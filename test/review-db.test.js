// Actualizar WillyPost sobre una base de datos de una instalación antigua: nunca se pierden datos, no revienta
// al arrancar, se hace copia de seguridad y se puede repetir las veces que haga falta.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.TZ = 'Europe/Madrid';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rev-db-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_DB = path.join(dataDir, 'actual.db');

const { migrate, db } = await import('../server/db.js');

const opened = [];
after(() => {
  for (const d of opened) try { d.close(); } catch { /* */ }
  try { db.close(); } catch { /* */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

function openDb(name) {
  const file = path.join(dataDir, name);
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  opened.push(d);
  return { d, file };
}
const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (d) => d.prepare('PRAGMA user_version').get().user_version;
const backupsOf = (file) => fs.readdirSync(dataDir).filter((f) => f.startsWith(`${path.basename(file)}.copia-`));

test('instalación muy antigua (tablas sin número de versión y sin columnas nuevas): se completa sin perder nada', () => {
  const { d, file } = openDb('antigua.db');
  // Esquema "antiguo": sin user_version, sin warning/next_attempt_at, sin duration y sin tablas de snippets/notificaciones.
  d.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, recovery_hash TEXT, created_at TEXT NOT NULL);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      network TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT, access_token TEXT, mode TEXT NOT NULL DEFAULT 'api',
      connected_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (user_id, network, external_id));
    CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, filename TEXT NOT NULL, original_name TEXT,
      mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER, width INTEGER, height INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE post_targets (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL, delivery TEXT NOT NULL DEFAULT 'api', status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users (email, name, password_hash, created_at) VALUES ('nuria@example.com', 'Nuria', 'scrypt$a$b', '2026-01-01T00:00:00.000Z');
    INSERT INTO accounts (user_id, network, external_id, name, access_token, connected_at, created_at)
      VALUES (1, 'instagram', '178', 'Atlantis', 'tok', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');
    INSERT INTO media (user_id, filename, mime, kind, created_at) VALUES (1, 'a.jpg', 'image/jpeg', 'image', '2026-10-20T00:00:00.000Z');
    INSERT INTO posts (user_id, type, caption, status, created_at, updated_at) VALUES (1, 'post', 'Inmersión en Lanzarote', 'scheduled', 'x', 'x');
    INSERT INTO post_targets (post_id, account_id, status) VALUES (1, 1, 'pending');
  `);
  assert.equal(version(d), 0);
  const r = migrate(d, file);
  assert.equal(version(d), 2);
  for (const c of ['warning', 'next_attempt_at', 'caption_override', 'options', 'external_id', 'updated_at']) assert.ok(cols(d, 'post_targets').includes(c), c);
  for (const c of ['scheduled_at', 'created_by', 'campaign_id', 'notes']) assert.ok(cols(d, 'posts').includes(c), c);
  assert.ok(cols(d, 'media').includes('duration'));
  assert.ok(cols(d, 'accounts').includes('refresh_token'));
  for (const t of ['snippets', 'notifications', 'sessions', 'api_tokens', 'settings', 'credentials', 'oauth_pending', 'campaigns', 'post_media']) {
    assert.ok(d.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t), t);
  }
  // Los datos siguen ahí y las columnas nuevas tienen sus valores por defecto.
  assert.equal(d.prepare('SELECT caption FROM posts WHERE id = 1').get().caption, 'Inmersión en Lanzarote');
  assert.equal(d.prepare('SELECT created_by FROM posts WHERE id = 1').get().created_by, 'user');
  assert.equal(d.prepare('SELECT email FROM users').get().email, 'nuria@example.com');
  // Copia de seguridad coherente, con los datos de antes.
  assert.ok(r.backup && fs.existsSync(r.backup));
  const copy = new DatabaseSync(r.backup);
  opened.push(copy);
  assert.equal(copy.prepare('SELECT caption FROM posts').get().caption, 'Inmersión en Lanzarote');
  assert.ok(!copy.prepare('PRAGMA table_info(post_targets)').all().some((c) => c.name === 'warning'));
  // Lo que usa el programador funciona sobre la base reparada.
  d.prepare(`UPDATE post_targets SET warning = 'x', next_attempt_at = NULL, updated_at = ? WHERE id = 1`).run(new Date().toISOString());
  d.prepare(`INSERT INTO notifications (user_id, kind, title, created_at) VALUES (1, 'info', 'hola', ?)`).run(new Date().toISOString());

  // Repetirlo no cambia nada ni hace más copias.
  const again = migrate(d, file);
  assert.deepEqual(again.repaired, []);
  assert.equal(again.backup, null);
  assert.equal(backupsOf(file).length, 1);
});

test('versión 1 (antes de la duración de vídeos) pasa a la 2; si la columna ya existía no revienta', () => {
  const { d, file } = openDb('v1.db');
  d.exec(`CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, filename TEXT NOT NULL, original_name TEXT,
    mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER, width INTEGER, height INTEGER, created_at TEXT NOT NULL);
    INSERT INTO media (user_id, filename, mime, kind, created_at) VALUES (1, 'v.mp4', 'video/mp4', 'video', 'x');
    PRAGMA user_version = 1;`);
  migrate(d, file);
  assert.equal(version(d), 2);
  assert.ok(cols(d, 'media').includes('duration'));
  assert.equal(d.prepare('SELECT filename FROM media').get().filename, 'v.mp4');

  const { d: d2, file: f2 } = openDb('v1-con-columna.db');
  d2.exec(`CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, filename TEXT NOT NULL, original_name TEXT,
    mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER, width INTEGER, height INTEGER, created_at TEXT NOT NULL, duration REAL);
    PRAGMA user_version = 1;`);
  migrate(d2, f2);
  assert.equal(version(d2), 2);
});

test('fechas guardadas en otro formato se pasan a ISO UTC (si no, el programador compararía mal la hora)', () => {
  const { d, file } = openDb('fechas.db');
  migrate(d, file);
  d.exec(`INSERT INTO users (email, name, password_hash, created_at) VALUES ('a@b.es', 'A', 'x', 'x');
    INSERT INTO posts (user_id, type, status, scheduled_at, created_at, updated_at) VALUES
      (1, 'post', 'scheduled', '2026-11-03T09:30', 'x', 'x'),
      (1, 'post', 'scheduled', '2026-11-03T09:30:00+00:00', 'x', 'x'),
      (1, 'post', 'scheduled', '2026-11-03T09:30:00.000Z', 'x', 'x'),
      (1, 'post', 'draft', NULL, 'x', 'x'),
      (1, 'post', 'draft', 'basura', 'x', 'x');`);
  migrate(d, file);
  const got = d.prepare('SELECT scheduled_at FROM posts ORDER BY id').all().map((r) => r.scheduled_at);
  assert.deepEqual(got, [
    new Date(2026, 10, 3, 9, 30).toISOString(), // sin desfase = hora local del ordenador
    '2026-11-03T09:30:00.000Z',
    '2026-11-03T09:30:00.000Z',
    null,
    'basura', // lo que no se entiende no se toca
  ]);
});

test('una base de datos de una versión MÁS NUEVA no se toca', () => {
  const { d, file } = openDb('futura.db');
  d.exec('CREATE TABLE cosa (id INTEGER); PRAGMA user_version = 99;');
  const r = migrate(d, file);
  assert.equal(version(d), 99);
  assert.deepEqual(r.repaired, []);
  assert.ok(!d.prepare(`SELECT 1 AS x FROM sqlite_master WHERE name = 'posts'`).get());
});
