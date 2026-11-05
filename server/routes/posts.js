import express from 'express';
import { all, get, run, now } from '../db.js';
import { HttpError, requireAuth, getSettings } from '../auth.js';
import {
  listPosts, getPostForUser, serializePost, savePost, approvePost, duplicatePost, recomputeStatus, parseFilterDate,
} from '../posts.js';
import { slots, nextQueueSlot, checkLimits } from '../limits.js';
import { getProvider } from '../providers/index.js';
import { publishTarget, tick, isLingering } from '../scheduler.js';
import { accountStatus, ensureFreshToken } from '../accounts.js';
import { ProviderError } from '../providers/_http.js';
import { queryCreatorInfo, tiktokErrorCode, CANNOT_POST_CODES } from '../providers/tiktok.js';
import { rememberCreatorInfo } from '../compliance.js';

export const postsRouter = express.Router();

/**
 * Datos del creador de TikTok para el compositor (reglas de TikTok: mostrar el nombre de la cuenta, ofrecer
 * solo las privacidades permitidas, desactivar Comentarios/Dúo/Stitch si el creador los tiene cerrados,
 * duración máxima del vídeo y si puede publicar ahora). Se consulta cada vez que se abre el panel.
 */
postsRouter.get('/api/accounts/:id/tiktok/creator-info', requireAuth, async (req, res) => {
  const acc = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!acc) throw new HttpError(404, 'Esa cuenta no existe.');
  if (acc.network !== 'tiktok') throw new HttpError(400, 'Esa cuenta no es de TikTok.');
  if (acc.mode === 'manual') throw new HttpError(400, 'Esa cuenta de TikTok está en modo manual: no hay nada que consultar.');
  if (accountStatus(acc) === 'expired') throw new HttpError(409, 'Tu conexión con TikTok ha caducado. Reconéctala en Redes.');
  const fallback = { nickname: acc.name || null, username: acc.username || null, avatar_url: acc.avatar_url || null };
  let fresh;
  try {
    fresh = await ensureFreshToken(acc);
  } catch (e) {
    throw new HttpError(409, e instanceof ProviderError ? e.message : 'No he podido renovar tu conexión con TikTok. Reconéctala en Redes.');
  }
  try {
    const info = await queryCreatorInfo(fresh.access_token);
    rememberCreatorInfo(acc.id, info);
    res.json({ ...fallback, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v != null)), can_post: true, reason: null });
  } catch (e) {
    if (CANNOT_POST_CODES.includes(tiktokErrorCode(e))) {
      // TikTok dice que ahora mismo esta cuenta no puede publicar (límite diario, restricción…).
      return res.json({
        ...fallback, privacy_level_options: [], comment_disabled: false, duet_disabled: false, stitch_disabled: false,
        max_video_post_duration_sec: null, can_post: false, reason: e.message,
      });
    }
    if (e instanceof ProviderError) {
      throw new HttpError(e.auth ? 409 : 502, e.auth ? e.message : `No he podido consultar tu cuenta de TikTok. ${e.message}`);
    }
    throw new HttpError(502, 'No he podido hablar con TikTok. Revisa tu conexión a internet y vuelve a intentarlo.');
  }
});

const kick = () => setTimeout(() => tick().catch(() => {}), 50);

// Lo que llega con el token de Claude siempre cuenta como "de Claude" (respeta el modo borrador).
const body = (req) => {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  return req.viaApiToken ? { ...b, created_by: 'claude' } : b;
};

/** En modo borrador, Claude no puede aprobar ni publicar: eso lo decide el alumno. */
function denyClaudeInDraftMode(req) {
  if (req.viaApiToken && getSettings(req.user.id).claude_mode !== 'schedule') {
    throw new HttpError(403, 'Claude está en modo borrador: aprobar y publicar lo haces tú desde WillyPost.');
  }
}

/** Límite diario si una publicación se adelanta a "ahora". */
function assertLimitsNow(p) {
  const accounts = all(
    `SELECT a.* FROM post_targets t JOIN accounts a ON a.id = t.account_id
     WHERE t.post_id = ? AND t.status IN ('pending', 'failed')`, p.id,
  );
  const problems = checkLimits({ accounts, type: p.type, scheduledAt: new Date().toISOString(), excludePostId: p.id });
  if (problems.length) {
    const x = problems[0];
    const label = getProvider(x.network)?.label || x.network;
    throw new HttpError(
      409,
      `Hoy ya tienes ${x.count} ${p.type === 'story' ? 'stories' : 'publicaciones'} en ${label}${x.name ? ` (${x.name})` : ''}. El máximo es ${x.max} al día por red: reprográmala para otro día.`,
      problems,
    );
  }
}

const safeUrl = (u) => {
  if (u == null || String(u).trim() === '') return null;
  let s = String(u).trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  if (!/^https?:\/\/[^\s]+$/i.test(s) || s.length > 2000) throw new HttpError(400, 'Ese enlace no parece válido. Cópialo desde la red (empieza por https://).');
  return s;
};

postsRouter.get('/api/posts', requireAuth, (req, res) => {
  res.json(listPosts(req.user.id, req.query));
});

postsRouter.get('/api/posts/:id', requireAuth, (req, res) => {
  res.json(serializePost(getPostForUser(req.user.id, req.params.id)));
});

postsRouter.post('/api/posts', requireAuth, (req, res) => {
  const b = body(req);
  const r = savePost(req.user, b);
  if (b.action === 'publish_now') kick();
  res.status(201).json({ ...r.post, warnings: r.warnings });
});

const LINGERING_MSG = 'La red todavía puede estar terminando la publicación anterior. Espera unos minutos y mira en la red si salió: si sale, aquí aparecerá como publicada sola.';

/** Si una red aún puede contestar a un envío de esta publicación, rehacerla podría duplicarla. */
function assertNoLateAnswer(postId) {
  const ids = all('SELECT id FROM post_targets WHERE post_id = ?', Number(postId)).map((r) => r.id);
  if (ids.some(isLingering)) throw new HttpError(409, LINGERING_MSG);
}

postsRouter.put('/api/posts/:id', requireAuth, (req, res) => {
  const b = body(req);
  assertNoLateAnswer(getPostForUser(req.user.id, req.params.id).id);
  const r = savePost(req.user, b, req.params.id);
  if (b.action === 'publish_now') kick();
  res.json({ ...r.post, warnings: r.warnings });
});

postsRouter.post('/api/posts/:id/approve', requireAuth, (req, res) => {
  denyClaudeInDraftMode(req);
  const r = approvePost(req.user, req.params.id, req.body?.scheduled_at);
  kick();
  res.json({ ...r.post, warnings: r.warnings });
});

postsRouter.post('/api/posts/:id/publish-now', requireAuth, (req, res) => {
  denyClaudeInDraftMode(req);
  const p = getPostForUser(req.user.id, req.params.id);
  if (['published', 'publishing'].includes(p.status)) throw new HttpError(409, 'Esta publicación ya se ha publicado o se está publicando.');
  if (p.status !== 'draft' && !get(`SELECT 1 AS x FROM post_targets WHERE post_id = ? AND status IN ('pending', 'failed')`, p.id)) {
    throw new HttpError(409, 'No queda nada por publicar en esta publicación.');
  }
  if (p.status === 'draft') {
    const s = serializePost(p);
    const r = savePost(req.user, {
      type: p.type, caption: p.caption, media_ids: s.media.map((m) => m.id),
      targets: s.targets.map((t) => ({ account_id: t.account_id, caption: t.caption_override, options: t.options })),
      action: 'publish_now', campaign_id: p.campaign_id, notes: p.notes,
    }, p.id);
    kick();
    return res.json({ ...r.post, warnings: r.warnings });
  }
  // Programada, atrasada o fallida: la publicamos ya.
  assertLimitsNow(p);
  run(`UPDATE posts SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?`, now(), now(), p.id);
  run(`UPDATE post_targets SET status = 'pending', attempts = 0, next_attempt_at = NULL, error = NULL WHERE post_id = ? AND status IN ('pending', 'failed')`, p.id);
  kick();
  res.json(serializePost(get('SELECT * FROM posts WHERE id = ?', p.id)));
});

postsRouter.post('/api/posts/:id/missed', requireAuth, (req, res) => {
  const p = getPostForUser(req.user.id, req.params.id);
  if (p.status !== 'missed') throw new HttpError(409, 'Esta publicación no está pendiente de decisión.');
  const action = req.body?.action;
  const s = serializePost(p);
  if (action === 'publish') {
    denyClaudeInDraftMode(req);
    assertLimitsNow(p);
    run(`UPDATE posts SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?`, now(), now(), p.id);
    kick();
  } else if (action === 'reschedule') {
    run(`UPDATE posts SET status = 'draft' WHERE id = ?`, p.id); // para poder revalidar límites
    try {
      savePost(req.user, {
        type: p.type, caption: p.caption, media_ids: s.media.map((m) => m.id),
        targets: s.targets.map((t) => ({ account_id: t.account_id, caption: t.caption_override, options: t.options })),
        scheduled_at: req.body?.scheduled_at, action: 'schedule', campaign_id: p.campaign_id, notes: p.notes,
        created_by: req.viaApiToken ? 'claude' : undefined,
      }, p.id);
    } catch (e) {
      run(`UPDATE posts SET status = 'missed' WHERE id = ?`, p.id);
      throw e;
    }
  } else if (action === 'skip') {
    const started = get(`SELECT 1 AS x FROM post_targets WHERE post_id = ? AND status NOT IN ('pending')`, p.id);
    if (started) {
      // Parte ya salió: omitimos solo lo que faltaba.
      run(`UPDATE post_targets SET status = 'skipped', next_attempt_at = NULL, updated_at = ? WHERE post_id = ? AND status = 'pending'`, now(), p.id);
      run(`UPDATE posts SET status = 'publishing', updated_at = ? WHERE id = ?`, now(), p.id);
      recomputeStatus(p.id);
    } else {
      // No salió nada: se queda como borrador sin fecha para reutilizarla cuando quieras.
      run(`UPDATE posts SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?`, now(), p.id);
    }
  } else {
    throw new HttpError(400, 'Acción no válida.');
  }
  res.json(serializePost(get('SELECT * FROM posts WHERE id = ?', p.id)));
});

postsRouter.post('/api/posts/:id/duplicate', requireAuth, (req, res) => {
  const r = duplicatePost(req.user, req.params.id);
  res.status(201).json({ ...r.post, warnings: r.warnings });
});

postsRouter.delete('/api/posts/:id', requireAuth, (req, res) => {
  const p = getPostForUser(req.user.id, req.params.id);
  if (p.status === 'publishing' || get(`SELECT 1 AS x FROM post_targets WHERE post_id = ? AND status = 'publishing'`, p.id)) {
    throw new HttpError(409, 'Se está publicando ahora mismo. Espera un momento.');
  }
  run('DELETE FROM posts WHERE id = ?', p.id);
  res.json({ ok: true });
});

function ownTarget(req) {
  const t = get(
    `SELECT t.* FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE t.id = ? AND p.user_id = ?`,
    Number(req.params.id), req.user.id,
  );
  if (!t) throw new HttpError(404, 'Ese envío no existe.');
  return t;
}

postsRouter.post('/api/targets/:id/manual-done', requireAuth, (req, res) => {
  const t = ownTarget(req);
  if (t.status === 'publishing') throw new HttpError(409, 'Se está publicando ahora mismo. Espera un momento.');
  if (t.status === 'published') throw new HttpError(409, 'Este envío ya está publicado.');
  const url = safeUrl(req.body?.url);
  run(
    `UPDATE post_targets SET status = 'manual_done', external_url = ?, published_at = ?, error = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
    url, now(), now(), t.id,
  );
  recomputeStatus(t.post_id);
  res.json(serializePost(get('SELECT * FROM posts WHERE id = ?', t.post_id)));
});

postsRouter.post('/api/targets/:id/retry', requireAuth, async (req, res) => {
  denyClaudeInDraftMode(req);
  const t = ownTarget(req);
  if (!['failed', 'manual_pending'].includes(t.status)) throw new HttpError(409, 'Solo se pueden reintentar envíos fallidos.');
  // La red no contestó a tiempo pero su petición sigue viva: reintentar ahora podría duplicar la publicación.
  if (isLingering(t.id)) throw new HttpError(409, LINGERING_MSG);
  run(`UPDATE post_targets SET status = 'pending', attempts = 0, next_attempt_at = NULL, error = NULL, updated_at = ? WHERE id = ?`, now(), t.id);
  const p = get('SELECT * FROM posts WHERE id = ?', t.post_id);
  if (['draft', 'missed'].includes(p.status)) {
    // Sigue pendiente de que el alumno la programe o decida qué hacer con ella.
  } else if (new Date(p.scheduled_at || 0) > new Date()) {
    recomputeStatus(p.id);
  } else {
    run(`UPDATE posts SET status = 'publishing' WHERE id = ?`, p.id);
    publishTarget(t.id).catch(() => {});
  }
  res.json(serializePost(get('SELECT * FROM posts WHERE id = ?', t.post_id)));
});

postsRouter.get('/api/slots', requireAuth, (req, res) => {
  const from = req.query.from ? parseFilterDate(req.query.from, 'desde') : new Date(Date.now() - 31 * 86400000);
  const to = req.query.to ? parseFilterDate(req.query.to, 'hasta') : new Date(Date.now() + 62 * 86400000);
  res.json(slots(req.user.id, from.toISOString(), to.toISOString()));
});

postsRouter.get('/api/queue/next', requireAuth, (req, res) => {
  const ids = String(req.query.account_ids || '').split(',').filter(Boolean).map(Number);
  const accounts = ids.map((id) => get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', id, req.user.id)).filter(Boolean);
  if (!accounts.length) throw new HttpError(400, 'Elige al menos una red.');
  const type = ['post', 'carousel', 'reel', 'story'].includes(req.query.type) ? req.query.type : 'post';
  const iso = nextQueueSlot({ accounts, type, queueTimes: getSettings(req.user.id).queue_times });
  res.json({ scheduled_at: iso });
});

export { all };
