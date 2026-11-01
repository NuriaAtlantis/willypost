import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plug, RefreshCw, Trash2, Hand, KeyRound, ExternalLink, BookOpen, Check, X, Info, TriangleAlert, ShieldCheck, Link2, Plus, PartyPopper,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { replaceRoute } from '../lib/router.js';
import { fmtDayShort } from '../lib/format.js';
import { ACCOUNT_STATUS, DOCS_BASE, FAMILY_INFO, NET_ORDER, TYPES } from '../lib/constants.js';
import { Button, PageHeader, Badge, Modal, Field, CopyButton, Ring, Spinner, useConfirm, Empty } from '../components/ui.jsx';
import { NetIcon, netColor } from '../components/NetIcon.jsx';

const SUPPORT_LABEL = { post: 'Post', carousel: 'Carrusel', reel: 'Reel / vídeo', story: 'Story' };

export default function Networks({ query }) {
  const app = useApp();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [creds, setCreds] = useState([]);
  const [wizard, setWizard] = useState(null); // network
  const [pick, setPick] = useState(null); // pending id
  const [manual, setManual] = useState(null); // network
  const [bsky, setBsky] = useState(null); // { network, account? }
  const [busy, setBusy] = useState(null);

  const loadCreds = useCallback(() => api.get('/api/credentials').then(setCreds).catch(() => {}), []);
  useEffect(() => { loadCreds(); app.refreshAccounts(); app.refreshNetworks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resultado de OAuth: ?ok= ?error= ?pick=
  useEffect(() => {
    if (query.ok) {
      const n = app.netById(query.ok);
      toast.success(`${n ? n.label : query.ok} conectada. Recuerda: hay que reconectarla cada 30 días.`);
      app.refreshAccounts();
      replaceRoute('/redes');
    } else if (query.error) {
      toast.error(query.error, 12000);
      replaceRoute('/redes');
    } else if (query.pick) {
      setPick(query.pick);
      replaceRoute('/redes');
    }
  }, [query.ok, query.error, query.pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const list = [...app.networks];
    list.sort((a, b) => {
      const ia = NET_ORDER.indexOf(a.id); const ib = NET_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return list;
  }, [app.networks]);

  const startOAuth = async (n, account) => {
    setBusy(account ? 'r' + account.id : n.id);
    try {
      const r = account
        ? await api.post(`/api/accounts/${account.id}/reconnect`)
        : await api.post(`/api/accounts/connect/${n.id}`);
      if (r && r.authUrl) {
        toast.info(`Te llevo a ${n.label} para que autorices el acceso…`, 3000);
        window.location.href = r.authUrl;
      } else if (r && r.account) { toast.success(`${n.label} conectada.`); app.refreshAccounts(); }
    } catch (e) { toast.error(e.message); setBusy(null); }
  };

  const remove = async (a) => {
    const ok = await confirm({ title: `Desconectar ${a.name}`, text: 'Se quitará esta cuenta de WillyPost. Las publicaciones pendientes en ella no se enviarán. Puedes volver a conectarla cuando quieras.', ok: 'Sí, desconectar', danger: true });
    if (!ok) return;
    try {
      try {
        await api.del(`/api/accounts/${a.id}`);
      } catch (e) {
        if (e.status !== 409) throw e;
        // Tiene publicaciones programadas: se lo explicamos y pedimos confirmación antes de forzar.
        const force = await confirm({
          title: `${a.name} tiene publicaciones programadas`,
          text: 'Si la desconectas, esas publicaciones dejarán de enviarse a esta cuenta (las que solo iban a ella pasarán a borradores). No se borra ningún texto ni archivo. ¿Quieres desconectarla igualmente?',
          ok: 'Sí, desconectar', cancel: 'No, dejarla', danger: true,
        });
        if (!force) return;
        await api.del(`/api/accounts/${a.id}?force=1`);
      }
      toast.success('Cuenta desconectada.');
      app.refreshAccounts();
      app.bump();
    } catch (e) { toast.error(e.message); }
  };

  const connectedCount = app.accounts.length;

  return (
    <div>
      {confirmEl}
      <PageHeader eyebrow="Tus redes sociales" title="Conecta tus" pill="redes"
        sub="Cada red se conecta con tu propio “carné” de desarrollador: es gratis, lo creas una vez y las claves se quedan solo en tu ordenador." />

      <div className="notice info big">
        <Info size={20} />
        <div><b>Cada conexión dura 30 días.</b> Es una norma de las propias redes. Te aviso desde el día 25 y con un clic la renuevas. ¿Prefieres no configurar nada? Cualquier red se puede añadir en <b>modo manual</b>: te aviso a la hora y publicas tú en dos clics.</div>
      </div>

      {app.networks.length === 0 ? <Spinner label="Cargando redes…" /> : (
        <div className="net-grid">
          {sorted.map((n) => {
            const accs = app.accounts.filter((a) => a.network === n.id);
            const isPwd = n.authType === 'apppassword';
            const configured = isPwd || n.credsConfigured;
            return (
              <article className="card net-card" key={n.id}>
                <header>
                  <NetIcon id={n.id} size={48} color={netColor(n.id, app.networks)} />
                  <div className="net-title">
                    <h3>{n.label}</h3>
                    <small>{accs.length ? `${accs.length} ${accs.length === 1 ? 'cuenta' : 'cuentas'}` : 'Sin conectar'}</small>
                  </div>
                  {n.needsApproval ? <Badge tone="amber" icon={ShieldCheck}>Requiere aprobación</Badge> : null}
                </header>
                {n.notes && !(n.needsApproval && n.notes.slice(0, 40) === n.needsApproval.slice(0, 40)) ? <p className="net-notes">{n.notes}</p> : null}
                <ul className="support">
                  {TYPES.map((t) => {
                    const ok = n.supports && n.supports[t.id];
                    return <li key={t.id} className={ok ? 'yes' : 'no'} title={ok ? 'Se publica solo' : 'Irá en modo manual'}>{ok ? <Check size={13} /> : <Hand size={12} />} {SUPPORT_LABEL[t.id]}</li>;
                  })}
                </ul>
                {n.needsApproval ? <div className="notice warn small"><TriangleAlert size={16} /><div>{n.needsApproval}</div></div> : null}

                {accs.length > 0 && (
                  <div className="acc-list">
                    {accs.map((a) => {
                      const st = ACCOUNT_STATUS[a.status] || ACCOUNT_STATUS.ok;
                      return (
                        <div className="acc-row" key={a.id}>
                          {a.mode === 'manual' ? <span className="acc-manual"><Hand size={20} /></span> : <Ring days={a.days_left} />}
                          <div className="acc-info">
                            <b>{a.name}</b>
                            <small>{a.username ? '@' + a.username.replace('@', '') : st.label}{a.mode !== 'manual' && a.reconnect_due_at ? ` · reconectar antes del ${fmtDayShort(a.reconnect_due_at)}` : ''}</small>
                            {a.last_error ? <small className="err">{a.last_error}</small> : null}
                          </div>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <div className="acc-actions">
                            {a.mode !== 'manual' && (
                              <Button size="sm" variant={a.status === 'ok' ? 'secondary' : 'primary'} icon={RefreshCw} loading={busy === 'r' + a.id}
                                onClick={() => (isPwd ? setBsky({ network: n, account: a }) : startOAuth(n, a))}>Reconectar</Button>
                            )}
                            <button className="icon-btn danger" title="Desconectar" aria-label="Desconectar" onClick={() => remove(a)}><Trash2 size={17} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <footer>
                  {isPwd ? (
                    <Button icon={Plug} onClick={() => setBsky({ network: n })}>{accs.length ? 'Añadir otra cuenta' : 'Conectar con contraseña de aplicación'}</Button>
                  ) : configured ? (
                    <>
                      <Button icon={Plug} loading={busy === n.id} onClick={() => startOAuth(n)}>{accs.length ? 'Añadir otra cuenta' : `Conectar ${n.label}`}</Button>
                      <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => setWizard(n)}>Mi carné</Button>
                    </>
                  ) : (
                    <Button icon={KeyRound} onClick={() => setWizard(n)}>Configura tu carné</Button>
                  )}
                  <button className="link" onClick={() => setManual(n)}><Hand size={14} /> Añadir en modo manual</button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {connectedCount === 0 && app.accountsLoaded && app.networks.length > 0 && (
        <p className="muted center mt-lg">Empieza por la red donde más publicas. Puedes añadir las demás cuando quieras.</p>
      )}

      {wizard && <CredentialWizard network={wizard} networks={app.networks} creds={creds}
        onClose={() => setWizard(null)}
        onSaved={async (connectNow) => { await loadCreds(); const n = wizard; await app.refreshNetworks(); setWizard(null); if (connectNow) startOAuth(n); }} />}
      {pick && <PickModal id={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); app.refreshAccounts(); app.bump(); }} />}
      {manual && <ManualModal network={manual} onClose={() => setManual(null)} onDone={() => { setManual(null); app.refreshAccounts(); }} />}
      {bsky && <BlueskyModal network={bsky.network} account={bsky.account} onClose={() => setBsky(null)} onDone={() => { setBsky(null); app.refreshAccounts(); }} />}
    </div>
  );
}

function CredentialWizard({ network, networks, creds, onClose, onSaved }) {
  const toast = useToast();
  const info = FAMILY_INFO[network.family] || {
    title: `Carné de ${network.label}`, portal: '', portalLabel: 'el portal de desarrolladores', idLabel: 'ID de cliente', secretLabel: 'Secreto de cliente',
    steps: ['Entra en el portal de desarrolladores y crea una app.', 'Pega la URI de redirección que ves abajo.', 'Copia el ID y el secreto y pégalos aquí.'],
  };
  const current = creds.find((c) => c.family === network.family);
  const sameFamily = networks.filter((n) => n.family === network.family);
  const [id, setId] = useState(current && current.client_id ? current.client_id : '');
  const [secret, setSecret] = useState('');
  const [configId, setConfigId] = useState(current && current.config_id ? current.config_id : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const guide = DOCS_BASE + (network.guide || `guias/${network.id}.html`);

  const save = async (connectNow) => {
    setErr('');
    if (!id.trim() && !secret.trim()) { setErr(`Faltan datos: pega el “${info.idLabel}” y la “${info.secretLabel}”.`); return; }
    if (!id.trim()) { setErr(`Falta el “${info.idLabel}”.`); return; }
    if (!secret.trim()) { setErr(`Falta la “${info.secretLabel}”.`); return; }
    setBusy(true);
    try {
      const body = { client_id: id.trim(), client_secret: secret.trim() };
      if (network.family === 'meta') body.config_id = configId.trim();
      await api.put(`/api/credentials/${network.family}`, body);
      toast.success('Carné guardado en tu ordenador.');
      await onSaved(connectNow);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const del = async () => {
    try { await api.del(`/api/credentials/${network.family}`); toast.success('Carné eliminado.'); await onSaved(false); } catch (e) { setErr(e.message); }
  };

  return (
    <Modal wide onClose={onClose} title={info.title} subtitle={`Sirve para: ${sameFamily.map((n) => n.label).join(' y ')}. Es como un “carné de identidad” que permite a WillyPost publicar por ti. Solo lo haces una vez.`}
      footer={(
        <>
          {current && current.configured ? <Button variant="ghost" icon={Trash2} onClick={del}>Quitar carné</Button> : null}
          <span className="spacer" />
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button variant="secondary" loading={busy} onClick={() => save(false)}>Guardar</Button>
          <Button loading={busy} icon={Plug} onClick={() => save(true)}>Guardar y conectar</Button>
        </>
      )}>
      <div className="wizard">
        <div className="wz-step">
          <i>1</i>
          <div>
            <h4>Abre el portal de desarrolladores</h4>
            <p>{info.steps[0]}</p>
            <div className="btn-row">
              {info.portal ? <a className="btn btn-secondary btn-sm" href={info.portal} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Abrir {info.portalLabel}</a> : null}
              <a className="btn btn-ghost btn-sm" href={guide} target="_blank" rel="noreferrer"><BookOpen size={15} /> Guía paso a paso</a>
            </div>
          </div>
        </div>
        <div className="wz-step">
          <i>2</i>
          <div>
            <h4>Crea la app y pega esta dirección de redirección</h4>
            <ul className="wz-list">{info.steps.slice(1, -1).map((s) => <li key={s}>{s}</li>)}</ul>
            <div className="copy-line">
              <code>{network.redirectUri || 'Cargando…'}</code>
              {network.redirectUri ? <CopyButton text={network.redirectUri} label="Copiar" /> : null}
            </div>
            <small className="muted">{network.redirect === 'relay'
              ? 'Esta red exige una dirección https. Es una página de la Academia que te devuelve a tu ordenador: no recibe tus claves.'
              : 'Esta dirección apunta a tu propio ordenador (localhost).'}</small>
          </div>
        </div>
        <div className="wz-step">
          <i>3</i>
          <div>
            <h4>Pega tus claves</h4>
            <p>{info.steps[info.steps.length - 1]}</p>
            <div className="row-2">
              <Field label={info.idLabel}><input className="input mono" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck="false" data-autofocus /></Field>
              <Field label={info.secretLabel} hint={current && current.configured ? 'Por seguridad no se muestra la guardada. Pega la clave de nuevo para actualizar.' : undefined}>
                <input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck="false" />
              </Field>
            </div>
            {network.family === 'meta' ? (
              <details className="mt" open={Boolean(configId)}>
                <summary className="muted">Opción avanzada: solo si Facebook te da error de permisos al conectar</summary>
                <Field label="ID de configuración (Facebook Login para empresas)" hint="Déjalo vacío salvo que la guía te diga que lo rellenes. Lo encuentras en tu app de Meta, en Facebook Login para empresas → Configuraciones.">
                  <input className="input mono" value={configId} onChange={(e) => setConfigId(e.target.value)} autoComplete="off" spellCheck="false" inputMode="numeric" />
                </Field>
              </details>
            ) : null}
            {err && <div className="notice error"><div>{err}</div></div>}
            <small className="muted"><ShieldCheck size={13} /> Las claves se guardan solo en tu ordenador y no se envían a nadie.</small>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PickModal({ id, onClose, onDone }) {
  const toast = useToast();
  const app = useApp();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/api/accounts/pending/${id}`).then((d) => { setData(d); if (d.candidates && d.candidates.length === 1) setSel([d.candidates[0].external_id]); })
      .catch((e) => { toast.error(e.message); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (x) => setSel((s) => (s.includes(x) ? s.filter((y) => y !== x) : [...s, x]));
  const save = async () => {
    setBusy(true);
    try { await api.post(`/api/accounts/pending/${id}`, { external_ids: sel }); toast.success(sel.length === 1 ? 'Cuenta conectada.' : 'Cuentas conectadas.'); onDone(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const net = data && app.netById(data.network);
  return (
    <Modal onClose={onClose} title={`¿Qué quieres conectar${net ? ' de ' + net.label : ''}?`} subtitle="Hemos encontrado varias. Marca las que quieras usar en WillyPost."
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!sel.length} loading={busy} icon={Check} onClick={save}>Conectar {sel.length || ''}</Button></>)}>
      {!data ? <Spinner /> : (
        <div className="cand-list">
          {data.candidates.map((c) => (
            <button type="button" key={c.external_id} className={`cand ${sel.includes(c.external_id) ? 'on' : ''}`} onClick={() => toggle(c.external_id)}>
              <span className="cand-av">{c.avatar_url ? <img src={c.avatar_url} alt="" /> : <NetIcon id={data.network} size={40} color={netColor(data.network, app.networks)} />}</span>
              <span className="cand-main"><b>{c.name}</b>{c.username ? <small>@{String(c.username).replace('@', '')}</small> : null}</span>
              <span className="cand-check">{sel.includes(c.external_id) ? <Check size={16} /> : null}</span>
            </button>
          ))}
          {data.candidates.length === 0 && <Empty compact icon={Info} title="No hemos encontrado cuentas" text="Comprueba que tu usuario tiene permisos sobre la página o ficha y vuelve a conectar." />}
        </div>
      )}
    </Modal>
  );
}

function ManualModal({ network, onClose, onDone }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (busy) return;
    if (!name.trim()) { setErr('Ponle un nombre, por ejemplo tu @usuario.'); return; }
    setErr('');
    setBusy(true);
    try { await api.post('/api/accounts/manual', { network: network.id, name: name.trim() }); toast.success(`${network.label} añadida en modo manual.`); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`${network.label} en modo manual`} subtitle="Sin carné ni conexiones. A la hora de publicar te aviso y lo subes tú."
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} icon={Plus} onClick={save}>Añadir</Button></>)}>
      <div className="notice info"><Hand size={18} /><div>Podrás programar como siempre. A su hora recibirás una notificación y verás el texto y los archivos listos en <b>Para publicar a mano</b>.</div></div>
      <Field label="Nombre de la cuenta" className="mt" error={err}><input className="input" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="@mi_negocio" data-autofocus onKeyDown={(e) => { if (e.key === 'Enter') save(); }} /></Field>
    </Modal>
  );
}

function BlueskyModal({ network, account, onClose, onDone }) {
  const toast = useToast();
  const [handle, setHandle] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (busy) return;
    setErr('');
    if ((!account && !handle.trim()) || !pwd.trim()) { setErr(account ? 'Pega la contraseña de aplicación.' : 'Escribe tu usuario y pega la contraseña de aplicación.'); return; }
    setBusy(true);
    try {
      if (account) await api.post(`/api/accounts/${account.id}/reconnect`, { appPassword: pwd.trim() });
      else await api.post('/api/accounts/connect/bluesky', { handle: handle.trim().replace(/^@/, ''), appPassword: pwd.trim() });
      toast.success('Bluesky conectada.');
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={account ? 'Reconectar Bluesky' : 'Conectar Bluesky'} subtitle="Bluesky no necesita carné: usa una contraseña de aplicación."
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} icon={Link2} onClick={save}>{account ? 'Reconectar' : 'Conectar'}</Button></>)}>
      <ol className="wz-list num">
        <li>Abre <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer" className="link">Contraseñas de aplicación en Bluesky <ExternalLink size={12} /></a> (Ajustes → Privacidad y seguridad).</li>
        <li>Pulsa “Añadir contraseña de aplicación”, ponle el nombre “WillyPost” y cópiala.</li>
        <li>Pégala aquí (no uses tu contraseña normal de Bluesky).</li>
      </ol>
      {!account && <Field label="Tu usuario" hint="Por ejemplo tunegocio.bsky.social"><input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="tunegocio.bsky.social" data-autofocus /></Field>}
      <Field label="Contraseña de aplicación" className="mt"><input className="input mono" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} /></Field>
      {err && <div className="notice error mt"><div>{err}</div></div>}
    </Modal>
  );
}
