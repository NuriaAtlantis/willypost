// Reglas obligatorias de TikTok (Content Sharing Guidelines) y YouTube (Required Minimum Functionality):
// almacenamiento de las opciones por red, validación al programar/aprobar y lo que Claude NO puede elegir.
// Sin red y con datos temporales (nunca los datos reales de WillyPost).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-compliance-rules-'));
process.env.WILLYPOST_DATA = dataDir;
process.env.WILLYPOST_NO_DESKTOP_NOTIFY = '1';
process.env.WILLYPOST_BROKER = 'off';

const { run, get, all, db } = await import('../server/db.js');
const { savePost, approvePost, duplicatePost } = await import('../server/posts.js');
const { setSetting } = await import('../server/auth.js');
const C = await import('../server/compliance.js');

let user;
let tt; // cuenta de TikTok (API)
let yt; // cuenta de YouTube (API)
let video;
let image;

const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

before(() => {
  const ts = new Date().toISOString();
  const r = run('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)', 'rules@test.com', 'R', 'x', ts);
  user = get('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid));
  for (const [network, ext] of [['tiktok', 'open-1'], ['youtube', 'UC1']]) {
    run(
      `INSERT INTO accounts (user_id, network, external_id, name, username, access_token, token_expires_at, meta, mode, connected_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'tok', ?, '{}', 'api', ?, ?)`,
      user.id, network, ext, `Cuenta ${network}`, 'willy', inHours(48), ts, ts,
    );
  }
  tt = get(`SELECT * FROM accounts WHERE network = 'tiktok'`);
  yt = get(`SELECT * FROM accounts WHERE network = 'youtube'`);
  run(`INSERT INTO media (user_id, filename, original_name, mime, kind, size, width, height, duration, created_at)
       VALUES (?, 'v.mp4', 'v.mp4', 'video/mp4', 'video', 1000, 1080, 1920, 20, ?)`, user.id, ts);
  run(`INSERT INTO media (user_id, filename, original_name, mime, kind, size, width, height, created_at)
       VALUES (?, 'f.jpg', 'f.jpg', 'image/jpeg', 'image', 1000, 1080, 1350, ?)`, user.id, ts);
  video = get(`SELECT * FROM media WHERE kind = 'video'`);
  image = get(`SELECT * FROM media WHERE kind = 'image'`);
});

after(() => {
  try { db.close(); } catch { /* */ }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

const reel = (targets, extra = {}) => ({ type: 'reel', caption: 'Mi vídeo #buceo', media_ids: [video.id], targets, ...extra });
const targetOptions = (postId, accountId) => JSON.parse(get('SELECT options FROM post_targets WHERE post_id = ? AND account_id = ?', postId, accountId).options);

/* ---------------- almacenamiento ---------------- */

test('almacenamiento: post_targets tiene la columna options (JSON por red) y las migraciones están al día', () => {
  const cols = all('PRAGMA table_info(post_targets)').map((c) => c.name);
  assert.ok(cols.includes('options'));
  assert.ok(get('PRAGMA user_version').user_version >= 2);
});

test('almacenamiento: las opciones de TikTok y YouTube se guardan por destino y vuelven intactas', () => {
  const { post } = savePost(user, reel([
    { account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'MUTUAL_FOLLOW_FRIENDS', allow_comment: true, commercial: true, brand_organic: true } },
    { account_id: yt.id, options: { title: 'Bucear en Lanzarote', privacy: 'unlisted' } },
  ], { action: 'schedule', scheduled_at: inHours(5) }));
  assert.equal(post.status, 'scheduled');
  assert.deepEqual(targetOptions(post.id, tt.id), { tiktok_mode: 'direct', tiktok_privacy: 'MUTUAL_FOLLOW_FRIENDS', allow_comment: true, commercial: true, brand_organic: true });
  assert.deepEqual(targetOptions(post.id, yt.id), { title: 'Bucear en Lanzarote', privacy: 'unlisted' });
  const t = post.targets.find((x) => x.network === 'tiktok');
  assert.equal(t.options.tiktok_privacy, 'MUTUAL_FOLLOW_FRIENDS');
});

/* ---------------- reglas puras ---------------- */

test('TikTok: sin privacidad elegida no hay valor por defecto (error en modo directo)', () => {
  const errs = C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'direct' } });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /Elige quién puede ver/);
  // En modo bandeja la privacidad se elige luego en la app de TikTok.
  assert.deepEqual(C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'inbox' } }), []);
  assert.deepEqual(C.complianceErrors('tiktok', { type: 'reel', options: {} }), []);
});

test('TikTok: contenido de marca + «Solo yo» se rechaza; contenido comercial exige marcar una opción', () => {
  let errs = C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY', commercial: true, brand_content: true } });
  assert.ok(errs.some((e) => /contenido de marca no puede ser privado/i.test(e)));
  errs = C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', commercial: true } });
  assert.ok(errs.some((e) => /te promociona a ti, a un tercero o a ambos/.test(e)));
  // «Tu marca» sí puede ser «Solo yo».
  assert.deepEqual(C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY', commercial: true, brand_organic: true } }), []);
});

test('TikTok: la privacidad tiene que estar entre las que permite el creador (creator_info)', () => {
  const creator = { privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] };
  const errs = C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE' }, creator });
  assert.match(errs[0], /ya no permite «Todo el mundo»/);
  assert.deepEqual(C.complianceErrors('tiktok', { type: 'reel', options: { tiktok_mode: 'direct', tiktok_privacy: 'FOLLOWER_OF_CREATOR' }, creator }), []);
});

test('TikTok: las fotos no tienen Dúo ni Stitch (se quitan al guardar)', () => {
  const o = C.normalizeOptions('tiktok', 'carousel', { tiktok_mode: 'direct', allow_comment: true, allow_duet: true, allow_stitch: true, disable_duet: false });
  assert.deepEqual(o, { tiktok_mode: 'direct', allow_comment: true });
  const v = C.normalizeOptions('tiktok', 'reel', { allow_duet: 'true', commercial: false, brand_content: true });
  assert.deepEqual(v, { allow_duet: true, commercial: false });
});

test('YouTube: título y visibilidad obligatorios para subir', () => {
  assert.equal(C.complianceErrors('youtube', { type: 'reel', options: {} }).length, 2);
  assert.match(C.complianceErrors('youtube', { type: 'reel', options: { privacy: 'public' } })[0], /título/);
  assert.match(C.complianceErrors('youtube', { type: 'reel', options: { title: 'Hola' } })[0], /visibilidad/);
  assert.equal(C.complianceErrors('youtube', { type: 'reel', options: { title: 'Hola', privacy: 'secreto' } }).length, 1);
  assert.deepEqual(C.complianceErrors('youtube', { type: 'reel', options: { title: 'Hola', privacy: 'private' } }), []);
});

/* ---------------- savePost / aprobar ---------------- */

test('programar TikTok directo sin privacidad → error 400 claro; como borrador sí se guarda (con aviso)', () => {
  assert.throws(
    () => savePost(user, reel([{ account_id: tt.id, options: { tiktok_mode: 'direct' } }], { action: 'schedule', scheduled_at: inHours(6) })),
    (e) => e.status === 400 && /TikTok: Elige quién puede ver/.test(e.message) && e.details?.[0]?.account_id === tt.id,
  );
  const { post, warnings } = savePost(user, reel([{ account_id: tt.id, options: { tiktok_mode: 'direct' } }], { action: 'draft' }));
  assert.equal(post.status, 'draft');
  assert.ok(warnings.some((w) => /Elige quién puede ver/.test(w.message)));
});

test('programar con contenido de marca en «Solo yo» → error; YouTube sin título → error', () => {
  assert.throws(
    () => savePost(user, reel([{ account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY', commercial: true, brand_content: true } }], { action: 'schedule', scheduled_at: inHours(7) })),
    (e) => e.status === 400 && /no puede ser privado/.test(e.message),
  );
  assert.throws(
    () => savePost(user, reel([{ account_id: yt.id, options: { privacy: 'public' } }], { action: 'publish_now' })),
    (e) => e.status === 400 && /YouTube Shorts: Escribe el título/.test(e.message),
  );
});

test('Claude no puede elegir la privacidad ni la publicidad de TikTok: se quitan y queda como borrador', () => {
  setSetting(user.id, 'claude_mode', 'schedule'); // aunque Claude pueda programar…
  const { post, warnings } = savePost(user, reel([
    { account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', allow_comment: true, commercial: true, brand_organic: true } },
  ], { action: 'schedule', scheduled_at: inHours(8), created_by: 'claude' }));
  assert.equal(post.status, 'draft', '…TikTok directo queda como borrador hasta que la persona elija');
  assert.equal(post.created_by, 'claude');
  assert.deepEqual(targetOptions(post.id, tt.id), { tiktok_mode: 'direct' });
  assert.ok(warnings.some((w) => /Claude no puede marcarlos/.test(w.message)));
  assert.ok(warnings.some((w) => /Propuesto por Claude/.test(w.message)));
  setSetting(user.id, 'claude_mode', 'draft');

  // Aprobar sin que la persona haya elegido → 400 (la interfaz abre el editor).
  assert.throws(() => approvePost(user, post.id), (e) => e.status === 400 && /Elige quién puede ver/.test(e.message));

  // La persona elige en el compositor y programa.
  const human = savePost(user, reel([{ account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'FOLLOWER_OF_CREATOR' } }], { action: 'draft', scheduled_at: inHours(8) }), post.id);
  assert.equal(targetOptions(human.post.id, tt.id).tiktok_privacy, 'FOLLOWER_OF_CREATOR');

  // Si después Claude retoca el texto, la elección de la persona se conserva (y no puede cambiarla).
  const again = savePost(user, reel([{ account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY' } }], { caption: 'Nuevo texto', action: 'draft', scheduled_at: inHours(8), created_by: 'claude' }), post.id);
  assert.equal(targetOptions(again.post.id, tt.id).tiktok_privacy, 'FOLLOWER_OF_CREATOR');
  assert.ok(again.warnings.some((w) => /Claude no puede marcarlos/.test(w.message)));

  const ok = approvePost(user, post.id);
  assert.equal(ok.post.status, 'scheduled');
});

test('duplicar no hereda la privacidad ni la publicidad de TikTok (se eligen en cada publicación)', () => {
  const { post } = savePost(user, reel([
    { account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', allow_comment: true, is_aigc: true } },
    { account_id: yt.id, options: { title: 'T', privacy: 'public' } },
  ], { action: 'schedule', scheduled_at: inHours(9) }));
  const dup = duplicatePost(user, post.id);
  assert.deepEqual(targetOptions(dup.post.id, tt.id), { tiktok_mode: 'direct', is_aigc: true });
  assert.deepEqual(targetOptions(dup.post.id, yt.id), { title: 'T', privacy: 'public' });
});

test('privacidad que el creador ya no permite (creator_info reciente) → no se puede programar', () => {
  C.rememberCreatorInfo(tt.id, { privacy_level_options: ['MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] });
  try {
    assert.throws(
      () => savePost(user, reel([{ account_id: tt.id, options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE' } }], { action: 'schedule', scheduled_at: inHours(10) })),
      (e) => e.status === 400 && /ya no permite «Todo el mundo»/.test(e.message),
    );
  } finally {
    C.rememberCreatorInfo(tt.id, { privacy_level_options: C.TIKTOK_PRIVACY });
  }
});

test('las fotos en TikTok (modo manual hoy) no exigen nada y no guardan Dúo/Stitch', () => {
  const { post } = savePost(user, {
    type: 'post', caption: 'Foto', media_ids: [image.id],
    targets: [{ account_id: tt.id, options: { tiktok_mode: 'direct', allow_duet: true, allow_stitch: true, allow_comment: true } }],
    action: 'schedule', scheduled_at: inHours(11),
  });
  assert.equal(post.status, 'scheduled');
  assert.deepEqual(targetOptions(post.id, tt.id), { tiktok_mode: 'direct', allow_comment: true });
});
