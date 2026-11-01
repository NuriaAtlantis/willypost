import { useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import {
  CalendarDays, List, Hand, Plug, Images, Sparkles, Settings, CircleHelp, Bell, Plus, LogOut, CalendarSearch,
  AlertTriangle, Send, CalendarClock, Ban, ChevronRight, CheckCheck,
} from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { fmtDateTime, snippet, ymd } from '../lib/format.js';
import { Button } from './ui.jsx';
import { useMissedActions } from './PostDetail.jsx';
import { go } from '../lib/router.js';

export function Logo({ inverted, size = 'md' }) {
  return (
    <span className={`logo ${inverted ? 'inv' : ''} ${size}`}>
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="100%" height="100%"><path d="M6 10l4.5 12L16 13l5.500 9L26 10" fill="none" stroke="#fff" strokeWidth="3.200" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      <span className="logo-text">
        <b>Willy<em>Post</em></b>
        <small>by Willy SEO Academy</small>
      </span>
    </span>
  );
}

const NAV = [
  { path: '/', label: 'Calendario', short: 'Inicio', icon: CalendarDays, badge: 'claude' },
  { path: '/lista', label: 'Lista', icon: List },
  { path: '/manual', label: 'Para publicar a mano', short: 'A mano', icon: Hand, badge: 'manual' },
  { path: '/redes', label: 'Redes', icon: Plug, badge: 'accounts' },
  { path: '/medios', label: 'Medios', icon: Images },
  { path: '/claude', label: 'Claude', icon: Sparkles },
  { path: '/ajustes', label: 'Ajustes', icon: Settings },
  { path: '/ayuda', label: 'Ayuda', icon: CircleHelp },
];

const BADGE_TITLE = { claude: 'Propuestas de Claude pendientes de aprobar', manual: 'Publicaciones que te toca subir a mano', accounts: 'Redes que necesitan reconectarse' };

function Sidebar({ path }) {
  const app = useApp();
  const attention = app.accounts.filter((a) => a.status === 'expired' || a.status === 'expiring' || a.status === 'error').length;
  const badges = { claude: app.alerts.claudeDrafts.length, manual: app.alerts.manualCount, accounts: attention };
  return (
    <aside className="sidebar">
      <a href="#/" className="sidebar-logo"><Logo /></a>
      <nav>
        {NAV.map((n) => {
          const on = n.path === '/' ? path === '/' : path.startsWith(n.path);
          const count = n.badge ? badges[n.badge] : 0;
          return (
            <a key={n.path} href={'#' + n.path} className={`nav-item ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
              <n.icon size={20} />
              <span className="l-long">{n.label}</span>
              <span className="l-short">{n.short || n.label}</span>
              {count > 0 ? <em className={`nav-badge ${n.badge === 'accounts' ? 'warn' : ''}`} title={BADGE_TITLE[n.badge]}>{count}</em> : null}
            </a>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <div className="me">
          <span className="me-av">{(app.user.name || app.user.email || '?')[0].toUpperCase()}</span>
          <div><b>{app.user.name || 'Tu cuenta'}</b><small>{app.user.email}</small></div>
        </div>
        <button className="icon-btn" onClick={app.logout} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={18} /></button>
      </div>
    </aside>
  );
}

function Bell_() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const unread = app.notifications.filter((n) => !n.read).length;
  useEffect(() => {
    if (!open) return undefined;
    const on = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [open]);
  const readAll = async () => { await api.post('/api/notifications/read-all').catch(() => {}); app.refreshNotifications(); };
  return (
    <div className="bell" ref={ref}>
      <button className="icon-btn big" onClick={() => setOpen((v) => !v)} aria-label="Notificaciones" aria-expanded={open}>
        <Bell size={20} />
        {unread > 0 ? <em>{unread > 9 ? '9+' : unread}</em> : null}
      </button>
      {open && (
        <div className="pop notif-pop">
          <div className="pop-head">
            <b>Notificaciones</b>
            {unread > 0 && <button className="link" onClick={readAll}><CheckCheck size={14} /> Marcar todas como leídas</button>}
          </div>
          <div className="pop-list">
            {app.notifications.length === 0 ? <p className="pop-empty">Todo tranquilo por aquí. Cuando pase algo, te lo cuento.</p> : app.notifications.slice(0, 20).map((n) => (
              <button key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => { setOpen(false); if (n.post_id) app.openPost(n.post_id); }}>
                <b>{n.title}</b>
                {n.body ? <span>{snippet(n.body, 110)}</span> : null}
                <small>{fmtDateTime(n.created_at)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  const app = useApp();
  return (
    <header className="topbar">
      <label className="date-jump" title="Ir a una fecha">
        <CalendarSearch size={18} />
        <input type="date" aria-label="Ir a una fecha" defaultValue={ymd(new Date())} onChange={(e) => { if (e.target.value) { go('/'); app.gotoDate(e.target.value); } }} />
      </label>
      <div className="topbar-right">
        <Bell_ />
        <Button icon={Plus} onClick={() => app.openComposer({})}>Crear publicación</Button>
      </div>
    </header>
  );
}

// Aviso fijo cuando WillyPost deja de responder (por ejemplo, si se ha cerrado el programa).
function OfflineBanner() {
  const app = useApp();
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const bump = useRef(app.bump);
  bump.current = app.bump;
  useEffect(() => {
    const on = () => setOff(true);
    const back = () => { setOff(false); bump.current(); };
    window.addEventListener('wp:offline', on);
    window.addEventListener('wp:online', back);
    return () => { window.removeEventListener('wp:offline', on); window.removeEventListener('wp:online', back); };
  }, []);
  const retry = async () => { setBusy(true); try { await api.get('/api/health'); } catch { /* sigue sin conexión */ } finally { setBusy(false); } };
  useEffect(() => {
    if (!off) return undefined;
    const t = setInterval(() => { api.get('/api/health').catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [off]);
  if (!off) return null;
  return (
    <div className="alert error offline" role="alert">
      <WifiOff size={20} />
      <div className="alert-text"><b>WillyPost no responde.</b> Es posible que se haya cerrado. Ábrelo con su icono del escritorio; en cuanto vuelva, esta pantalla se actualizará sola. Tus publicaciones siguen guardadas.</div>
      <div className="alert-actions"><Button size="sm" variant="secondary" loading={busy} onClick={retry}>Reintentar</Button></div>
    </div>
  );
}

function Alerts() {
  const app = useApp();
  const [act, el] = useMissedActions(() => app.bump());
  const { missed, failed } = app.alerts;
  const bad = app.accounts.filter((a) => ['expired', 'error', 'expiring'].includes(a.status));
  if (!missed.length && !failed.length && !bad.length) return null;
  const expired = bad.filter((a) => a.status === 'expired' || a.status === 'error');
  return (
    <div className="alerts">
      {el}
      {missed.slice(0, 3).map((p) => (
        <div className="alert warn" key={p.id}>
          <AlertTriangle size={20} />
          <div className="alert-text">
            <b>No se publicó a su hora:</b> “{snippet(p.caption, 60) || 'Publicación sin texto'}” (era para el {fmtDateTime(p.scheduled_at)}). ¿Qué hacemos?
          </div>
          <div className="alert-actions">
            <Button size="sm" icon={Send} onClick={() => act(p, 'publish')}>Publicar ahora</Button>
            <Button size="sm" variant="secondary" icon={CalendarClock} onClick={() => act(p, 'reschedule')}>Reprogramar</Button>
            <Button size="sm" variant="ghost" icon={Ban} onClick={() => act(p, 'skip')}>Omitir</Button>
          </div>
        </div>
      ))}
      {missed.length > 3 && <div className="alert warn"><AlertTriangle size={20} /><div className="alert-text">Y {missed.length - 3} más sin publicar. <a href="#/lista">Verlas en la lista</a></div></div>}
      {expired.length > 0 && (
        <div className="alert error">
          <AlertTriangle size={20} />
          <div className="alert-text"><b>{expired.map((a) => a.name).join(', ')}</b>: {expired.length === 1 ? 'necesita' : 'necesitan'} que la reconectes para poder publicar.</div>
          <div className="alert-actions"><Button size="sm" variant="secondary" onClick={() => go('/redes')}>Ir a Redes <ChevronRight size={14} /></Button></div>
        </div>
      )}
      {bad.some((a) => a.status === 'expiring') && (
        <div className="alert warn">
          <AlertTriangle size={20} />
          <div className="alert-text">Reconecta pronto: {bad.filter((a) => a.status === 'expiring').map((a) => `${a.name} (${a.days_left} d)`).join(', ')}. Cada conexión dura 30 días.</div>
          <div className="alert-actions"><Button size="sm" variant="secondary" onClick={() => go('/redes')}>Reconectar <ChevronRight size={14} /></Button></div>
        </div>
      )}
      {failed.length > 0 && (
        <div className="alert error">
          <AlertTriangle size={20} />
          <div className="alert-text"><b>{failed.length} {failed.length === 1 ? 'publicación ha fallado' : 'publicaciones han fallado'}.</b> Ábrelas para ver el motivo y reintentar.</div>
          <div className="alert-actions"><Button size="sm" variant="secondary" onClick={() => go('/lista?estado=failed')}>Ver fallidas</Button></div>
        </div>
      )}
    </div>
  );
}

export default function Layout({ path, children }) {
  return (
    <div className="app">
      <Sidebar path={path} />
      <div className="main">
        <Header />
        <main className="content">
          <OfflineBanner />
          <Alerts />
          {children}
        </main>
      </div>
    </div>
  );
}
