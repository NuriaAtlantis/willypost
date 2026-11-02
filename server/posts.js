import { all, get, run, tx, now, parseJson } from './db.js';
import { HttpError, getSettings } from './auth.js';
import { serializeMedia, providerMediaItem } from './media.js';
import { getProvider, apiSupports } from './providers/index.js';
import { checkLimits, nextQueueSlot } from './limits.js';
import { reconnectDueAt } from './accounts.js';
import { MISSED_GRACE_MIN } from './config.js';
import {
  normalizeOptions, protectHumanChoices, withoutHumanChoices, complianceErrors, knownCreatorInfo,
} from './compliance.js';

export const TYPES = ['post', 'carousel', 'reel', 'story'];
const TYPE_LABEL = { post: 'post', carousel: 'carrusel', reel: 'reel', story: 'story' };
const EDITABLE = ['draft', 'scheduled', 'missed', 'failed'];

const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtWhen = (iso) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Convierte la fecha que llega del navegador o de Claude. Sin desfase horario = hora local del ordenador. */
export function parseWhen(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new HttpError(400, 'Indica también la hora de publicación (por ejemplo 2026-11-03T10:00).');
  }
  const d = new Date(typeof value === 'string' ? value.trim() : value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'La fecha no es válida.');
  if (d.getFullYear() < 2000 || d.getFullYear() > 2100) throw new HttpError(400, 'La fecha no es válida.');
  return d;
}

/** Fecha de un filtro (?from=...&to=...). Error claro si no se entiende. */
export function parseFilterDate(value, name) {
  // "2026-11-03" = ese día en la hora local del ordenador; "hasta" incluye el día entero.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (name === 'hasta' ? 1 : 0));
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `La fecha "${name}" no es válida.`);
  return d;
}

export function effectiveCaption(post, target) {
  return target.caption_override != null && target.caption_override !== '' ? target.caption_override : post.caption;
}

export function serializePost(p) {
  const media = all(
    'SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ? ORDER BY pm.position',
    p.id,
  ).map(serializeMedia);
  const targets = all(
    `SELECT t.*, a.network, a.name AS account_name, a.username AS account_username, a.avatar_url AS account_avatar
     FROM post_targets t JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ? ORDER BY t.id`,
    p.id,
  ).map((t) => ({
    id: t.id,
    account_id: t.account_id,
    network: t.network,
    account_name: t.account_username ? `@${t.account_username.replace(/^@/, '')}` : t.account_name,
    account_avatar: t.account_avatar,
    caption: effectiveCaption(p, t),
    caption_override: t.caption_override,
    options: parseJson(t.options, {}),
    delivery: t.delivery,
    status: t.status,
    external_url: t.external_url,
    error: t.error,
    warning: t.warning,
    attempts: t.attempts,
    published_at: t.published_at,
  }));
  const campaign = p.campaign_id ? get('SELECT id, name, color FROM campaigns WHERE id = ?', p.campaign_id) : null;
  return {
    id: p.id,
    type: p.type,
    caption: p.caption,
    status: p.status,
    scheduled_at: p.scheduled_at,
    created_by: p.created_by,
    campaign: campaign || null,
    notes: p.notes || '',
    media,
    targets,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export function getPostForUser(userId, id) {
  const p = get('SELECT * FROM posts WHERE id = ? AND user_id = ?', Number(id), userId);
  if (!p) throw new HttpError(404, 'Esa publicación no existe.');
  return p;
}

export function listPosts(userId, { from, to, status, campaign_id } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (from) { where.push('(scheduled_at >= ? OR scheduled_at IS NULL)'); params.push(parseFilterDate(from, 'desde').toISOString()); }
  if (to) { where.push('(scheduled_at < ? OR scheduled_at IS NULL)'); params.push(parseFilterDate(to, 'hasta').toISOString()); }
  if (status) {
    const list = String(status).split(',');
    where.push(`status IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
  if (campaign_id) { where.push('campaign_id = ?'); params.push(Number(campaign_id)); }
  return all(`SELECT * FROM posts WHERE ${where.join(' AND ')} ORDER BY scheduled_at IS NULL, scheduled_at, id`, ...params)
    .map(serializePost);
}

/** Valida y guarda una publicación. Devuelve { post, warnings }. */
export function savePost(user, body, existingId = null) {
  const settings = getSettings(user.id);
  const existing = existingId ? getPostForUser(user.id, existingId) : null;
  if (existing && !EDITABLE.includes(existing.status)) {
    throw new HttpError(409, 'Esta publicación ya se ha publicado (o se está publicando) y no se puede editar. Duplícala si quieres reutilizarla.');
  }
  // Si una parte ya salió (p. ej. una publicación atrasada que se publicó en una red), rehacerla la duplicaría.
  if (existing && get(`SELECT 1 AS x FROM post_targets WHERE post_id = ? AND status IN ('published', 'manual_done', 'publishing')`, existing.id)) {
    throw new HttpError(409, 'Esta publicación ya ha salido en alguna red y no se puede editar. Duplícala si quieres reutilizarla.');
  }

  const type = body.type || existing?.type || 'post';
  if (!TYPES.includes(type)) throw new HttpError(400, 'Tipo de publicación no válido.');
  const caption = String(body.caption ?? existing?.caption ?? '');
  // fromClaude: la petición viene de Claude (MCP). createdBy: autor guardado del post.
  const fromClaude = body.created_by === 'claude';
  const createdBy = existing?.created_by || (fromClaude ? 'claude' : 'user');
  const action = body.action || 'draft';
  if (!['draft', 'schedule', 'publish_now', 'queue'].includes(action)) throw new HttpError(400, 'Acción no válida.');

  // ---- Medios
  const mediaIds = Array.isArray(body.media_ids) ? body.media_ids.map(Number) : [];
  const media = mediaIds.map((id) => {
    const m = get('SELECT * FROM media WHERE id = ? AND user_id = ?', id, user.id);
    if (!m) throw new HttpError(400, `El archivo ${id} no existe en tu biblioteca.`);
    return m;
  });

  const errors = [];
  const warnings = [];
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');
  if (type === 'post' && media.length > 1) errors.push({ message: 'Un post lleva como mucho 1 imagen. Para varias, elige Carrusel.' });
  if (type === 'post' && videos.length) errors.push({ message: 'Para publicar un vídeo elige el tipo Reel.' });
  if (type === 'carousel' && media.length < 2) errors.push({ message: 'Un carrusel necesita al menos 2 imágenes.' });
  if (type === 'carousel' && media.length > 20) errors.push({ message: 'Un carrusel admite como mucho 20 elementos.' });
  if (type === 'reel' && (videos.length !== 1 || images.length)) errors.push({ message: 'Un reel necesita exactamente 1 vídeo.' });
  if (type === 'story' && media.length !== 1) errors.push({ message: 'Una story necesita exactamente 1 imagen o 1 vídeo.' });
  if (type === 'post' && !media.length && !caption.trim()) errors.push({ message: 'Escribe un texto o añade una imagen.' });

  // ---- Destinos
  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  const seen = new Set();
  const targets = [];
  // Reglas obligatorias de TikTok/YouTube (privacidad, título…): bloquean al programar, no en borradores.
  const compliance = [];
  const previousOptions = new Map(existing
    ? all('SELECT account_id, options FROM post_targets WHERE post_id = ?', existing.id).map((r) => [r.account_id, parseJson(r.options, {})])
    : []);
  let claudeTouchedTikTok = false;
  for (const t of rawTargets) {
    const acc = t && get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(t.account_id), user.id);
    if (!acc) throw new HttpError(400, 'Una de las redes elegidas ya no está conectada. Revisa las redes de la publicación (o conéctala en Redes).');
    if (seen.has(acc.id)) continue;
    seen.add(acc.id);
    const provider = getProvider(acc.network);
    const label = provider?.label || acc.network;
    const tCaption = t.caption != null && t.caption !== '' ? String(t.caption) : null;
    const effective = tCaption ?? caption;
    let options = normalizeOptions(acc.network, type, t.options);
    if (fromClaude) {
      // La privacidad y la publicidad de TikTok las elige siempre la persona, al aprobar.
      const r = protectHumanChoices(acc.network, options, previousOptions.get(acc.id));
      options = r.options;
      if (r.stripped) claudeTouchedTikTok = true;
    }
    let delivery = 'api';
    if (acc.mode === 'manual' || !provider) {
      delivery = 'manual';
    } else if (!apiSupports(acc.network, type, media.length > 0)) {
      delivery = 'manual';
      warnings.push({
        account_id: acc.id, network: acc.network,
        message: `${label} no permite publicar ${TYPE_LABEL[type]}${type === 'post' && !media.length ? ' solo de texto' : ''} automáticamente: te avisaremos a la hora para que lo subas tú en un momento.`,
      });
    }
    if (delivery === 'api' && provider?.validate) {
      let msgs = [];
      try {
        msgs = provider.validate({ type, caption: effective, media: media.map(providerMediaItem), options }) || [];
      } catch (e) {
        msgs = [String(e.message || e)];
      }
      for (const message of msgs) errors.push({ account_id: acc.id, network: acc.network, message: `${label}: ${message}` });
    }
    if (delivery === 'api') {
      const creator = acc.network === 'tiktok' ? knownCreatorInfo(acc.id) : null;
      for (const message of complianceErrors(acc.network, { type, options, creator })) {
        compliance.push({ account_id: acc.id, network: acc.network, message: `${label}: ${message}` });
      }
    }
    const max = provider?.limits?.captionMax;
    if (max && [...effective].length > max && delivery === 'manual') {
      warnings.push({ account_id: acc.id, network: acc.network, message: `${label}: el texto supera los ${max} caracteres.` });
    }
    targets.push({ acc, caption_override: tCaption, options, delivery });
  }

  // ---- Fecha y estado
  let scheduledAt = parseWhen(body.scheduled_at);
  let status = 'draft';
  if (action !== 'draft') {
    if (!targets.length) throw new HttpError(400, 'Elige al menos una red donde publicar.');
    if (action === 'publish_now') {
      scheduledAt = new Date();
    } else if (action === 'queue') {
      const iso = nextQueueSlot({ accounts: targets.map((t) => t.acc), type, queueTimes: settings.queue_times });
      if (!iso) throw new HttpError(409, 'No hay huecos libres en tu cola en los próximos meses.');
      scheduledAt = new Date(iso);
    } else {
      if (!scheduledAt) throw new HttpError(400, 'Elige la fecha y la hora de publicación.');
      if (scheduledAt.getTime() < Date.now() - 60000) throw new HttpError(400, 'Esa fecha ya ha pasado. Elige una fecha futura o pulsa "Publicar ahora".');
    }
    status = 'scheduled';
    if (fromClaude && settings.claude_mode !== 'schedule') status = 'draft';
  }

  if (claudeTouchedTikTok) {
    warnings.push({ network: 'tiktok', message: 'TikTok: la privacidad, los comentarios/dúos/stitch y la publicidad los elige la persona al aprobar; Claude no puede marcarlos.' });
  }
  if (compliance.length) {
    if (status !== 'draft' && fromClaude) {
      // Claude no puede completar esas elecciones: queda como borrador para que la persona decida.
      status = 'draft';
      warnings.push(...compliance);
    } else if (status !== 'draft') {
      errors.push(...compliance);
    } else {
      warnings.push(...compliance);
    }
  }

  if (errors.length) {
    // En borradores no bloqueamos: avisamos.
    if (status === 'draft') warnings.push(...errors);
    else throw new HttpError(400, errors.length === 1 ? errors[0].message : 'Revisa estos puntos antes de programar:', errors);
  }

  if (status === 'scheduled') {
    const problems = checkLimits({ accounts: targets.map((t) => t.acc), type, scheduledAt: scheduledAt.toISOString(), excludePostId: existing?.id });
    if (problems.length) {
      const what = type === 'story' ? 'stories' : 'publicaciones';
      const msgFor = (x) => {
        const label = getProvider(x.network)?.label || x.network;
        return `El ${fmtDay(scheduledAt)} ya tienes ${x.count} ${what} en ${label}${x.name ? ` (${x.name})` : ''}. El máximo es ${x.max} al día por red. Elige otro día.`;
      };
      throw new HttpError(409, msgFor(problems[0]), problems.map((x) => ({ ...x, message: msgFor(x) })));
    }
  }

  // Cuentas cuya conexión de 30 días habrá caducado a la hora de publicar.
  if (status === 'scheduled' && scheduledAt) {
    for (const t of targets) {
      if (t.delivery !== 'api') continue;
      const due = reconnectDueAt(t.acc);
      if (new Date(due) <= scheduledAt) {
        const label = getProvider(t.acc.network)?.label || t.acc.network;
        warnings.push({
          account_id: t.acc.id, network: t.acc.network,
          message: new Date(due) <= new Date()
            ? `Tu conexión con ${label} ha caducado: reconéctala en Redes o no se publicará.`
            : `Tu conexión con ${label} caduca el ${fmtDay(due)}: reconéctala antes en Redes o no se publicará.`,
        });
      }
    }
  }

  const campaignId = body.campaign_id !== undefined ? body.campaign_id : existing?.campaign_id ?? null;
  if (campaignId && !get('SELECT 1 FROM campaigns WHERE id = ? AND user_id = ?', Number(campaignId), user.id)) {
    throw new HttpError(400, 'Esa campaña no existe.');
  }

  const ts = now();
  const id = tx(() => {
    let postId = existing?.id;
    if (existing) {
      run(
        'UPDATE posts SET type = ?, caption = ?, status = ?, scheduled_at = ?, campaign_id = ?, notes = ?, updated_at = ? WHERE id = ?',
        type, caption, status, scheduledAt ? scheduledAt.toISOString() : null, campaignId, body.notes ?? existing.notes, ts, postId,
      );
      run('DELETE FROM post_media WHERE post_id = ?', postId);
      run('DELETE FROM post_targets WHERE post_id = ?', postId);
    } else {
      const r = run(
        'INSERT INTO posts (user_id, type, caption, status, scheduled_at, created_by, campaign_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        user.id, type, caption, status, scheduledAt ? scheduledAt.toISOString() : null, createdBy, campaignId, body.notes || null, ts, ts,
      );
      postId = Number(r.lastInsertRowid);
    }
    media.forEach((m, i) => run('INSERT INTO post_media (post_id, media_id, position) VALUES (?, ?, ?)', postId, m.id, i));
    for (const t of targets) {
      run(
        'INSERT INTO post_targets (post_id, account_id, caption_override, options, delivery, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        postId, t.acc.id, t.caption_override, JSON.stringify(t.options), t.delivery, 'pending', ts,
      );
    }
    return postId;
  });

  const post = serializePost(get('SELECT * FROM posts WHERE id = ?', id));
  if (fromClaude && action !== 'draft' && status === 'draft') {
    warnings.push({ message: 'Guardado como borrador "Propuesto por Claude": apruébalo en WillyPost para programarlo.' });
  }
  return { post, warnings };
}

/** Programa un borrador (aprobar propuestas de Claude o borradores con fecha). */
export function approvePost(user, id, scheduledAtOverride) {
  const p = getPostForUser(user.id, id);
  if (p.status !== 'draft') throw new HttpError(409, 'Solo se pueden aprobar borradores.');
  const current = serializePost(p);
  const when = scheduledAtOverride || p.scheduled_at;
  if (!when) throw new HttpError(400, 'Ponle fecha y hora antes de aprobar.');
  const whenDate = parseWhen(when);
  // Si la fecha propuesta pasó hace rato, no la publicamos por sorpresa: que el alumno elija otra.
  if (whenDate.getTime() < Date.now() - MISSED_GRACE_MIN * 60000) {
    throw new HttpError(400, `La fecha propuesta (${fmtWhen(whenDate)}) ya ha pasado. Ábrela, elige otra fecha y prográmala.`);
  }
  const action = whenDate.getTime() < Date.now() ? 'publish_now' : 'schedule';
  return savePost(
    { ...user },
    {
      type: p.type, caption: p.caption, media_ids: current.media.map((m) => m.id),
      targets: current.targets.map((t) => ({ account_id: t.account_id, caption: t.caption_override, options: t.options })),
      scheduled_at: when, action, campaign_id: p.campaign_id, notes: p.notes, created_by: 'user',
    },
    p.id,
  );
}

/** Recalcula el estado del post según sus envíos. */
export function recomputeStatus(postId) {
  const p = get('SELECT * FROM posts WHERE id = ?', postId);
  if (!p || p.status === 'draft' || p.status === 'missed') return p?.status;
  const st = all('SELECT status FROM post_targets WHERE post_id = ?', postId).map((r) => r.status);
  if (!st.length) return p.status;
  const done = (s) => ['published', 'manual_done', 'skipped'].includes(s);
  let status;
  if (st.every(done)) status = 'published';
  else if (st.some((s) => s === 'pending' || s === 'publishing')) {
    status = st.some((s) => s !== 'pending') ? 'publishing' : 'scheduled';
  } else if (st.some((s) => s === 'manual_pending')) status = 'manual';
  else status = st.some((s) => s === 'published' || s === 'manual_done') ? 'partial' : 'failed';
  if (status !== p.status) run('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?', status, now(), postId);
  return status;
}

export function duplicatePost(user, id) {
  const p = getPostForUser(user.id, id);
  const s = serializePost(p);
  return savePost(user, {
    type: s.type, caption: s.caption, media_ids: s.media.map((m) => m.id),
    // La privacidad y la publicidad de TikTok se eligen de nuevo en cada publicación (sin valores heredados).
    targets: s.targets.map((t) => ({ account_id: t.account_id, caption: t.caption_override, options: withoutHumanChoices(t.network, t.options) })),
    scheduled_at: null, action: 'draft', campaign_id: p.campaign_id, notes: p.notes,
  });
}
