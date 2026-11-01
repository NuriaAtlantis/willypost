import { useEffect, useState } from 'react';
import { User, Clock, Globe, Megaphone, Hash, Plus, Trash2, Pencil, Check, LogOut, X, KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { Button, PageHeader, IconBox, Field, Modal, Empty, useConfirm } from '../components/ui.jsx';

const COLORS = ['#5881B9', '#E1306C', '#34A853', '#F5A623', '#8B5CF6', '#EF4444', '#0EA5A5', '#203046'];

function Section({ icon, title, sub, children, actions }) {
  return (
    <section className="card set-card">
      <div className="set-head">
        <IconBox icon={icon} size={44} />
        <div><h3>{title}</h3>{sub ? <p>{sub}</p> : null}</div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const app = useApp();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [times, setTimes] = useState(app.queueTimes);
  const [savingTimes, setSavingTimes] = useState(false);
  const [campaigns, setCampaigns] = useState(null);
  const [snippets, setSnippets] = useState(null);
  const [campModal, setCampModal] = useState(null);
  const [snipModal, setSnipModal] = useState(null);
  const [pwModal, setPwModal] = useState(false);

  const loadCamps = () => api.get('/api/campaigns').then(setCampaigns).catch(() => setCampaigns([]));
  const loadSnips = () => api.get('/api/snippets').then(setSnippets).catch(() => setSnippets([]));
  useEffect(() => { loadCamps(); loadSnips(); }, []);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const savedTz = app.settings.timezone;

  const saveTimes = async () => {
    const clean = [...new Set(times.filter(Boolean))].sort();
    if (!clean.length) { toast.error('Añade al menos una hora a la cola.'); return; }
    setSavingTimes(true);
    try { await app.saveSettings({ queue_times: clean }); setTimes(clean); toast.success('Horas de la cola guardadas.'); } catch (e) { toast.error(e.message); } finally { setSavingTimes(false); }
  };
  const useBrowserTz = async () => {
    try { await app.saveSettings({ timezone: browserTz }); toast.success('Zona horaria actualizada.'); } catch (e) { toast.error(e.message); }
  };

  const delCamp = async (c) => {
    if (!(await confirm({ title: 'Eliminar campaña', text: `Se eliminará “${c.name}”. Sus publicaciones no se borran, solo quedan sin campaña.`, ok: 'Sí, eliminar', danger: true }))) return;
    try { await api.del(`/api/campaigns/${c.id}`); loadCamps(); app.bump(); } catch (e) { toast.error(e.message); }
  };
  const delSnip = async (s) => {
    if (!(await confirm({ title: 'Eliminar texto guardado', text: `Se eliminará “${s.name}”.`, ok: 'Sí, eliminar', danger: true }))) return;
    try { await api.del(`/api/snippets/${s.id}`); loadSnips(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      {confirmEl}
      <PageHeader eyebrow="Tu cuenta" title="Tus" pill="ajustes" sub="Tu perfil, tus horarios y tus textos guardados." />
      <div className="set-grid">
        <Section icon={User} title="Perfil" sub="Tu cuenta vive solo en este ordenador.">
          <div className="profile">
            <span className="me-av big">{(app.user.name || app.user.email || '?')[0].toUpperCase()}</span>
            <div><b>{app.user.name || 'Sin nombre'}</b><small>{app.user.email}</small></div>
            <Button variant="secondary" icon={KeyRound} onClick={() => setPwModal(true)}>Cambiar contraseña</Button>
            <Button variant="secondary" icon={LogOut} onClick={app.logout}>Cerrar sesión</Button>
          </div>
        </Section>

        <Section icon={Globe} title="Zona horaria" sub="Los límites diarios (5 publicaciones y 10 stories) se cuentan por día natural en tu hora local.">
          <div className="tz">
            <div><small>Guardada en WillyPost</small><b>{savedTz || 'Sin definir'}</b></div>
            <div><small>De este ordenador</small><b>{browserTz}</b></div>
            {savedTz !== browserTz && <Button variant="secondary" size="sm" onClick={useBrowserTz}>Usar la de este ordenador</Button>}
          </div>
        </Section>

        <Section icon={Clock} title="Horas de la cola" sub="Cuando eliges “Añadir a la cola”, la publicación sale en el siguiente hueco libre de estas horas.">
          <div className="times">
            {times.map((t, i) => (
              <div className="time-item" key={i}>
                <input type="time" className="input" value={t} onChange={(e) => setTimes((l) => l.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Hora ${i + 1}`} />
                <button className="icon-btn" aria-label="Quitar hora" onClick={() => setTimes((l) => l.filter((_, j) => j !== i))}><X size={16} /></button>
              </div>
            ))}
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setTimes((l) => [...l, '12:00'])}>Añadir hora</Button>
          </div>
          <div className="set-actions"><Button icon={Check} loading={savingTimes} onClick={saveTimes}>Guardar horas</Button></div>
        </Section>

        <Section icon={Megaphone} title="Campañas" sub="Agrupa publicaciones (por ejemplo “Black Friday”) y fíltralas en el calendario."
          actions={<Button size="sm" icon={Plus} onClick={() => setCampModal({})}>Nueva</Button>}>
          {campaigns === null ? null : campaigns.length === 0 ? (
            <Empty compact icon={Megaphone} title="Aún no tienes campañas" text="Crea una para organizar mejor tus publicaciones. Claude también las crea cuando le pides una campaña." />
          ) : (
            <div className="items">
              {campaigns.map((c) => (
                <div className="item" key={c.id}>
                  <span className="netdot lg" style={{ background: c.color || 'var(--azul)' }} />
                  <div><b>{c.name}</b>{c.description ? <small>{c.description}</small> : null}</div>
                  <button className="icon-btn" aria-label="Editar" onClick={() => setCampModal(c)}><Pencil size={16} /></button>
                  <button className="icon-btn danger" aria-label="Eliminar" onClick={() => delCamp(c)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={Hash} title="Textos guardados" sub="Grupos de hashtags o frases que usas siempre. Los insertas con un clic al escribir."
          actions={<Button size="sm" icon={Plus} onClick={() => setSnipModal({})}>Nuevo</Button>}>
          {snippets === null ? null : snippets.length === 0 ? (
            <Empty compact icon={Hash} title="Aún no tienes textos guardados" text="Guarda por ejemplo #seo #marketingdigital #emprendedores y no vuelvas a escribirlos." />
          ) : (
            <div className="items">
              {snippets.map((s) => (
                <div className="item" key={s.id}>
                  <div><b>{s.name}</b><small className="clamp2">{s.text}</small></div>
                  <button className="icon-btn" aria-label="Editar" onClick={() => setSnipModal(s)}><Pencil size={16} /></button>
                  <button className="icon-btn danger" aria-label="Eliminar" onClick={() => delSnip(s)}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {campModal && <CampaignModal item={campModal} onClose={() => setCampModal(null)} onDone={() => { setCampModal(null); loadCamps(); app.bump(); }} />}
      {snipModal && <SnippetModal item={snipModal} onClose={() => setSnipModal(null)} onDone={() => { setSnipModal(null); loadSnips(); }} />}
      {pwModal && <PasswordModal onClose={() => setPwModal(false)} />}
    </div>
  );
}

function PasswordModal({ onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); };
  const save = async () => {
    if (!f.current) { setError('Escribe tu contraseña actual.'); return; }
    if (f.next.length < 8) { setError('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
    if (f.next !== f.repeat) { setError('Las dos contraseñas nuevas no coinciden.'); return; }
    setBusy(true);
    try {
      await api.put('/api/me', { currentPassword: f.current, newPassword: f.next });
      toast.success('Contraseña cambiada. Úsala la próxima vez que entres.');
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Cambiar contraseña" subtitle="Tu código de recuperación sigue siendo el mismo."
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={save}>Cambiar contraseña</Button></>)}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Contraseña actual"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={set('current')} data-autofocus /></Field>
        <Field label="Nueva contraseña (mínimo 8 caracteres)" className="mt"><input className="input" type="password" autoComplete="new-password" value={f.next} onChange={set('next')} /></Field>
        <Field label="Repite la nueva contraseña" className="mt"><input className="input" type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} /></Field>
        {error ? <p className="field-error mt" role="alert">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CampaignModal({ item, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: item.name || '', description: item.description || '', color: item.color || COLORS[0] });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) { toast.error('Ponle un nombre a la campaña.'); return; }
    setBusy(true);
    try {
      if (item.id) await api.put(`/api/campaigns/${item.id}`, f); else await api.post('/api/campaigns', f);
      toast.success('Campaña guardada.');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={item.id ? 'Editar campaña' : 'Nueva campaña'}
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={save}>Guardar</Button></>)}>
      <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Black Friday" data-autofocus /></Field>
      <Field label="Descripción (opcional)" className="mt"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Oferta de 2 semanas para Instagram y TikTok" /></Field>
      <div className="field mt"><span className="field-label">Color</span>
        <div className="swatches">{COLORS.map((c) => <button key={c} type="button" className={`swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />)}</div>
      </div>
    </Modal>
  );
}

function SnippetModal({ item, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: item.name || '', text: item.text || '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim() || !f.text.trim()) { toast.error('Rellena el nombre y el texto.'); return; }
    setBusy(true);
    try {
      // Primero se guarda el nuevo; solo entonces se borra el antiguo (si falla, no se pierde nada).
      await api.post('/api/snippets', f);
      if (item.id) { await api.del(`/api/snippets/${item.id}`).catch(() => {}); }
      toast.success('Texto guardado.');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={item.id ? 'Editar texto guardado' : 'Nuevo texto guardado'}
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={save}>Guardar</Button></>)}>
      <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Hashtags SEO" data-autofocus /></Field>
      <Field label="Texto" className="mt"><textarea className="textarea" rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="#seo #marketingdigital #emprendedores" /></Field>
    </Modal>
  );
}
