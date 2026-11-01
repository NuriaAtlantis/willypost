import { useEffect, useMemo, useState } from 'react';
import { Search, Pencil, Copy, Trash2, Check, ListX, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { fmtDateTime, snippet } from '../lib/format.js';
import { EDITABLE_STATUS, POST_STATUS, TYPE_LABEL } from '../lib/constants.js';
import { Button, PageHeader, Tabs, Spinner, Empty, useConfirm } from '../components/ui.jsx';
import { NetIcon, netColor, netLabel, TYPE_ICON } from '../components/NetIcon.jsx';
import { MediaThumb } from '../components/Media.jsx';
import { StatusBadge, ClaudeBadge } from '../components/PostDetail.jsx';

export default function ListPage({ query }) {
  const app = useApp();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [posts, setPosts] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [tab, setTab] = useState('next');
  const [net, setNet] = useState('');
  const [status, setStatus] = useState(query.estado || '');
  const [camp, setCamp] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    api.get('/api/posts').then((p) => { setLoadError(false); setPosts(p); }).catch((e) => { toast.error(e.message); setLoadError(true); setPosts((cur) => cur || []); });
    api.get('/api/campaigns').then(setCampaigns).catch(() => {});
  }, [app.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (query.estado) { setStatus(query.estado); setTab('all'); } }, [query.estado]);

  const now = Date.now();
  const bucket = (p) => {
    if (p.status === 'draft') return 'drafts';
    if (['published', 'failed'].includes(p.status)) return 'past';
    if (p.status === 'missed') return 'past';
    if (p.scheduled_at && new Date(p.scheduled_at).getTime() < now - 60000 && p.status !== 'manual' && p.status !== 'partial') return 'past';
    return 'next';
  };

  const filtered = useMemo(() => (posts || []).filter((p) => {
    if (tab !== 'all' && bucket(p) !== tab) return false;
    if (status && p.status !== status) return false;
    if (net && !(p.targets || []).some((t) => t.network === net)) return false;
    if (camp && String(p.campaign && p.campaign.id) !== camp) return false;
    if (text && !(p.caption || '').toLowerCase().includes(text.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    const da = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
    const db = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
    return tab === 'past' ? db - da : da - db;
  }), [posts, tab, status, net, camp, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { next: 0, past: 0, drafts: 0, all: (posts || []).length };
    (posts || []).forEach((p) => { c[bucket(p)]++; });
    return c;
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  const nets = [...new Set(app.accounts.map((a) => a.network))];

  const del = async (p) => {
    if (!(await confirm({ title: 'Eliminar publicación', text: 'Se borrará esta publicación. No se puede deshacer.', ok: 'Sí, eliminar', danger: true }))) return;
    try { await api.del(`/api/posts/${p.id}`); toast.success('Eliminada.'); app.bump(); } catch (e) { toast.error(e.message); }
  };
  const dup = async (p) => {
    try { const np = await api.post(`/api/posts/${p.id}/duplicate`); toast.success('Duplicada como borrador.'); app.bump(); if (np && np.id) app.openComposer({ post: np }); } catch (e) { toast.error(e.message); }
  };
  const approve = async (p) => {
    if (!p.scheduled_at) { app.openComposer({ post: p }); toast.info('Elige cuándo quieres publicarla y pulsa Programar.'); return; }
    try { await api.post(`/api/posts/${p.id}/approve`); toast.success('Aprobada y programada.'); app.bump(); } catch (e) {
      if (e.status === 400) { app.openComposer({ post: p }); toast.info(e.message, 9000); } else toast.error(e.message);
    }
  };

  return (
    <div>
      {confirmEl}
      <PageHeader eyebrow="Todas tus publicaciones" title="Tu" pill="lista" sub="Busca, filtra y revisa el estado de cada publicación." />
      <div className="card list-card">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'next', label: 'Próximas', count: counts.next },
          { id: 'past', label: 'Pasadas', count: counts.past },
          { id: 'drafts', label: 'Borradores', count: counts.drafts },
          { id: 'all', label: 'Todas', count: counts.all },
        ]} />
        <div className="list-filters">
          <div className="search"><Search size={16} /><input className="input" placeholder="Buscar en el texto…" value={text} onChange={(e) => setText(e.target.value)} /></div>
          <select className="input" value={net} onChange={(e) => setNet(e.target.value)} aria-label="Red">
            <option value="">Todas las redes</option>
            {nets.map((n) => <option key={n} value={n}>{netLabel(n, app.networks)}</option>)}
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {Object.entries(POST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="input" value={camp} onChange={(e) => setCamp(e.target.value)} aria-label="Campaña">
            <option value="">Todas las campañas</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {posts === null ? <Spinner /> : loadError && posts.length === 0 ? (
          <Empty icon={ListX} title="No he podido cargar tus publicaciones" text="No te preocupes: siguen guardadas en tu ordenador. Comprueba que WillyPost está abierto y vuelve a probar."
            action={<Button variant="secondary" onClick={() => app.bump()}>Reintentar</Button>} />
        ) : filtered.length === 0 ? (
          <Empty icon={ListX} title={posts.length ? 'No hay nada con estos filtros' : 'Todavía no hay publicaciones'}
            text={posts.length ? 'Prueba a quitar algún filtro.' : 'Crea tu primera publicación y la verás aquí.'}
            action={!posts.length ? <Button icon={Plus} onClick={() => app.openComposer({})}>Crear publicación</Button> : null} />
        ) : (
          <div className="rows">
            {filtered.map((p) => {
              const Ico = TYPE_ICON[p.type] || TYPE_ICON.post;
              const thumb = p.media && p.media[0];
              const claudeDraft = p.created_by === 'claude' && p.status === 'draft';
              return (
                <div className="row" key={p.id} onClick={() => app.openPost(p.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') app.openPost(p.id); }}>
                  {thumb ? <MediaThumb m={thumb} className="row-thumb" /> : <span className="row-thumb none"><Ico size={22} /></span>}
                  <div className="row-main">
                    <b>{snippet(p.caption, 110) || 'Sin texto'}</b>
                    <span className="row-meta">
                      <Ico size={13} /> {TYPE_LABEL[p.type]}
                      {p.campaign ? <> · <i className="netdot" style={{ background: p.campaign.color || 'var(--azul)' }} /> {p.campaign.name}</> : null}
                    </span>
                    {(p.targets || []).filter((t) => t.warning).slice(0, 1).map((t) => <span className="row-warn" key={t.id}>{t.warning}</span>)}
                  </div>
                  <div className="row-nets">{(p.targets || []).map((t) => <NetIcon key={t.id} id={t.network} size={24} color={netColor(t.network, app.networks)} title={`${netLabel(t.network, app.networks)} · ${t.account_name}`} />)}</div>
                  <div className="row-date">{fmtDateTime(p.scheduled_at)}</div>
                  <div className="row-status">{claudeDraft ? <ClaudeBadge /> : <StatusBadge status={p.status} />}</div>
                  <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                    {claudeDraft && <Button size="sm" icon={Check} onClick={() => approve(p)}>Aprobar</Button>}
                    {EDITABLE_STATUS.includes(p.status) && <button className="icon-btn" title="Editar" aria-label="Editar" onClick={() => app.openComposer({ post: p })}><Pencil size={17} /></button>}
                    <button className="icon-btn" title="Duplicar" aria-label="Duplicar" onClick={() => dup(p)}><Copy size={17} /></button>
                    <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => del(p)}><Trash2 size={17} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
