import { useCallback, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { api } from './lib/api.js';
import { go, useRoute } from './lib/router.js';
import { AppProvider } from './lib/store.jsx';
import { Button, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Composer from './components/Composer.jsx';
import PostDetail from './components/PostDetail.jsx';
import Auth, { RecoveryStep } from './pages/Auth.jsx';
import Calendar from './pages/Calendar.jsx';
import ListPage from './pages/ListPage.jsx';
import Manual from './pages/Manual.jsx';
import Networks from './pages/Networks.jsx';
import MediaPage from './pages/MediaPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import ClaudePage from './pages/ClaudePage.jsx';
import Help from './pages/Help.jsx';

const PAGES = {
  '/': Calendar,
  '/lista': ListPage,
  '/manual': Manual,
  '/redes': Networks,
  '/medios': MediaPage,
  '/ajustes': SettingsPage,
  '/claude': ClaudePage,
  '/ayuda': Help,
};

export default function App() {
  const route = useRoute();
  const [boot, setBoot] = useState({ loading: true, error: null, hasUsers: true });
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({});
  const [recovery, setRecovery] = useState(null); // { code, then: 'app' | 'login' }

  const load = useCallback(async () => {
    setBoot((b) => ({ ...b, loading: true, error: null }));
    try {
      const s = await api.get('/api/auth/state');
      let u = s.user || null;
      let st = {};
      if (u) {
        const me = await api.get('/api/me');
        u = me.user || u;
        st = me.settings || {};
      }
      setUser(u);
      setSettings(st);
      setBoot({ loading: false, error: null, hasUsers: s.hasUsers });
    } catch (e) {
      setBoot({ loading: false, error: e.message, hasUsers: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const on = () => setUser(null);
    window.addEventListener('wp:unauthorized', on);
    return () => window.removeEventListener('wp:unauthorized', on);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } catch { /* da igual */ }
    setUser(null);
    go('/login');
  }, []);

  // Redirecciones según sesión
  const isAuthRoute = route.path === '/login' || route.path === '/registro';
  useEffect(() => {
    if (boot.loading || boot.error || recovery) return;
    if (!user && !isAuthRoute) go(boot.hasUsers ? '/login' : '/registro');
    if (user && isAuthRoute) go('/');
  }, [boot, user, isAuthRoute, recovery]);

  if (boot.loading) return <div className="boot"><Spinner label="Abriendo WillyPost…" /></div>;
  if (boot.error) {
    return (
      <div className="boot">
        <div className="boot-card">
          <WifiOff size={36} />
          <h2>No consigo conectar con WillyPost</h2>
          <p>{boot.error}</p>
          <Button onClick={load}>Reintentar</Button>
        </div>
      </div>
    );
  }

  if (recovery) {
    return (
      <RecoveryStep
        code={recovery.code}
        title={recovery.then === 'login' ? 'Este es tu nuevo código de recuperación' : undefined}
        doneLabel={recovery.then === 'login' ? 'Ya lo he guardado, entrar' : undefined}
        onDone={() => {
          const then = recovery.then;
          setRecovery(null);
          go(then === 'login' ? '/login' : '/');
          if (then === 'login') load();
        }}
      />
    );
  }

  if (!user) {
    const mode = route.path === '/registro' || !boot.hasUsers ? 'registro' : 'login';
    return (
      <Auth
        key={mode}
        mode={mode}
        hasUsers={boot.hasUsers}
        onLogin={async () => { await load(); go('/'); }}
        onRegistered={(u, code) => { setUser(u); setBoot((b) => ({ ...b, hasUsers: true })); setRecovery({ code, then: 'app' }); api.get('/api/me').then((me) => setSettings(me.settings || {})).catch(() => {}); }}
        onResetDone={(code) => setRecovery({ code, then: 'login' })}
      />
    );
  }

  const Page = PAGES[route.path] || Calendar;
  return (
    <AppProvider initialUser={user} initialSettings={settings} onLogout={logout}>
      <Layout path={PAGES[route.path] ? route.path : '/'}>
        <Page query={route.query} />
      </Layout>
      <Composer />
      <PostDetail />
    </AppProvider>
  );
}
