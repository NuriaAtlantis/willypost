import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { parseSetting } from './format.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const safe = (p, fb) => p.catch(() => fb);

export function AppProvider({ initialUser, initialSettings, onLogout, children }) {
  const [user, setUser] = useState(initialUser);
  const [settings, setSettings] = useState(initialSettings || {});
  const [networks, setNetworks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [alerts, setAlerts] = useState({ missed: [], failed: [], claudeDrafts: [], manualCount: 0 });
  const [version, setVersion] = useState(0);
  const [composer, setComposer] = useState(null); // { post?, date?, type? }
  const [detailId, setDetailId] = useState(null);
  const [goto, setGoto] = useState(null);
  const timer = useRef(null);

  const refreshNetworks = useCallback(async () => {
    const n = await safe(api.get('/api/networks'), null);
    if (n) setNetworks(n);
    return n;
  }, []);
  const refreshAccounts = useCallback(async () => {
    const a = await safe(api.get('/api/accounts'), null);
    if (a) setAccounts(a);
    setAccountsLoaded(true);
    return a;
  }, []);
  const refreshNotifications = useCallback(async () => {
    const n = await safe(api.get('/api/notifications'), null);
    if (n) setNotifications(Array.isArray(n) ? n : (n.items || []));
  }, []);
  const refreshAlerts = useCallback(async () => {
    const [missed, failed, drafts, manual, partial] = await Promise.all([
      safe(api.get('/api/posts?status=missed'), []),
      safe(api.get('/api/posts?status=failed'), []),
      safe(api.get('/api/posts?status=draft'), []),
      safe(api.get('/api/posts?status=manual'), []),
      safe(api.get('/api/posts?status=partial'), []),
    ]);
    const manualCount = [...manual, ...partial].reduce((n, p) => n + (p.targets || []).filter((t) => t.status === 'manual_pending').length, 0);
    setAlerts({
      missed,
      failed,
      claudeDrafts: drafts.filter((p) => p.created_by === 'claude'),
      manualCount,
    });
  }, []);

  const refreshAll = useCallback(() => Promise.all([refreshAccounts(), refreshNotifications(), refreshAlerts()]), [refreshAccounts, refreshNotifications, refreshAlerts]);

  // Avisa a las pantallas de que los datos han cambiado
  const bump = useCallback(() => {
    setVersion((v) => v + 1);
    refreshAlerts();
    refreshNotifications();
  }, [refreshAlerts, refreshNotifications]);

  // Al cambiar de pantalla (botón Atrás, enlaces…) se cierran las ventanas abiertas.
  useEffect(() => {
    const on = () => { setComposer(null); setDetailId(null); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    refreshNetworks();
    refreshAll();
    timer.current = setInterval(() => {
      if (document.visibilityState === 'visible') { refreshAlerts(); refreshNotifications(); }
    }, 30000);
    return () => clearInterval(timer.current);
  }, [refreshNetworks, refreshAll, refreshAlerts, refreshNotifications]);

  const saveSettings = useCallback(async (patch) => {
    const r = await api.put('/api/settings', patch);
    setSettings((s) => ({ ...s, ...(r && r.settings ? r.settings : patch) }));
    return r;
  }, []);

  const value = useMemo(() => ({
    user, setUser, settings, saveSettings, networks, accounts, accountsLoaded, notifications, alerts, version,
    refreshNetworks, refreshAccounts, refreshNotifications, refreshAlerts, bump,
    composer, openComposer: (opts = {}) => setComposer(opts), closeComposer: () => setComposer(null),
    detailId, openPost: (id) => setDetailId(id), closePost: () => setDetailId(null),
    goto, gotoDate: (date) => setGoto({ date, n: Date.now() }),
    logout: onLogout,
    queueTimes: (() => {
      const q = parseSetting(settings.queue_times, ['09:00', '13:00', '19:00']);
      return Array.isArray(q) ? q : ['09:00', '13:00', '19:00'];
    })(),
    claudeMode: settings.claude_mode || 'draft',
    netById: (id) => networks.find((n) => n.id === id),
  }), [user, settings, saveSettings, networks, accounts, accountsLoaded, notifications, alerts, version, refreshNetworks, refreshAccounts, refreshNotifications, refreshAlerts, bump, composer, detailId, goto, onLogout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
