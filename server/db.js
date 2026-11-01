import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

function open() {
  const file = process.env.WILLYPOST_DB || DB_PATH;
  try {
    const d = new DatabaseSync(file);
    d.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    return d;
  } catch (e) {
    console.error(`No se puede abrir la base de datos de WillyPost (${file}): ${e.message}. ` +
      '¿Hay otro WillyPost abierto o la carpeta no tiene permisos? Reinicia el ordenador y vuelve a abrirlo.');
    throw e;
  }
}

export const db = open();

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    recovery_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );
  CREATE TABLE credentials (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT,
    extra TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, family)
  );
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT,
    username TEXT,
    avatar_url TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    meta TEXT,
    mode TEXT NOT NULL DEFAULT 'api',
    connected_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, network, external_id)
  );
  CREATE TABLE oauth_pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network TEXT NOT NULL,
    state TEXT NOT NULL UNIQUE,
    code_verifier TEXT,
    candidates TEXT,
    account_id_reconnect INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT,
    mime TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    scheduled_at TEXT,
    created_by TEXT NOT NULL DEFAULT 'user',
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX posts_user_date ON posts(user_id, scheduled_at);
  CREATE TABLE post_media (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE post_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    caption_override TEXT,
    options TEXT,
    delivery TEXT NOT NULL DEFAULT 'api',
    status TEXT NOT NULL DEFAULT 'pending',
    external_id TEXT,
    external_url TEXT,
    error TEXT,
    warning TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    published_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX targets_status ON post_targets(status);
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    post_id INTEGER,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `,
  // v2: duración de los vídeos (segundos), para validar límites de cada red.
  `ALTER TABLE media ADD COLUMN duration REAL;`,
];

function migrate() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
migrate();

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));
const plain = (row) => (row ? { ...row } : row);

export const all = (sql, ...params) => db.prepare(sql).all(...clean(params)).map(plain);
export const get = (sql, ...params) => plain(db.prepare(sql).get(...clean(params)));
export const run = (sql, ...params) => db.prepare(sql).run(...clean(params));

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();
export const parseJson = (s, fallback = null) => {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
