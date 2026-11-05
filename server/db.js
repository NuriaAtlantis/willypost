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
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    recovery_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );
  CREATE TABLE IF NOT EXISTS credentials (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret TEXT,
    extra TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, family)
  );
  CREATE TABLE IF NOT EXISTS accounts (
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
  CREATE TABLE IF NOT EXISTS oauth_pending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network TEXT NOT NULL,
    state TEXT NOT NULL UNIQUE,
    code_verifier TEXT,
    candidates TEXT,
    account_id_reconnect INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media (
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
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
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
  CREATE INDEX IF NOT EXISTS posts_user_date ON posts(user_id, scheduled_at);
  CREATE TABLE IF NOT EXISTS post_media (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS post_targets (
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
  CREATE INDEX IF NOT EXISTS targets_status ON post_targets(status);
  CREATE TABLE IF NOT EXISTS notifications (
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
  (d) => addColumnIfMissing(d, 'media', 'duration', 'REAL'),
];

const columnsOf = (d, table) => d.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);

function addColumnIfMissing(d, table, column, decl) {
  if (!columnsOf(d, table).includes(column)) d.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${decl}`);
}

const userTables = (d) => d.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all();

/** Esquema completo actual (en memoria): sirve de referencia para reparar bases de datos de versiones antiguas. */
function referenceSchema() {
  const ref = new DatabaseSync(':memory:');
  try {
    for (const m of MIGRATIONS) (typeof m === 'function' ? m(ref) : ref.exec(m));
    const tables = userTables(ref).map((t) => ({
      ...t,
      columns: ref.prepare(`PRAGMA table_info("${t.name}")`).all().map((c) => ({ ...c })),
    }));
    const indexes = ref.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL`).all().map((r) => ({ ...r }));
    return { tables, indexes };
  } finally {
    ref.close();
  }
}

/**
 * Deja la base de datos con todas las tablas, columnas e índices que espera esta versión, venga de donde venga
 * (instalaciones antiguas, versiones de prueba, una migración a medias…). Solo AÑADE: nunca borra datos.
 * Idempotente: se ejecuta en cada arranque y, si no falta nada, no cambia nada.
 */
function repairSchema(d) {
  const { tables, indexes } = referenceSchema();
  const have = new Set(userTables(d).map((t) => t.name));
  const changes = [];
  d.exec('BEGIN');
  try {
    for (const t of tables) {
      if (!have.has(t.name)) {
        d.exec(t.sql);
        changes.push(`tabla ${t.name}`);
        continue;
      }
      const cols = new Set(columnsOf(d, t.name));
      for (const c of t.columns) {
        if (cols.has(c.name) || c.pk) continue;
        const hasDefault = c.dflt_value != null;
        // SQLite no deja añadir NOT NULL sin valor por defecto a una tabla con filas: se añade sin NOT NULL.
        const decl = `${c.type || ''}${c.notnull && hasDefault ? ' NOT NULL' : ''}${hasDefault ? ` DEFAULT ${c.dflt_value}` : ''}`;
        d.exec(`ALTER TABLE "${t.name}" ADD COLUMN "${c.name}" ${decl}`);
        changes.push(`${t.name}.${c.name}`);
      }
    }
    for (const i of indexes) {
      d.exec(i.sql.replace(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, (_m, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `));
    }
    // Fechas guardadas en otro formato (p. ej. sin "Z" o con desfase): el programador compara texto ISO en UTC.
    const CANON = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    for (const [table, col] of [['posts', 'scheduled_at'], ['post_targets', 'next_attempt_at'], ['sessions', 'expires_at']]) {
      for (const r of d.prepare(`SELECT rowid AS rid, "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL`).all()) {
        if (CANON.test(String(r.v))) continue;
        const dt = new Date(String(r.v).trim().replace(' ', 'T'));
        if (Number.isNaN(dt.getTime())) continue;
        d.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE rowid = ?`).run(dt.toISOString(), r.rid);
        changes.push(`${table}.${col}#${r.rid}`);
      }
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return changes;
}

/** Copia de seguridad coherente (también con WAL) antes de actualizar el esquema de una base de datos con datos. */
function backupBeforeUpgrade(d, file, fromVersion) {
  if (!file || file === ':memory:') return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const dest = `${file}.copia-v${fromVersion}-${stamp}.bak`;
  try {
    d.prepare('VACUUM INTO ?').run(dest);
    console.log(`[db] Copia de seguridad antes de actualizar: ${dest}`);
    return dest;
  } catch (e) {
    console.warn(`[db] No se pudo hacer la copia de seguridad antes de actualizar (${e.message}). Sigo: los cambios solo añaden.`);
    return null;
  }
}

/** Aplica las migraciones pendientes y repara el esquema. Seguro de ejecutar todas las veces que haga falta. */
export function migrate(d = db, file = process.env.WILLYPOST_DB || DB_PATH) {
  const { user_version: current } = d.prepare('PRAGMA user_version').get();
  if (current > MIGRATIONS.length) {
    // Base de datos de una versión MÁS NUEVA de WillyPost: no la tocamos.
    console.warn(`[db] La base de datos es de una versión más nueva de WillyPost (esquema ${current}). Actualiza WillyPost.`);
    return { from: current, to: current, backup: null, repaired: [] };
  }
  let backup = null;
  const repaired = [];
  if (current < MIGRATIONS.length && userTables(d).length) {
    backup = backupBeforeUpgrade(d, file, current);
    // Base de datos con tablas pero sin número de versión (instalaciones muy antiguas): primero se completan
    // las tablas existentes, para que los índices del paso 1 no fallen por columnas que no tenían.
    if (current === 0) repaired.push(...repairSchema(d));
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.exec('BEGIN');
    try {
      const m = MIGRATIONS[v];
      if (typeof m === 'function') m(d); else d.exec(m);
      d.exec(`PRAGMA user_version = ${v + 1}`);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      console.error(`[db] Error al actualizar la base de datos (paso ${v + 1}): ${e.message}.${backup ? ` Tienes una copia en ${backup}.` : ''}`);
      throw e;
    }
  }
  repaired.push(...repairSchema(d));
  if (repaired.length) console.log(`[db] Base de datos reparada (faltaba: ${repaired.slice(0, 20).join(', ')}${repaired.length > 20 ? '…' : ''})`);
  return { from: current, to: Math.max(current, MIGRATIONS.length), backup, repaired };
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
