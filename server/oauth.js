import crypto from 'node:crypto';
import { get, run, now, parseJson } from './db.js';
import { HttpError } from './auth.js';
import { getProvider } from './providers/index.js';
import { getCreds, saveCandidate } from './accounts.js';
import { redirectUriFor } from './config.js';

// Una conexión a medio hacer (o una elección de Páginas sin terminar) caduca a los 30 min: así no
// quedan tokens guardados en la base de datos y un enlace de retorno antiguo no vale.
export const PENDING_TTL_MS = 30 * 60 * 1000;
const isStale = (p) => !p.created_at || Date.parse(p.created_at) < Date.now() - PENDING_TTL_MS;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce(provider) {
  const verifier = b64url(crypto.randomBytes(48));
  const digest = crypto.createHash('sha256').update(verifier).digest();
  // TikTok (Login Kit Desktop) pide el reto en hexadecimal.
  const challenge = provider.pkceMethod === 'tiktok-hex' ? digest.toString('hex') : b64url(digest);
  return { verifier, challenge };
}

/** Empieza un flujo OAuth y devuelve la URL a la que mandar al alumno. */
export function startOAuth(user, network, reconnectAccountId = null) {
  const provider = getProvider(network);
  if (!provider) throw new HttpError(400, 'Esta red no está disponible por API en esta versión. Añádela en modo manual.');
  if (provider.authType !== 'oauth') throw new HttpError(400, 'Esta red no usa este tipo de conexión.');
  run('DELETE FROM oauth_pending WHERE created_at < ?', new Date(Date.now() - PENDING_TTL_MS).toISOString());
  const creds = getCreds(user.id, provider.family);
  if (!creds?.client_id) {
    throw new HttpError(400, `Primero configura tu "carné" de ${provider.label}: pulsa "Configurar carné" y sigue los pasos.`);
  }
  const state = b64url(crypto.randomBytes(24));
  const { verifier, challenge } = pkce(provider);
  run(
    'INSERT INTO oauth_pending (user_id, network, state, code_verifier, account_id_reconnect, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    user.id, network, state, verifier, reconnectAccountId, now(),
  );
  const authUrl = provider.getAuthUrl({
    creds, redirectUri: redirectUriFor(provider), state, codeChallenge: challenge, codeVerifier: verifier,
  });
  return { authUrl };
}

const CANCEL_CODES = new Set(['access_denied', 'user_cancelled_login', 'user_cancelled_authorize', 'user_denied', 'consent_required']);

/** Mensaje en español para un error devuelto por la red en la URL de retorno. */
export function friendlyOAuthError(label, error, description) {
  const e = String(error || '');
  const d = String(description || '');
  if (!e && !d) return `${label}: has cancelado la conexión. Pulsa Conectar para intentarlo de nuevo.`;
  if (CANCEL_CODES.has(e.toLowerCase()) || /denied|cancel/i.test(d)) {
    return `${label}: has cancelado la conexión o no has aceptado los permisos. Pulsa Conectar y acepta todos los permisos.`;
  }
  if (/redirect_uri|redirect uri/i.test(d + e)) {
    return `${label}: la dirección de redirección no coincide con la de tu app. Cópiala otra vez desde el asistente de Redes y pégala exactamente igual en la web de ${label}.`;
  }
  if (/scope|permission/i.test(d + e)) {
    return `${label}: tu app no tiene activado alguno de los permisos que pide WillyPost. Revisa la sección de permisos de la guía de ${label}.`;
  }
  if (/invalid_client|client_id|client_key|app id|application/i.test(d + e)) {
    return `${label}: el ID de tu app no es correcto o la app no está activa. Revisa el ID y el secreto de tu carné.`;
  }
  if (/developer|tester|role/i.test(d + e)) {
    return `${label}: tu usuario no tiene permiso para usar esta app (falta aceptar la invitación de probador o tener un rol en la app).`;
  }
  return `${label} ha devuelto un error al conectar (${(d || e).slice(0, 160)}). Revisa la guía de ${label} y vuelve a pulsar Conectar.`;
}

/** Mensaje cuando al reconectar la red devuelve una cuenta distinta de la que se quería reconectar. */
export function reconnectMismatchMessage(label, acc, candidates = []) {
  const want = acc.username ? `${acc.name || acc.username} (${acc.username})` : (acc.name || 'la cuenta que querías reconectar');
  const got = candidates.length === 1 ? (candidates[0].username || candidates[0].name) : null;
  return `Has entrado en ${label} con otra cuenta${got ? ` (${got})` : ''}, no con ${want}. Cierra sesión en ${label} (o abre una ventana de incógnito) y vuelve a pulsar Reconectar entrando con ${want}. No hemos cambiado nada.`;
}

const stripTokens = (c) => ({ external_id: String(c.external_id), name: c.name, username: c.username, avatar_url: c.avatar_url });

/** Procesa el callback. Devuelve la ruta (hash) a la que redirigir. */
export async function handleCallback(query) {
  const { code, state, error, error_description: errorDescription } = query;
  const pending = state ? get('SELECT * FROM oauth_pending WHERE state = ?', String(state)) : null;
  if (!pending) return `/#/redes?error=${encodeURIComponent('La conexión ha caducado o ya se usó. Vuelve a pulsar Conectar.')}`;
  const provider = getProvider(pending.network);
  if (isStale(pending)) {
    run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
    return `/#/redes?error=${encodeURIComponent('La conexión ha caducado (pasaron más de 30 minutos). Vuelve a pulsar Conectar.')}`;
  }
  if (pending.candidates) {
    // La elección de Páginas ya está hecha y esperando: un segundo retorno con el mismo "state" no hace nada.
    return `/#/redes?pick=${pending.id}`;
  }
  if (error || !code) {
    run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
    return `/#/redes?error=${encodeURIComponent(friendlyOAuthError(provider?.label || pending.network, error, errorDescription))}`;
  }
  try {
    const creds = getCreds(pending.user_id, provider.family);
    const candidates = await provider.exchangeCode({
      creds, redirectUri: redirectUriFor(provider), code: String(code), codeVerifier: pending.code_verifier,
    });
    if (!candidates?.length) {
      run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
      const what = pending.network === 'facebook' ? 'ninguna Página de Facebook que administres'
        : pending.network === 'gbp' ? 'ninguna ficha de Google Business' : 'ninguna cuenta';
      return `/#/redes?error=${encodeURIComponent(`${provider.label}: no hemos encontrado ${what}.`)}`;
    }
    // Reconexión: actualizamos la cuenta concreta si aparece entre las candidatas.
    if (pending.account_id_reconnect) {
      const acc = get('SELECT * FROM accounts WHERE id = ?', pending.account_id_reconnect);
      const match = acc && candidates.find((c) => String(c.external_id) === acc.external_id);
      if (match) {
        saveCandidate(pending.user_id, pending.network, match);
        run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
        return `/#/redes?ok=${pending.network}`;
      }
      if (acc) {
        // Estaba iniciada otra cuenta de la red: NO se añade en silencio como cuenta nueva.
        run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
        return `/#/redes?error=${encodeURIComponent(reconnectMismatchMessage(provider.label, acc, candidates))}`;
      }
    }
    if (candidates.length === 1) {
      saveCandidate(pending.user_id, pending.network, candidates[0]);
      run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
      return `/#/redes?ok=${pending.network}`;
    }
    run('UPDATE oauth_pending SET candidates = ? WHERE id = ?', JSON.stringify(candidates), pending.id);
    return `/#/redes?pick=${pending.id}`;
  } catch (e) {
    run('DELETE FROM oauth_pending WHERE id = ?', pending.id);
    console.error('[oauth]', pending.network, e);
    // Los ProviderError ya traen un mensaje en español; cualquier otro fallo interno se explica en genérico.
    const msg = e?.name === 'ProviderError' ? e.message
      : `No hemos podido completar la conexión con ${provider?.label || pending.network}. Vuelve a pulsar Conectar; si se repite, revisa el ID y el secreto de tu carné.`;
    return `/#/redes?error=${encodeURIComponent(msg)}`;
  }
}

export function getPendingCandidates(user, id) {
  const p = get('SELECT * FROM oauth_pending WHERE id = ? AND user_id = ?', Number(id), user.id);
  if (p && isStale(p)) { run('DELETE FROM oauth_pending WHERE id = ?', p.id); throw new HttpError(404, 'Esta selección ha caducado. Vuelve a pulsar Conectar.'); }
  if (!p || !p.candidates) throw new HttpError(404, 'Esta selección ha caducado. Vuelve a pulsar Conectar.');
  return { network: p.network, candidates: parseJson(p.candidates, []).map(stripTokens) };
}

export function pickCandidates(user, id, externalIds) {
  const p = get('SELECT * FROM oauth_pending WHERE id = ? AND user_id = ?', Number(id), user.id);
  if (p && isStale(p)) { run('DELETE FROM oauth_pending WHERE id = ?', p.id); throw new HttpError(404, 'Esta selección ha caducado. Vuelve a pulsar Conectar.'); }
  if (!p || !p.candidates) throw new HttpError(404, 'Esta selección ha caducado. Vuelve a pulsar Conectar.');
  const wanted = new Set((externalIds || []).map(String));
  const chosen = parseJson(p.candidates, []).filter((c) => wanted.has(String(c.external_id)));
  if (!chosen.length) throw new HttpError(400, 'Elige al menos una.');
  const saved = chosen.map((c) => saveCandidate(user.id, p.network, c));
  run('DELETE FROM oauth_pending WHERE id = ?', p.id);
  return saved;
}
