// Lo que se envía a TikTok y YouTube al publicar, según lo que eligió la persona (fetch simulado, sin red).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.WILLYPOST_BROKER = 'off';
const tiktokMod = await import('../server/providers/tiktok.js');
const youtubeMod = await import('../server/providers/youtube.js');
const tiktok = tiktokMod.default;
const youtube = youtubeMod.default;
const { buildPostInfo } = tiktokMod;

const realFetch = globalThis.fetch;
let calls;
let handler;
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const rec = { url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) }, body: init.body };
    calls.push(rec);
    return handler(rec);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const files = [];
function tmpFile(size, name = 'v.mp4') {
  const p = path.join(os.tmpdir(), `wp-compl-${process.pid}-${files.length}-${name}`);
  fs.writeFileSync(p, Buffer.alloc(size, 3));
  files.push(p);
  return p;
}
test.after(() => files.forEach((f) => fs.rmSync(f, { force: true })));

const ctx = { pollInterval: 1, sleep: async () => {}, log: () => {} };
const CREATOR = {
  creator_nickname: 'Willy', creator_username: 'willy', creator_avatar_url: 'https://p16.tiktokcdn.com/a.jpg',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
  comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 60,
};

/** Simula TikTok: creator_info → video/init → PUT → status PUBLISH_COMPLETE. */
function tiktokOk(creator = CREATOR) {
  handler = (r) => {
    if (r.url.endsWith('/creator_info/query/')) return json({ data: creator, error: { code: 'ok' } });
    if (r.url.endsWith('/post/publish/video/init/')) return json({ data: { publish_id: 'p1', upload_url: 'https://upload.tiktok/u' }, error: { code: 'ok' } });
    if (r.url.endsWith('/post/publish/content/init/')) return json({ data: { publish_id: 'ph1' }, error: { code: 'ok' } });
    if (r.url === 'https://upload.tiktok/u') return new Response(null, { status: 201 });
    if (r.url.endsWith('/status/fetch/')) return new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000009]},"error":{"code":"ok"}}', { status: 200 });
    throw new Error('url inesperada ' + r.url);
  };
}
const initBody = () => JSON.parse(calls.find((c) => /\/(video|content)\/init\/$/.test(c.url)).body);
const publishReel = (options, media) => tiktok.publish({
  account: { access_token: 'tok', meta: {} }, creds: {}, type: 'reel', caption: 'Bajo el agua #buceo',
  media: media || [{ path: tmpFile(64), mime: 'video/mp4', kind: 'video', duration: 30 }], options, ctx,
});

test('TikTok vídeo: se envía la privacidad elegida y comentarios/dúo/stitch desactivados por defecto', async () => {
  tiktokOk();
  const res = await publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'MUTUAL_FOLLOW_FRIENDS' });
  const b = initBody();
  assert.deepEqual(b.post_info, {
    privacy_level: 'MUTUAL_FOLLOW_FRIENDS', title: 'Bajo el agua #buceo',
    disable_comment: true, disable_duet: true, disable_stitch: true,
    brand_content_toggle: false, brand_organic_toggle: false,
  });
  assert.equal(calls[0].url, 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/', 'creator_info se consulta justo antes');
  assert.equal(res.url, 'https://www.tiktok.com/@willy/video/7300000000000000009');
  assert.equal(res.warning, undefined);
});

test('TikTok vídeo: lo que activa la persona se respeta, salvo lo que el creador tiene cerrado', async () => {
  tiktokOk();
  await publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true, is_aigc: true });
  const p = initBody().post_info;
  assert.equal(p.disable_comment, false);
  assert.equal(p.disable_duet, false);
  assert.equal(p.disable_stitch, true, 'stitch_disabled del creador manda');
  assert.equal(p.is_aigc, true);
});

test('TikTok: contenido comercial → brand_organic_toggle / brand_content_toggle', async () => {
  tiktokOk();
  await publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', commercial: true, brand_organic: true, brand_content: true });
  let p = initBody().post_info;
  assert.equal(p.brand_organic_toggle, true);
  assert.equal(p.brand_content_toggle, true);
  calls = [];
  tiktokOk();
  // Sin el interruptor general, las casillas sueltas no cuentan.
  await publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', commercial: false, brand_content: true });
  p = initBody().post_info;
  assert.equal(p.brand_content_toggle, false);
  assert.equal(p.brand_organic_toggle, false);
});

test('TikTok: si la privacidad elegida ya no está permitida, falla con mensaje claro y NO la cambia por otra', async () => {
  tiktokOk({ ...CREATOR, privacy_level_options: ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] });
  await assert.rejects(
    publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE' }),
    (e) => /ya no permite la privacidad elegida \(«Todo el mundo»\)/.test(e.message) && /No la hemos cambiado/.test(e.message) && e.retryable === false,
  );
  assert.ok(!calls.some((c) => c.url.includes('/init/')), 'no se envía nada a TikTok');
});

test('TikTok: sin privacidad elegida (publicaciones antiguas) no se publica con un valor por defecto', async () => {
  tiktokOk();
  await assert.rejects(publishReel({ tiktok_mode: 'direct' }), /No se ha elegido quién puede ver/);
  assert.ok(!calls.some((c) => c.url.includes('/init/')));
});

test('TikTok: contenido de marca con «Solo yo» se rechaza antes de subir nada', async () => {
  tiktokOk();
  await assert.rejects(
    publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY', commercial: true, brand_content: true }),
    /contenido de marca no puede publicarse como «Solo yo»/,
  );
  assert.ok(!calls.some((c) => c.url.includes('/init/')));
});

test('TikTok: vídeo más largo que max_video_post_duration_sec → error claro antes de subir', async () => {
  tiktokOk();
  await assert.rejects(
    publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY' }, [{ path: tmpFile(64), mime: 'video/mp4', kind: 'video', duration: 95 }]),
    /dura 95 s y tu cuenta de TikTok solo permite vídeos de hasta 60 s/,
  );
  assert.ok(!calls.some((c) => c.url.includes('/init/')));
});

test('TikTok: si el creador no puede publicar ahora (límite diario), error en español', async () => {
  handler = () => json({ data: {}, error: { code: 'spam_risk_too_many_posts', message: 'cap', log_id: 'x' } });
  await assert.rejects(publishReel({ tiktok_mode: 'direct', tiktok_privacy: 'SELF_ONLY' }), /límite diario de publicaciones de TikTok/);
});

test('TikTok fotos: sin Dúo ni Stitch, con título/descripción, contenido comercial y URL verificada', async () => {
  tiktokOk();
  const used = [];
  const res = await tiktok.publish({
    account: { access_token: 'tok', meta: {} }, creds: {}, type: 'carousel',
    caption: 'Primera línea de las fotos\nY una descripción más larga #lanzarote',
    media: [{ path: 'a.jpg', mime: 'image/jpeg', kind: 'image' }, { path: 'b.webp', mime: 'image/webp', kind: 'image' }],
    options: { tiktok_mode: 'direct', tiktok_privacy: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: true, allow_stitch: true, commercial: true, brand_organic: true },
    ctx: { ...ctx, verifiedUrl: async (it) => { used.push(it.path); return `https://media.willypost.com/t/x/m/${used.length}/media.jpg`; } },
  });
  const b = initBody();
  assert.equal(b.media_type, 'PHOTO');
  assert.equal(b.post_mode, 'DIRECT_POST');
  assert.deepEqual(b.source_info, { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: ['https://media.willypost.com/t/x/m/1/media.jpg', 'https://media.willypost.com/t/x/m/2/media.jpg'] });
  assert.equal(b.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(b.post_info.title, 'Primera línea de las fotos');
  assert.match(b.post_info.description, /descripción más larga/);
  assert.equal(b.post_info.disable_comment, false);
  assert.ok(!('disable_duet' in b.post_info) && !('disable_stitch' in b.post_info), 'las fotos no llevan Dúo ni Stitch');
  assert.equal(b.post_info.brand_organic_toggle, true);
  assert.equal(b.post_info.brand_content_toggle, false);
  assert.equal(res.external_id, '7300000000000000009');
});

test('buildPostInfo: fotos con título máx. 90 y descripción máx. 4000', () => {
  const creator = { privacy_level_options: ['SELF_ONLY'], comment_disabled: true, duet_disabled: false, stitch_disabled: false };
  const p = buildPostInfo({ options: { tiktok_privacy: 'SELF_ONLY', allow_comment: true, title: 'x'.repeat(120) }, creator, caption: 'y'.repeat(5000), photo: true });
  assert.equal(p.title.length, 90);
  assert.equal(p.description.length, 4000);
  assert.equal(p.disable_comment, true, 'comment_disabled del creador manda');
});

/* ---------------- YouTube ---------------- */

test('YouTube: privacyStatus, título y descripción salen de lo que eligió la persona', async () => {
  const file = tmpFile(100);
  handler = (r) => {
    if (r.url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable')) {
      return new Response(null, { status: 200, headers: { location: 'https://upload.yt/s1' } });
    }
    if (r.url === 'https://upload.yt/s1') return json({ id: 'VID1' }, 200);
    if (r.url.includes('/youtube/v3/videos?part=status')) return json({ items: [{ status: { privacyStatus: 'unlisted', uploadStatus: 'uploaded' } }] });
    throw new Error('url inesperada ' + r.url);
  };
  const res = await youtube.publish({
    account: { access_token: 't' }, creds: {}, type: 'reel', caption: 'Descripción del vídeo #Shorts',
    media: [{ path: file, mime: 'video/mp4', kind: 'video', width: 1080, height: 1920 }],
    options: { title: 'Mi título elegido', privacy: 'unlisted' }, ctx,
  });
  const meta = JSON.parse(calls[0].body);
  assert.equal(meta.status.privacyStatus, 'unlisted');
  assert.equal(meta.snippet.title, 'Mi título elegido');
  assert.equal(meta.snippet.description, 'Descripción del vídeo #Shorts');
  assert.equal(res.external_id, 'VID1');
});
