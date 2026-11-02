import express from 'express';
import { all, get, run, now, tx, parseJson } from '../db.js';
import { HttpError, requireAuth, requireSession } from '../auth.js';
import { recomputeStatus } from '../posts.js';
import { NETWORK_IDS, networkInfo, getProvider, providers } from '../providers/index.js';
import { serializeAccount, saveCandidate } from '../accounts.js';
import { startOAuth, handleCallback, getPendingCandidates, pickCandidates } from '../oauth.js';
import { loadCentralConfig, centralCredsFor } from '../central.js';

export const accountsRouter = express.Router();

const FAMILIES = ['meta', 'instagram', 'threads', 'google', 'tiktok', 'linkedin'];

accountsRouter.get('/api/networks', requireAuth, async (req, res) => {
  const configured = new Set(all('SELECT family FROM credentials WHERE user_id = ?', req.user.id).map((r) => r.family));
  await loadCentralConfig(); // caché de 1 h; sin conexión vale la última copia guardada
  const centralFamilies = new Set(['meta', 'instagram', 'threads', 'google', 'tiktok', 'linkedin'].filter((f) => centralCredsFor(f)));
  res.json(NETWORK_IDS.map((id) => networkInfo(id, configured, centralFamilies)));
});

// ---------- Credenciales ("carnés") ----------
// "extra" completo sustituye al guardado; "config_id" suelto (Facebook Login para empresas) se mezcla con él.
function mergeExtra(body, existing) {
  const base = body?.extra && typeof body.extra === 'object' && !Array.isArray(body.extra) ? { ...body.extra } : parseJson(existing?.extra, {});
  if (body && body.config_id !== undefined) {
    const v = String(body.config_id ?? '').trim();
    if (v && !/^\d{5,30}$/.test(v)) throw new HttpError(400, 'El ID de configuración son solo números. Cópialo de nuevo desde Meta.');
    if (v) base.config_id = v; else delete base.config_id;
  }
  return base;
}

accountsRouter.get('/api/credentials', requireAuth, (req, res) => {
  const rows = all('SELECT family, client_id, extra, updated_at FROM credentials WHERE user_id = ?', req.user.id);
  const map = new Map(rows.map((r) => [r.family, r]));
  res.json(FAMILIES.map((family) => ({
    family,
    configured: map.has(family),
    client_id: map.get(family)?.client_id || null,
    config_id: parseJson(map.get(family)?.extra, {}).config_id || null,
    updated_at: map.get(family)?.updated_at || null,
    networks: Object.values(providers).filter((p) => p.family === family).map((p) => p.id),
  })));
});

accountsRouter.put('/api/credentials/:family', requireSession, (req, res) => {
  const { family } = req.params;
  if (!FAMILIES.includes(family)) throw new HttpError(400, 'Tipo de credencial desconocido.');
  const clientId = String(req.body?.client_id || '').trim();
  const secretIn = req.body?.client_secret != null ? String(req.body.client_secret).trim() : '';
  if (!clientId) throw new HttpError(400, 'Pega el identificador (App ID / Client ID).');
  const existing = get('SELECT * FROM credentials WHERE user_id = ? AND family = ?', req.user.id, family);
  const secret = secretIn || existing?.client_secret;
  if (!secret) throw new HttpError(400, 'Pega también la clave secreta (App Secret / Client Secret).');
  run(
    `INSERT INTO credentials (user_id, family, client_id, client_secret, extra, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, family) DO UPDATE SET client_id = excluded.client_id, client_secret = excluded.client_secret,
       extra = excluded.extra, updated_at = excluded.updated_at`,
    req.user.id, family, clientId, secret,
    // Si no se envía "extra", se conserva el que había (ámbitos, config_id…).
    JSON.stringify(mergeExtra(req.body, existing)), now(),
  );
  res.json({ family, configured: true, client_id: clientId });
});

accountsRouter.delete('/api/credentials/:family', requireSession, (req, res) => {
  run('DELETE FROM credentials WHERE user_id = ? AND family = ?', req.user.id, req.params.family);
  res.json({ ok: true });
});

// ---------- Cuentas ----------
accountsRouter.get('/api/accounts', requireAuth, (req, res) => {
  const order = new Map(NETWORK_IDS.map((id, i) => [id, i]));
  const rows = all('SELECT * FROM accounts WHERE user_id = ?', req.user.id)
    .sort((a, b) => (order.get(a.network) ?? 99) - (order.get(b.network) ?? 99) || a.id - b.id);
  res.json(rows.map(serializeAccount));
});

accountsRouter.post('/api/accounts/connect/:network', requireAuth, async (req, res) => {
  const { network } = req.params;
  const provider = getProvider(network);
  if (provider?.authType === 'apppassword') {
    const handle = String(req.body?.handle || '').trim().replace(/^@/, '');
    const appPassword = String(req.body?.appPassword || '').trim();
    if (!handle || !appPassword) throw new HttpError(400, 'Escribe tu usuario y la contraseña de aplicación.');
    const c = await provider.connectWithPassword({ handle, appPassword });
    const acc = saveCandidate(req.user.id, network, c);
    return res.json({ account: serializeAccount(acc) });
  }
  res.json(await startOAuth(req.user, network));
});

accountsRouter.get('/api/accounts/pending/:id', requireAuth, (req, res) => {
  res.json(getPendingCandidates(req.user, req.params.id));
});

accountsRouter.post('/api/accounts/pending/:id', requireAuth, (req, res) => {
  const saved = pickCandidates(req.user, req.params.id, req.body?.external_ids);
  res.json({ accounts: saved.map(serializeAccount) });
});

accountsRouter.post('/api/accounts/manual', requireAuth, (req, res) => {
  const network = String(req.body?.network || '');
  if (!NETWORK_IDS.includes(network)) throw new HttpError(400, 'Red desconocida.');
  const name = String(req.body?.name || '').trim() || networkInfo(network).label;
  const externalId = `manual:${name.toLowerCase()}`;
  const ts = now();
  run(
    `INSERT INTO accounts (user_id, network, external_id, name, username, mode, connected_at, created_at)
     VALUES (?, ?, ?, ?, NULL, 'manual', ?, ?)
     ON CONFLICT(user_id, network, external_id) DO UPDATE SET name = excluded.name, mode = 'manual'`,
    req.user.id, network, externalId, name, ts, ts,
  );
  const acc = get('SELECT * FROM accounts WHERE user_id = ? AND network = ? AND external_id = ?', req.user.id, network, externalId);
  res.json(serializeAccount(acc));
});

accountsRouter.post('/api/accounts/:id/reconnect', requireAuth, async (req, res) => {
  const acc = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!acc) throw new HttpError(404, 'Esa cuenta no existe.');
  if (acc.mode === 'manual') throw new HttpError(400, 'Esta cuenta está en modo manual: no necesita reconectarse.');
  const provider = getProvider(acc.network);
  if (provider?.authType === 'apppassword') {
    const appPassword = String(req.body?.appPassword || '').trim();
    if (!appPassword) throw new HttpError(400, 'Escribe una contraseña de aplicación nueva.');
    const handle = acc.username || parseJson(acc.meta, {}).handle || acc.external_id;
    const c = await provider.connectWithPassword({ handle, appPassword });
    return res.json({ account: serializeAccount(saveCandidate(req.user.id, acc.network, c)) });
  }
  res.json(await startOAuth(req.user, acc.network, acc.id));
});

accountsRouter.delete('/api/accounts/:id', requireSession, (req, res) => {
  const acc = get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!acc) throw new HttpError(404, 'Esa cuenta no existe.');
  const pending = get(
    `SELECT COUNT(*) AS n FROM post_targets t JOIN posts p ON p.id = t.post_id
     WHERE t.account_id = ? AND t.status IN ('pending', 'manual_pending') AND p.status <> 'draft'`, acc.id,
  ).n;
  if (pending && req.query.force !== '1') {
    throw new HttpError(409, `Esta cuenta tiene ${pending} publicaciones programadas. Si la quitas, se quitarán de esas publicaciones.`, { pending });
  }
  if (get(`SELECT 1 AS x FROM post_targets WHERE account_id = ? AND status = 'publishing'`, acc.id)) {
    throw new HttpError(409, 'Esta cuenta está publicando ahora mismo. Espera un momento y vuelve a intentarlo.');
  }
  const affected = all('SELECT DISTINCT post_id FROM post_targets WHERE account_id = ?', acc.id).map((r) => r.post_id);
  tx(() => {
    run('DELETE FROM accounts WHERE id = ?', acc.id);
    for (const postId of affected) {
      const left = get('SELECT COUNT(*) AS n FROM post_targets WHERE post_id = ?', postId).n;
      const p = get('SELECT status FROM posts WHERE id = ?', postId);
      if (!p) continue;
      if (!left && !['published', 'partial'].includes(p.status)) {
        // Sin redes ya no se puede publicar: la guardamos como borrador para no perder el contenido.
        run(`UPDATE posts SET status = 'draft', updated_at = ? WHERE id = ?`, now(), postId);
      } else if (left) {
        recomputeStatus(postId);
      }
    }
  });
  res.json({ ok: true });
});

// ---------- Callback OAuth (sin /api: vuelve el navegador) ----------
accountsRouter.get('/oauth/callback', async (req, res) => {
  const hash = await handleCallback(req.query);
  res.redirect(`/${hash.startsWith('/#') ? hash.slice(1) : hash}`);
});
