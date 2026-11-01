import { all, get, run, now, parseJson } from './db.js';
import { MISSED_GRACE_MIN, RECONNECT_WARN_DAYS } from './config.js';
import { getProvider } from './providers/index.js';
import { getCreds, providerAccount, accountStatus, ensureFreshToken, daysLeft } from './accounts.js';
import { providerMediaItem, toJpeg } from './media.js';
import { publicUrl } from './share.js';
import { recomputeStatus, effectiveCaption } from './posts.js';
import { notify } from './notify.js';
import { setSetting } from './auth.js';
import { sleep } from './providers/_http.js';

const TICK_MS = 20000;
const RETRY_DELAYS_MIN = [1, 5, 15];
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1; // 1 intento + 3 reintentos (1, 5 y 15 min)
// Si el bucle no se ejecuta durante este tiempo, el ordenador ha estado dormido/hibernando.
const SUSPEND_GAP_MS = 2 * 60 * 1000;
// Una red que no contesta no puede bloquear el programador para siempre.
const PUBLISH_TIMEOUT_MS = Number(process.env.WILLYPOST_PUBLISH_TIMEOUT_MS) || 60 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;
// Errores de red en los que la petición no llegó a salir: reintentar es seguro.
const CONNECT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

let running = false;
let timer = null;
let maintTimer = null;
let maintaining = false;
let lastBeat = Date.now();
const inFlight = new Set();
const busyAccounts = new Set();

const label = (network) => getProvider(network)?.label || network;
const log = (...a) => console.log('[scheduler]', ...a);

function setTarget(id, fields) {
  const keys = Object.keys(fields);
  run(
    `UPDATE post_targets SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => fields[k]), now(), id,
  );
}

class TimeoutError extends Error {}

function withTimeout(promise, ms, message) {
  let t;
  // Si la red responde tarde, ignoramos el resultado (y evitamos un "unhandledRejection").
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new TimeoutError(message)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/** Convierte un error cualquiera en un mensaje para el alumno y decide si se puede reintentar. */
function describeError(e, net) {
  if (e instanceof TimeoutError) return { msg: e.message, retryable: false, auth: false };
  if (e?.name === 'ProviderError' || typeof e?.auth === 'boolean' || typeof e?.retryable === 'boolean' || e?.manual) return { msg: String(e.message), retryable: !!e.retryable, auth: !!e.auth, manual: !!e.manual };
  const code = e?.cause?.code || e?.code;
  if (CONNECT_CODES.has(code) || (e?.name === 'TypeError' && /fetch failed/i.test(e?.message) && CONNECT_CODES.has(e?.cause?.code))) {
    return { msg: `No hay conexión con ${net}. Revisa tu internet: lo volveremos a intentar.`, retryable: true, auth: false };
  }
  if (e?.name === 'TypeError' && /fetch failed/i.test(e?.message)) {
    return { msg: `Se cortó la conexión con ${net} mientras publicábamos. Mira en ${net} si salió; si no, pulsa Reintentar.`, retryable: false, auth: false };
  }
  return {
    msg: `Error inesperado al publicar en ${net}. Pulsa Reintentar; si se repite, avisa a soporte (detalle: ${String(e?.message || e).slice(0, 200)}).`,
    retryable: false, auth: false,
  };
}

/** Publica un envío concreto. Nunca lanza: deja el resultado en la base de datos. */
export async function publishTarget(targetId) {
  if (inFlight.has(targetId)) return;
  inFlight.add(targetId);
  try {
    const t = get('SELECT * FROM post_targets WHERE id = ?', targetId);
    if (!t || !['pending'].includes(t.status)) return;
    const post = get('SELECT * FROM posts WHERE id = ?', t.post_id);
    let acc = get('SELECT * FROM accounts WHERE id = ?', t.account_id);
    if (!post || !acc) return;
    const net = label(acc.network);
    const provider = getProvider(acc.network);

    // Modo manual (o red cuyo módulo no se pudo cargar): avisamos al alumno para que lo publique a mano.
    if (t.delivery === 'manual' || !provider?.publish) {
      setTarget(t.id, { status: 'manual_pending', delivery: 'manual', error: null, next_attempt_at: null });
      recomputeStatus(post.id);
      notify(post.user_id, {
        kind: 'manual', postId: post.id, open: '/#/manual',
        title: `Hora de publicar en ${net}`,
        body: 'Tienes el texto y los archivos listos en "Para publicar a mano".',
      });
      return;
    }

    const status = accountStatus(acc);
    if (status === 'expired') {
      setTarget(t.id, { status: 'failed', error: `Tu conexión con ${net} ha caducado (30 días). Reconéctala en Redes y pulsa Reintentar.`, next_attempt_at: null });
      recomputeStatus(post.id);
      notify(post.user_id, { kind: 'error', postId: post.id, open: '/#/redes', title: `Reconecta ${net}`, body: 'Han pasado 30 días desde que la conectaste.' });
      return;
    }

    const attempts = t.attempts + 1;
    setTarget(t.id, { status: 'publishing', attempts });
    recomputeStatus(post.id);

    try {
      acc = await withTimeout(ensureFreshToken(acc), REFRESH_TIMEOUT_MS, `${net} no ha respondido al renovar la conexión. Pulsa Reintentar en un rato.`);
      const media = all(
        'SELECT m.* FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ? ORDER BY pm.position',
        post.id,
      ).map(providerMediaItem);
      const ctx = {
        publicUrl,
        toJpeg,
        sleep,
        log: (...a) => console.log(`[${acc.network}]`, ...a),
      };
      const result = await withTimeout(
        Promise.resolve().then(() => provider.publish({
          account: providerAccount(acc),
          creds: getCreds(acc.user_id, provider.family),
          type: post.type,
          caption: effectiveCaption(post, t),
          media,
          options: parseJson(t.options, {}),
          ctx,
        })),
        PUBLISH_TIMEOUT_MS,
        `${net} no ha respondido en ${Math.max(1, Math.round(PUBLISH_TIMEOUT_MS / 60000))} minutos. Mira en ${net} si la publicación salió; si no, pulsa Reintentar.`,
      );
      setTarget(t.id, {
        status: 'published',
        external_id: result?.external_id ? String(result.external_id) : null,
        external_url: result?.url || null,
        warning: result?.warning || null,
        error: null,
        published_at: now(),
        next_attempt_at: null,
      });
      if (acc.last_error) run('UPDATE accounts SET last_error = NULL WHERE id = ?', acc.id);
      log(`publicado post ${post.id} en ${acc.network}`);
      notify(post.user_id, {
        kind: 'published', postId: post.id, desktop: false,
        title: `Publicado en ${net}`,
        body: result?.warning || (post.caption || '').slice(0, 80),
      });
    } catch (e) {
      const { msg, retryable, auth, manual } = describeError(e, net);
      console.error(`[scheduler] fallo post ${post.id} en ${acc.network}:`, e?.stack || e);
      if (auth) {
        run('UPDATE accounts SET last_error = ? WHERE id = ?', msg, acc.id);
      }
      if (manual) {
        // La red no aceptó este formato por API: pasa a "Para publicar a mano".
        setTarget(t.id, { status: 'manual_pending', delivery: 'manual', warning: msg, error: null, next_attempt_at: null });
        recomputeStatus(post.id);
        notify(post.user_id, {
          kind: 'manual', postId: post.id, open: '/#/manual',
          title: `Hora de publicar en ${net}`,
          body: 'Esta vez hay que subirlo a mano: lo tienes listo en "Para publicar a mano".',
        });
        return;
      }
      if (retryable && !auth && attempts < MAX_ATTEMPTS) {
        const next = new Date(Date.now() + RETRY_DELAYS_MIN[attempts - 1] * 60000).toISOString();
        setTarget(t.id, { status: 'pending', error: msg, next_attempt_at: next });
      } else {
        setTarget(t.id, { status: 'failed', error: auth ? `${msg} — Reconecta ${net} en Redes y pulsa Reintentar.` : msg, next_attempt_at: null });
        notify(post.user_id, {
          kind: 'error', postId: post.id, open: '/#/lista',
          title: `No se pudo publicar en ${net}`,
          body: msg.slice(0, 180),
        });
      }
    }
    recomputeStatus(post.id);
  } catch (e) {
    // Error de base de datos u otro imprevisto: lo dejamos registrado sin tumbar el programador.
    console.error('[scheduler] error publicando el envío', targetId, e);
  } finally {
    inFlight.delete(targetId);
  }
}

/**
 * Al arrancar: si WillyPost se cerró (o se colgó el ordenador) en mitad de una publicación,
 * esos envíos se quedarían "publicando" para siempre. No sabemos si llegaron a salir, así que
 * NO los repetimos solos (evita duplicados): pasan a fallidos con instrucciones claras.
 */
export function recoverInterrupted() {
  const rows = all(
    `SELECT t.id, t.post_id, p.user_id, a.network FROM post_targets t
     JOIN posts p ON p.id = t.post_id JOIN accounts a ON a.id = t.account_id
     WHERE t.status = 'publishing'`,
  ).filter((r) => !inFlight.has(r.id));
  const byUser = new Map();
  for (const r of rows) {
    const net = label(r.network);
    setTarget(r.id, {
      status: 'failed',
      error: `WillyPost se cerró mientras publicaba en ${net}. Mira en ${net} si la publicación salió; si no, pulsa Reintentar.`,
      next_attempt_at: null,
    });
    recomputeStatus(r.post_id);
    byUser.set(r.user_id, r.post_id);
  }
  for (const [userId, postId] of byUser) {
    notify(userId, {
      kind: 'error', postId, open: '/#/lista',
      title: 'Revisa una publicación interrumpida',
      body: 'WillyPost se cerró mientras publicaba. Comprueba si salió y, si no, pulsa Reintentar.',
    });
  }
  // Posts que se quedaron en "publicando" sin ningún envío en marcha.
  for (const p of all(`SELECT id FROM posts WHERE status = 'publishing'`)) recomputeStatus(p.id);
  return rows.length;
}

/** Marca como "missed" lo que debía haberse publicado con el ordenador apagado o dormido. */
export function detectMissed() {
  const cutoff = new Date(Date.now() - MISSED_GRACE_MIN * 60000).toISOString();
  const rows = all(
    `SELECT DISTINCT p.id, p.user_id FROM posts p JOIN post_targets t ON t.post_id = p.id
     WHERE p.status IN ('scheduled', 'publishing') AND p.scheduled_at < ? AND t.status = 'pending'
       AND (t.attempts = 0 OR t.next_attempt_at < ?)`,
    cutoff, cutoff,
  ).filter((r) => !all(`SELECT id FROM post_targets WHERE post_id = ?`, r.id).some((t) => inFlight.has(t.id)));
  const byUser = new Map();
  for (const r of rows) {
    run(`UPDATE posts SET status = 'missed', updated_at = ? WHERE id = ?`, now(), r.id);
    byUser.set(r.user_id, (byUser.get(r.user_id) || 0) + 1);
  }
  for (const [userId, n] of byUser) {
    notify(userId, {
      kind: 'missed', open: '/#/',
      title: n === 1 ? 'Una publicación no salió' : `${n} publicaciones no salieron`,
      body: 'El ordenador estaba apagado o en reposo a su hora. Entra en WillyPost para publicarlas ahora, reprogramarlas u omitirlas.',
    });
  }
  return rows.length;
}

async function runChain(accountId, ids) {
  busyAccounts.add(accountId);
  try {
    for (const id of ids) await publishTarget(id);
  } catch (e) {
    console.error('[scheduler] error en la cola de la cuenta', accountId, e);
  } finally {
    busyAccounts.delete(accountId);
  }
}

/**
 * Busca envíos pendientes y los publica: en paralelo entre cuentas, de uno en uno por cuenta.
 * Una cuenta lenta (vídeo grande) no bloquea a las demás ni a los siguientes ciclos.
 * Devuelve una promesa que se resuelve cuando terminan los envíos lanzados en este ciclo.
 */
export async function tick() {
  if (running) return;
  running = true;
  let chains = [];
  try {
    const ts = now();
    const due = all(
      `SELECT t.id, t.account_id FROM post_targets t JOIN posts p ON p.id = t.post_id
       WHERE p.status IN ('scheduled', 'publishing', 'partial', 'manual') AND p.scheduled_at <= ?
         AND t.status = 'pending' AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= ?)
       ORDER BY p.scheduled_at, t.id LIMIT 50`,
      ts, ts,
    );
    const byAccount = new Map();
    for (const { id, account_id: acc } of due) {
      if (busyAccounts.has(acc) || inFlight.has(id)) continue;
      if (!byAccount.has(acc)) byAccount.set(acc, []);
      byAccount.get(acc).push(id);
    }
    chains = [...byAccount].map(([acc, ids]) => runChain(acc, ids));
  } catch (e) {
    console.error('[scheduler] error en el ciclo:', e);
  } finally {
    running = false;
  }
  await Promise.all(chains);
}

/** Solo para pruebas: simula cuándo fue el último latido. */
export function setLastBeat(at) { lastBeat = at; }

/** Latido del programador. Si ha pasado mucho desde el anterior, el ordenador estaba dormido. */
export function heartbeat(at = Date.now()) {
  const gap = at - lastBeat;
  lastBeat = at;
  if (gap > SUSPEND_GAP_MS) {
    try {
      const n = detectMissed();
      if (n) log(`el ordenador estuvo en reposo ${Math.round(gap / 60000)} min: ${n} publicaciones atrasadas marcadas como "missed"`);
    } catch (e) {
      console.error('[scheduler] error al revisar atrasadas:', e);
    }
  }
  return tick().catch((e) => console.error('[scheduler]', e));
}

/** Mantenimiento: refresco preventivo de tokens y avisos de reconexión. */
export async function maintenance() {
  if (maintaining) return;
  maintaining = true;
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Los avisos de días anteriores ya no sirven.
    run(`DELETE FROM settings WHERE key LIKE 'warned\\_%' ESCAPE '\\' AND key NOT LIKE ?`, `%\\_${today}`);
    for (const acc of all(`SELECT * FROM accounts WHERE mode = 'api'`)) {
      try {
        const st = accountStatus(acc);
        const net = label(acc.network);
        if (st === 'expiring' || st === 'expired') {
          const key = `warned_${acc.id}_${today}`;
          const already = get('SELECT 1 AS x FROM settings WHERE user_id = ? AND key = ?', acc.user_id, key);
          if (!already) {
            setSetting(acc.user_id, key, '1');
            const d = Math.max(1, daysLeft(acc));
            notify(acc.user_id, {
              kind: 'reconnect', open: '/#/redes',
              title: st === 'expired' ? `${net}: conexión caducada` : `${net}: reconecta en ${d} día${d === 1 ? '' : 's'}`,
              body: st === 'expired'
                ? 'Por seguridad, cada red se reconecta cada 30 días. Hasta que lo hagas no se publicará nada en ella.'
                : 'Por seguridad, cada red se reconecta cada 30 días. Es un clic.',
            });
          }
        }
        // Refresco preventivo de tokens que caducan en menos de 7 días.
        const exp = acc.token_expires_at ? new Date(acc.token_expires_at).getTime() : null;
        if (st !== 'expired' && exp && exp < Date.now() + 7 * 86400000) {
          try {
            await withTimeout(ensureFreshToken(acc, { force: true }), REFRESH_TIMEOUT_MS, 'Tiempo agotado al renovar la conexión.');
          } catch (e) {
            // Solo marcamos la cuenta con error si la red rechaza la conexión (no por estar sin internet un rato).
            if (e?.auth) run('UPDATE accounts SET last_error = ? WHERE id = ?', String(e.message || e), acc.id);
            else console.warn(`[maintenance] no se pudo renovar ${acc.network} #${acc.id}:`, e?.message || e);
          }
        }
      } catch (e) {
        console.error('[maintenance] cuenta', acc.id, e);
      }
    }
    // Limpieza de flujos OAuth abandonados y de avisos leídos antiguos.
    run(`DELETE FROM oauth_pending WHERE created_at < ?`, new Date(Date.now() - 86400000).toISOString());
    run(`DELETE FROM notifications WHERE read = 1 AND created_at < ?`, new Date(Date.now() - 90 * 86400000).toISOString());
  } finally {
    maintaining = false;
  }
}

export function startScheduler() {
  try {
    const interrupted = recoverInterrupted();
    if (interrupted) log(`${interrupted} envíos interrumpidos al cerrarse WillyPost: marcados para revisar`);
    const missed = detectMissed();
    if (missed) log(`${missed} publicaciones atrasadas marcadas como "missed"`);
  } catch (e) {
    console.error('[scheduler] error al arrancar:', e);
  }
  lastBeat = Date.now();
  tick().catch((e) => console.error('[scheduler]', e));
  timer = setInterval(() => heartbeat(), TICK_MS);
  maintenance().catch((e) => console.error('[maintenance]', e));
  maintTimer = setInterval(() => maintenance().catch((e) => console.error('[maintenance]', e)), 3600000);
  return timer;
}

export function stopScheduler() {
  clearInterval(timer);
  clearInterval(maintTimer);
  timer = null;
  maintTimer = null;
}

export { RECONNECT_WARN_DAYS };
