import { useCallback, useEffect, useState } from 'react';
import {
  Pencil, Copy, Trash2, Send, Check, RotateCcw, ExternalLink, Hand, Sparkles, CalendarClock, Ban, AlertTriangle, Clock,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../lib/format.js';
import { EDITABLE_STATUS, POST_STATUS, TARGET_STATUS, TYPE_LABEL } from '../lib/constants.js';
import { Badge, Button, Modal, Spinner, useConfirm, Field } from './ui.jsx';
import { NetIcon, netLabel, netColor, TYPE_ICON } from './NetIcon.jsx';
import { MediaThumb } from './Media.jsx';

export function StatusBadge({ status }) {
  const s = POST_STATUS[status] || { label: status, tone: 'gray' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ClaudeBadge() {
  return <Badge tone="violet" icon={Sparkles}>Propuesto por Claude</Badge>;
}

export function RescheduleModal({ post, onClose, onDone }) {
  const toast = useToast();
  const [when, setWhen] = useState(toLocalInput(new Date(Date.now() + 3600e3).toISOString()));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const iso = fromLocalInput(when);
    if (!iso || new Date(iso) < new Date()) { toast.error('Elige una fecha y hora futuras.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/posts/${post.id}/missed`, { action: 'reschedule', scheduled_at: iso });
      toast.success('Reprogramada.');
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Reprogramar publicación" subtitle="Elige cuándo quieres que salga ahora."
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} icon={CalendarClock} onClick={save}>Reprogramar</Button></>)}>
      <Field label="Nueva fecha y hora"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} data-autofocus /></Field>
    </Modal>
  );
}

// Acciones sobre publicaciones perdidas (usadas en el aviso global y en el detalle)
export function useMissedActions(onDone) {
  const toast = useToast();
  const [resched, setResched] = useState(null);
  const act = useCallback(async (post, action) => {
    if (action === 'reschedule') { setResched(post); return; }
    try {
      await api.post(`/api/posts/${post.id}/missed`, { action });
      toast.success(action === 'publish' ? 'Publicando ahora…' : 'Omitida.');
      onDone();
    } catch (e) { toast.error(e.message); }
  }, [toast, onDone]);
  const el = resched ? <RescheduleModal post={resched} onClose={() => setResched(null)} onDone={() => { setResched(null); onDone(); }} /> : null;
  return [act, el];
}

export default function PostDetail() {
  const app = useApp();
  if (!app.detailId) return null;
  return <PostDetailInner key={app.detailId} id={app.detailId} />;
}

function PostDetailInner({ id }) {
  const app = useApp();
  const toast = useToast();
  const [post, setPost] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, confirmEl] = useConfirm();
  const [missedAct, missedEl] = useMissedActions(() => { app.bump(); app.closePost(); });

  const load = useCallback(() => api.get(`/api/posts/${id}`).then(setPost).catch((e) => { toast.error(e.message); app.closePost(); }), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, app.version]);

  const run = async (key, fn, okMsg, after) => {
    setBusy(key);
    try {
      const r = await fn();
      if (okMsg) toast.success(okMsg);
      app.bump();
      if (after) after(r); else load();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  if (!post) return <Modal onClose={app.closePost} title="Publicación"><Spinner /></Modal>;

  const TypeIcon = TYPE_ICON[post.type] || TYPE_ICON.post;
  const locked = post.status === 'published' || post.status === 'publishing';
  const isClaudeDraft = post.created_by === 'claude' && post.status === 'draft';
  const edit = () => { app.closePost(); app.openComposer({ post }); };

  const approve = () => {
    if (!post.scheduled_at) { toast.info('Elige primero cuándo quieres publicarla y pulsa Programar.'); edit(); return; }
    setBusy('approve');
    api.post(`/api/posts/${post.id}/approve`)
      .then(() => { toast.success('Aprobada y programada.'); app.bump(); app.closePost(); })
      .catch((e) => {
        // Fecha propuesta ya pasada: abrimos el editor para elegir otra.
        if (e.status === 400) { toast.info(e.message, 9000); edit(); } else toast.error(e.message);
      })
      .finally(() => setBusy(''));
  };
  const del = async () => {
    const ok = await confirm({ title: 'Eliminar publicación', text: 'Se borrará esta publicación. No se puede deshacer.', ok: 'Sí, eliminar', danger: true });
    if (ok) run('del', () => api.del(`/api/posts/${post.id}`), 'Publicación eliminada.', () => app.closePost());
  };
  const dup = () => run('dup', () => api.post(`/api/posts/${post.id}/duplicate`), 'Duplicada como borrador.', (np) => { app.closePost(); if (np && np.id) app.openComposer({ post: np }); });
  const now = async () => {
    const ok = await confirm({ title: '¿Publicar ahora?', text: 'Se enviará a las redes elegidas en este momento.', ok: 'Publicar ahora' });
    if (ok) run('now', () => api.post(`/api/posts/${post.id}/publish-now`), 'Publicando ahora…');
  };

  return (
    <Modal wide onClose={app.closePost} title="Publicación"
      subtitle={post.scheduled_at ? fmtDateTime(post.scheduled_at) : 'Sin fecha'}
      footer={(
        <>
          <Button variant="ghost" icon={Trash2} onClick={del} loading={busy === 'del'} disabled={post.status === 'publishing'}>Eliminar</Button>
          <span className="spacer" />
          <Button variant="secondary" icon={Copy} onClick={dup} loading={busy === 'dup'}>Duplicar</Button>
          {EDITABLE_STATUS.includes(post.status) && <Button variant="secondary" icon={Pencil} onClick={edit}>Editar</Button>}
          {!locked && post.status === 'scheduled' && <Button variant="secondary" icon={Send} onClick={now} loading={busy === 'now'}>Publicar ahora</Button>}
          {isClaudeDraft && <Button icon={Check} onClick={approve} loading={busy === 'approve'}>Aprobar y programar</Button>}
        </>
      )}>
      {confirmEl}{missedEl}
      <div className="detail-top">
        <StatusBadge status={post.status} />
        <Badge tone="gray" icon={TypeIcon}>{TYPE_LABEL[post.type] || post.type}</Badge>
        {post.created_by === 'claude' ? <ClaudeBadge /> : null}
        {post.campaign ? <Badge tone="blue"><span className="netdot" style={{ background: post.campaign.color || 'var(--azul)' }} /> {post.campaign.name}</Badge> : null}
      </div>

      {post.status === 'missed' && (
        <div className="notice warn">
          <AlertTriangle size={18} />
          <div>
            <b>No se publicó a su hora</b> porque el ordenador estaba apagado.
            <div className="btn-row">
              <Button size="sm" icon={Send} onClick={() => missedAct(post, 'publish')}>Publicar ahora</Button>
              <Button size="sm" variant="secondary" icon={CalendarClock} onClick={() => missedAct(post, 'reschedule')}>Reprogramar</Button>
              <Button size="sm" variant="ghost" icon={Ban} onClick={() => missedAct(post, 'skip')}>Omitir</Button>
            </div>
          </div>
        </div>
      )}
      {isClaudeDraft && (
        <div className="notice violet">
          <Sparkles size={18} />
          <div><b>Claude ha preparado esto para ti.</b> Revísalo, cámbialo si quieres y pulsa <b>Aprobar y programar</b>.{post.scheduled_at ? ` Fecha propuesta: ${fmtDateTime(post.scheduled_at)}.` : ' No tiene fecha: elige una al editarla.'}</div>
        </div>
      )}

      {post.media && post.media.length > 0 && (
        <div className="detail-media">{post.media.map((m) => <MediaThumb key={m.id} m={m} />)}</div>
      )}
      <div className="detail-caption">{post.caption || <em>Sin texto</em>}</div>
      {post.notes ? <p className="detail-notes"><b>Notas:</b> {post.notes}</p> : null}

      <h4 className="detail-h">Redes</h4>
      <div className="targets">
        {(post.targets || []).map((t) => {
          const st = TARGET_STATUS[t.status] || { label: t.status, tone: 'gray' };
          return (
            <div className="target" key={t.id}>
              <NetIcon id={t.network} size={34} color={netColor(t.network, app.networks)} />
              <div className="target-main">
                <b>{netLabel(t.network, app.networks)} <span>{t.account_name}</span></b>
                {t.caption_override != null && t.caption_override !== post.caption ? <small>Con texto propio</small> : null}
                {t.error ? <small className="err">{t.error}</small> : null}
                {t.warning ? <small className="warn-note">{t.warning}</small> : null}
                {t.external_url ? <a href={t.external_url} target="_blank" rel="noreferrer" className="link">Ver publicación <ExternalLink size={12} /></a> : null}
              </div>
              {t.delivery === 'manual' && t.status !== 'manual_done' && t.status !== 'published' ? <Badge tone="gray" icon={Hand}>Manual</Badge> : null}
              <Badge tone={st.tone}>{st.label}</Badge>
              {t.status === 'failed' && (
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => run('r' + t.id, () => api.post(`/api/targets/${t.id}/retry`), 'Reintentando…')} loading={busy === 'r' + t.id}>Reintentar</Button>
              )}
              {t.status === 'manual_pending' && (
                <Button size="sm" icon={Check} onClick={() => run('m' + t.id, () => api.post(`/api/targets/${t.id}/manual-done`, {}), '¡Genial! Marcada como publicada.')} loading={busy === 'm' + t.id}>Ya la he publicado</Button>
              )}
            </div>
          );
        })}
        {(!post.targets || !post.targets.length) && <p className="muted"><Clock size={14} /> Todavía no has elegido redes. Edita la publicación para añadirlas.</p>}
      </div>
    </Modal>
  );
}
