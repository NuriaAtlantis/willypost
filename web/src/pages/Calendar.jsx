import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin, { Draggable } from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import { Plus, Sparkles, Check, GripVertical, PanelRightClose, PanelRightOpen, Plug, PenLine, Bot, Rocket, FileEdit, Hand } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { fmtTime, snippet, ymd } from '../lib/format.js';
import { postToBody, defaultTimeOn } from '../lib/posts.js';
import { FEED_MAX, STORY_MAX, TYPE_LABEL } from '../lib/constants.js';
import { Button, Badge, PageHeader, IconBox } from '../components/ui.jsx';
import { NetDot, NetIcon, netColor, netLabel, TYPE_ICON } from '../components/NetIcon.jsx';
import { MediaThumb } from '../components/Media.jsx';
import { ClaudeBadge } from '../components/PostDetail.jsx';
import { go } from '../lib/router.js';

const DRAGGABLE_STATUS = ['draft', 'scheduled', 'missed'];

export default function Calendar() {
  const app = useApp();
  const toast = useToast();
  const calRef = useRef(null);
  const panelRef = useRef(null);
  const rangeRef = useRef(null);
  // En pantallas pequeñas el mes no se lee bien: empezamos con la lista de la semana.
  const [view, setView] = useState(() => (window.innerWidth < 700 ? 'listWeek' : 'dayGridMonth'));
  const [posts, setPosts] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [slots, setSlots] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [netFilter, setNetFilter] = useState([]);
  const [campFilter, setCampFilter] = useState('');
  const [panelOpen, setPanelOpen] = useState(true);
  const [busyApprove, setBusyApprove] = useState(null);

  const netsWithAccounts = useMemo(() => [...new Set(app.accounts.map((a) => a.network))], [app.accounts]);
  const accById = useMemo(() => Object.fromEntries(app.accounts.map((a) => [a.id, a])), [app.accounts]);

  const loadRange = useCallback(async () => {
    const r = rangeRef.current;
    if (!r) return;
    const [p, s] = await Promise.all([
      api.get('/api/posts' + qs({ from: r.start.toISOString(), to: r.end.toISOString() })).catch(() => null),
      api.get('/api/slots' + qs({ from: r.start.toISOString(), to: r.end.toISOString() })).catch(() => null),
    ]);
    if (p) setPosts(p);
    if (s) setSlots(s);
  }, []);
  const loadDrafts = useCallback(async () => {
    const d = await api.get('/api/posts?status=draft').catch(() => null);
    if (d) setDrafts(d);
  }, []);

  useEffect(() => { loadRange(); loadDrafts(); }, [app.version, loadRange, loadDrafts]);
  useEffect(() => { api.get('/api/campaigns').then(setCampaigns).catch(() => {}); }, [app.version]);

  // Ir a una fecha desde la cabecera
  useEffect(() => {
    if (app.goto && calRef.current) calRef.current.getApi().gotoDate(app.goto.date);
  }, [app.goto]);

  // Borradores arrastrables al calendario
  useEffect(() => {
    if (!panelRef.current) return undefined;
    const d = new Draggable(panelRef.current, {
      itemSelector: '.draft-card[data-draggable="1"]',
      eventData: () => ({ create: false }),
    });
    return () => d.destroy();
  }, [panelOpen]);

  const matches = useCallback((p) => {
    if (netFilter.length && !(p.targets || []).some((t) => netFilter.includes(t.network))) return false;
    if (campFilter && String(p.campaign && p.campaign.id) !== campFilter) return false;
    return true;
  }, [netFilter, campFilter]);

  const events = useMemo(() => posts.filter((p) => p.scheduled_at && matches(p)).map((p) => {
    const first = p.targets && p.targets[0];
    return {
      id: String(p.id),
      start: p.scheduled_at,
      allDay: false,
      editable: DRAGGABLE_STATUS.includes(p.status),
      classNames: [`st-${p.status}`, p.created_by === 'claude' ? 'by-claude' : ''],
      extendedProps: { post: p, color: netColor(first ? first.network : '', app.networks) },
    };
  }), [posts, matches, app.networks]);

  // ---- Contadores por día ----
  const countersByDay = useMemo(() => {
    const map = {};
    slots.forEach((s) => {
      const a = accById[s.account_id];
      if (!a) return;
      if (netFilter.length && !netFilter.includes(a.network)) return;
      if (!s.feed && !s.story) return;
      (map[s.date] = map[s.date] || []).push({ ...s, network: a.network, name: a.name });
    });
    return map;
  }, [slots, accById, netFilter]);

  const renderCounters = (date) => {
    const rows = countersByDay[ymd(date)];
    if (!rows) return null;
    return (
      <span className="day-counters">
        {rows.slice(0, 4).map((r, i) => {
          const fMax = r.feedMax || FEED_MAX; const sMax = r.storyMax || STORY_MAX;
          const full = r.feed >= fMax || r.story >= sMax;
          const near = r.feed >= fMax - 1 && r.feed > 0;
          return (
            <span key={i} className={`dc ${full ? 'full' : near ? 'near' : ''}`} title={`${netLabel(r.network, app.networks)} · ${r.name}: ${r.feed}/${fMax} publicaciones${r.story ? `, ${r.story}/${sMax} stories` : ''} este día`}>
              <NetDot id={r.network} color={netColor(r.network, app.networks)} />
              {r.feed}/{fMax}{r.story ? <em>·S{r.story}</em> : null}
            </span>
          );
        })}
        {rows.length > 4 ? <span className="dc">+{rows.length - 4}</span> : null}
      </span>
    );
  };

  // ---- Reprogramar ----
  const reschedule = async (post, date, revert) => {
    try {
      await api.put(`/api/posts/${post.id}`, postToBody(post, { scheduled_at: date.toISOString() }));
      toast.success('Publicación movida.');
      app.bump();
    } catch (e) {
      revert && revert();
      toast.error(e.message);
    }
  };

  const onEventDrop = (info) => {
    const post = info.event.extendedProps.post;
    if (post.status !== 'draft' && info.event.start < new Date()) {
      info.revert();
      toast.error('No puedes mover una publicación al pasado. Elige un momento futuro.');
      return;
    }
    reschedule(post, info.event.start, info.revert);
  };

  const onDropDraft = async (info) => {
    const id = Number(info.draggedEl.dataset.postId);
    const post = drafts.find((d) => d.id === id);
    if (!post) return;
    const date = defaultTimeOn(info.date, app.queueTimes, !info.allDay);
    if (date < new Date()) { toast.error('Ese momento ya ha pasado. Suéltalo en un día futuro.'); return; }
    const isClaude = post.created_by === 'claude';
    const canSchedule = !isClaude && (post.targets || []).length > 0;
    try {
      await api.put(`/api/posts/${post.id}`, postToBody(post, { scheduled_at: date.toISOString(), action: canSchedule ? 'schedule' : 'draft' }));
      toast.success(canSchedule ? 'Programada para ese día.' : isClaude ? 'Fecha propuesta cambiada. Pulsa “Aprobar” para programarla.' : 'Fecha guardada. Abre el borrador y elige las redes para programarla.');
      app.bump();
    } catch (e) { toast.error(e.message); }
  };

  const onDateClick = (info) => {
    const d = defaultTimeOn(info.date, app.queueTimes, !info.allDay);
    const dayStart = new Date(info.date); dayStart.setHours(23, 59, 59, 0);
    if (dayStart < new Date()) { toast.info('Ese día ya ha pasado. Elige hoy o un día futuro.'); return; }
    app.openComposer({ date: d.toISOString() });
  };

  const approve = async (p) => {
    if (!p.scheduled_at) { app.openComposer({ post: p }); toast.info('Elige cuándo quieres publicarla y pulsa Programar.'); return; }
    setBusyApprove(p.id);
    try {
      await api.post(`/api/posts/${p.id}/approve`);
      toast.success('Aprobada y programada.');
      app.bump();
    } catch (e) {
      // Si la fecha propuesta ya pasó, abrimos la publicación para elegir una nueva.
      if (e.status === 400) { app.openComposer({ post: p }); toast.info(e.message, 9000); } else toast.error(e.message);
    } finally { setBusyApprove(null); }
  };

  // ---- Render de eventos ----
  const renderEvent = (arg) => {
    const p = arg.event.extendedProps.post;
    const TypeIco = TYPE_ICON[p.type] || TYPE_ICON.post;
    const nets = [...new Set((p.targets || []).map((t) => t.network))];
    const thumb = p.media && p.media[0];
    if (arg.view.type.startsWith('list')) {
      return (
        <div className="ev-list">
          {thumb ? <MediaThumb m={thumb} className="ev-thumb big" /> : <span className="ev-thumb big none"><TypeIco size={18} /></span>}
          <div className="ev-list-main">
            <b>{snippet(p.caption, 90) || 'Sin texto'}</b>
            <span>{TYPE_LABEL[p.type]} · {nets.map((n) => netLabel(n, app.networks)).join(', ') || 'Sin redes'}</span>
          </div>
          {p.created_by === 'claude' && p.status === 'draft' ? <ClaudeBadge /> : null}
          <StatusDot status={p.status} />
        </div>
      );
    }
    return (
      <div className="ev" style={{ '--c': arg.event.extendedProps.color }}>
        {thumb ? <MediaThumb m={thumb} className="ev-thumb" /> : null}
        <TypeIco size={12} className="ev-type" />
        <span className="ev-time">{fmtTime(p.scheduled_at)}</span>
        <span className="ev-text">{snippet(p.caption, 40) || TYPE_LABEL[p.type]}</span>
        <span className="ev-dots">{nets.slice(0, 4).map((n) => <NetDot key={n} id={n} color={netColor(n, app.networks)} size={7} />)}</span>
        {p.created_by === 'claude' && p.status === 'draft' ? <Sparkles size={11} className="ev-ai" /> : null}
      </div>
    );
  };

  const claudeDrafts = drafts.filter((d) => d.created_by === 'claude');
  const userDrafts = drafts.filter((d) => d.created_by !== 'claude' && !d.scheduled_at);
  const noAccounts = app.accountsLoaded && app.accounts.length === 0;

  return (
    <div>
      <PageHeader eyebrow="Tu calendario" title="Programa tus redes" pill="sin estrés"
        sub="Haz clic en un día para crear una publicación. Arrastra para cambiarla de fecha." />

      {noAccounts && (
        <div className="card onboard">
          <div className="halo" />
          <div className="onboard-main">
            <div className="eyebrow light">Empieza aquí</div>
            <h2>Conecta tu <span className="pill-title">primera red</span></h2>
            <p>En 3 pasos tendrás tu calendario listo. Si prefieres no configurar nada todavía, añade una red en modo manual y te avisaré a la hora de publicar.</p>
            <div className="btn-row">
              <Button variant="white" icon={Plug} onClick={() => go('/redes')}>Conectar una red</Button>
              <Button variant="outline-light" icon={Bot} onClick={() => go('/claude')}>Conectar con Claude</Button>
            </div>
          </div>
          <ol className="onboard-steps">
            <li><span><Plug size={18} /></span><div><b>1. Conecta una red</b><small>Con tu propio carné, guiado paso a paso</small></div></li>
            <li><span><PenLine size={18} /></span><div><b>2. Crea tu primera publicación</b><small>Un texto, varias redes</small></div></li>
            <li><span><Rocket size={18} /></span><div><b>3. Prográmala y olvídate</b><small>Mantén el ordenador encendido a esa hora</small></div></li>
          </ol>
        </div>
      )}

      <div className="cal-filters">
        <div className="chips">
          <button className={`chip ${netFilter.length === 0 ? 'on' : ''}`} onClick={() => setNetFilter([])}>Todas las redes</button>
          {netsWithAccounts.map((n) => (
            <button key={n} className={`chip ${netFilter.includes(n) ? 'on' : ''}`} onClick={() => setNetFilter((f) => (f.includes(n) ? f.filter((x) => x !== n) : [...f, n]))}>
              <NetDot id={n} color={netColor(n, app.networks)} /> {netLabel(n, app.networks)}
            </button>
          ))}
        </div>
        <div className="cal-filters-right">
          <select className="input sm" value={campFilter} onChange={(e) => setCampFilter(e.target.value)} aria-label="Filtrar por campaña">
            <option value="">Todas las campañas</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="icon-btn big" onClick={() => setPanelOpen((v) => !v)} title={panelOpen ? 'Ocultar borradores' : 'Mostrar borradores'} aria-label="Panel de borradores">
            {panelOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
            {!panelOpen && drafts.length > 0 ? <em className="dot-count">{drafts.length}</em> : null}
          </button>
        </div>
      </div>

      <div className={`cal-layout ${panelOpen ? 'with-panel' : ''}`}>
        <div className="card cal-card">
          <FullCalendar
            ref={calRef}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            locales={[esLocale]}
            locale="es"
            firstDay={1}
            initialView={view}
            height="auto"
            headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }}
            buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana', list: 'Agenda' }}
            views={{ dayGridMonth: { dayMaxEvents: 3 }, timeGridWeek: { allDaySlot: false, slotMinTime: '06:00:00', slotMaxTime: '24:00:00' }, listWeek: { listDayFormat: { weekday: 'long', day: 'numeric', month: 'long' }, noEventsContent: 'No hay publicaciones esta semana.' } }}
            events={events}
            eventContent={renderEvent}
            eventClick={(info) => app.openPost(Number(info.event.id))}
            eventDrop={onEventDrop}
            editable
            eventDurationEditable={false}
            droppable
            drop={onDropDraft}
            dateClick={onDateClick}
            datesSet={(info) => {
              // FullCalendar vuelve a llamar a esto en cada render: solo recargamos si el rango cambia de verdad.
              const r = rangeRef.current;
              if (r && r.start.getTime() === info.start.getTime() && r.end.getTime() === info.end.getTime()) return;
              rangeRef.current = { start: info.start, end: info.end };
              setView((v) => (v === info.view.type ? v : info.view.type));
              loadRange();
            }}
            dayCellContent={(arg) => (arg.view.type.startsWith('dayGrid') ? (
              <span className="day-cell">
                <span className="day-num">{arg.dayNumberText}</span>
                {renderCounters(arg.date)}
              </span>
            ) : undefined)}
            dayHeaderContent={(arg) => (arg.view.type === 'timeGridWeek' ? (
              <span className="day-head">
                <span>{arg.text}</span>
                {renderCounters(arg.date)}
              </span>
            ) : arg.text)}
            nowIndicator
            dayMaxEventRows={3}
            moreLinkText={(n) => `+${n} más`}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            fixedWeekCount={false}
          />
          <div className="cal-legend">
            <span><i className="lg lg-claude" /> Propuesto por Claude</span>
            <span><i className="lg lg-draft" /> Borrador</span>
            <span><i className="lg lg-pub" /> Publicada</span>
            <span><i className="lg lg-fail" /> Fallida / sin publicar</span>
            <span className="muted">Contadores por día: publicaciones hechas / máximo (5 al día, 10 stories)</span>
          </div>
        </div>

        {panelOpen && (
          <aside className="card drafts-panel" ref={panelRef}>
            <div className="drafts-head">
              <IconBox icon={FileEdit} size={38} />
              <div><h3>Borradores</h3><small>Arrástralos a un día del calendario</small></div>
            </div>

            {claudeDrafts.length > 0 && (
              <>
                <div className="drafts-sub"><Sparkles size={14} /> Propuestos por Claude</div>
                {claudeDrafts.map((d) => (
                  <DraftCard key={d.id} d={d} app={app} onOpen={() => app.openPost(d.id)}
                    extra={<Button size="sm" icon={Check} loading={busyApprove === d.id} onClick={(e) => { e.stopPropagation(); approve(d); }}>Aprobar</Button>} />
                ))}
              </>
            )}
            <div className="drafts-sub"><FileEdit size={14} /> Sin fecha</div>
            {userDrafts.length === 0 ? (
              <p className="drafts-empty">No tienes borradores sin fecha. Cuando guardes uno con “Guardar borrador”, aparecerá aquí para colocarlo en el calendario.</p>
            ) : userDrafts.map((d) => <DraftCard key={d.id} d={d} app={app} onOpen={() => app.openPost(d.id)} />)}
          </aside>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }) {
  const tone = { published: 'green', failed: 'red', missed: 'amber', draft: 'gray', scheduled: 'blue', partial: 'amber', manual: 'amber' }[status] || 'gray';
  const label = { published: 'Publicada', failed: 'Fallida', missed: 'Sin publicar', draft: 'Borrador', scheduled: 'Programada', partial: 'Parcial', manual: 'A mano', publishing: 'Publicando' }[status] || status;
  return <Badge tone={tone}>{label}</Badge>;
}

function DraftCard({ d, app, onOpen, extra }) {
  const TypeIco = TYPE_ICON[d.type] || TYPE_ICON.post;
  const nets = [...new Set((d.targets || []).map((t) => t.network))];
  const thumb = d.media && d.media[0];
  return (
    <div className="draft-card" data-draggable="1" data-post-id={d.id} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <GripVertical size={16} className="grip" />
      {thumb ? <MediaThumb m={thumb} className="draft-thumb" /> : <span className="draft-thumb none"><TypeIco size={18} /></span>}
      <div className="draft-main">
        <b>{snippet(d.caption, 60) || 'Sin texto'}</b>
        <span><TypeIco size={12} /> {TYPE_LABEL[d.type]}{d.scheduled_at ? ` · ${new Date(d.scheduled_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : ''}</span>
        <span className="ev-dots">{nets.map((n) => <NetDot key={n} id={n} color={netColor(n, app.networks)} size={8} />)}</span>
        {extra}
      </div>
    </div>
  );
}
