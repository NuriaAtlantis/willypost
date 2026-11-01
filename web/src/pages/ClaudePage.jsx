import { useEffect, useState } from 'react';
import { Bot, Monitor, Terminal, MessageSquareText, KeyRound, Check, Copy, ShieldCheck, FileEdit, CalendarCheck, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { Button, PageHeader, IconBox, CopyButton, Switch, Badge, Spinner } from '../components/ui.jsx';

const EXAMPLES = [
  'Hazme una campaña de Black Friday de 2 semanas para Instagram y TikTok.',
  'Mira mi calendario y dime qué huecos libres tengo esta semana en Instagram.',
  'Escribe 5 posts para LinkedIn sobre errores típicos de SEO local y prográmalos a las 9:00 de lunes a viernes.',
  'Convierte este texto en versiones para Instagram, Facebook y Threads, con hashtags solo en Instagram.',
  'Prepárame un carrusel de 6 imágenes con consejos para mi negocio y déjalo como borrador.',
  'Reorganiza la próxima semana para que no haya más de 1 publicación al día en cada red.',
];

export default function ClaudePage() {
  const app = useApp();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState('');
  const [adv, setAdv] = useState(false);
  const mode = app.claudeMode;

  const load = () => api.get('/api/claude').then(setInfo).catch((e) => { toast.error(e.message); setInfo({}); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const install = async () => {
    setBusy('install');
    try {
      const r = await api.post('/api/claude/install-desktop');
      toast.success('Listo. Cierra Claude Desktop del todo y ábrelo otra vez para ver WillyPost.', 9000);
      setInfo((i) => ({ ...i, desktopInstalled: true, desktopConfigPath: (r && r.path) || (i && i.desktopConfigPath) }));
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const genToken = async () => {
    setBusy('token');
    try { const r = await api.post('/api/claude/token'); setToken(r.token); load(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const revoke = async () => {
    if (!window.confirm('¿Desconectar Claude? Dejará de poder usar WillyPost hasta que lo vuelvas a conectar.')) return;
    setBusy('revoke');
    try { await api.del('/api/claude/token'); setToken(null); toast.success('Claude desconectado.'); load(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const setMode = async (m) => {
    try { await app.saveSettings({ claude_mode: m }); toast.success(m === 'schedule' ? 'Claude programará directamente.' : 'Claude dejará borradores para que los apruebes.'); } catch (e) { toast.error(e.message); }
  };

  if (!info) return <Spinner />;
  // Si acabas de generar el token, lo ponemos ya dentro del comando para que solo tengas que copiarlo.
  const codeCmd = info.claudeCodeCommand ? (token ? info.claudeCodeCommand.replace('<TU_TOKEN>', token) : info.claudeCodeCommand) : '';
  const needsToken = !!info.claudeCodeCommand && !token && info.claudeCodeCommand.includes('<TU_TOKEN>');
  const mcpJson = info.mcp ? JSON.stringify({ mcpServers: { willypost: info.mcp } }, null, 2) : '';

  return (
    <div>
      <PageHeader eyebrow="Inteligencia artificial" title="Trabaja con" pill="Claude"
        sub="Conecta Claude a WillyPost y pídele campañas enteras con lenguaje normal. Él las prepara, tú las apruebas." />

      <div className="steps3">
        <div className="card step-card">
          <span className="step-num">1</span>
          <IconBox icon={Monitor} />
          <h3>Conéctalo</h3>
          <p>Un clic y Claude Desktop sabrá usar WillyPost. Si usas Claude Code, copia el comando de abajo.</p>
        </div>
        <div className="card step-card">
          <span className="step-num">2</span>
          <IconBox icon={MessageSquareText} />
          <h3>Pídele lo que quieras</h3>
          <p>“Hazme una campaña de Black Friday…”. Claude mira tu calendario, escribe los textos y los organiza.</p>
        </div>
        <div className="card step-card">
          <span className="step-num">3</span>
          <IconBox icon={ShieldCheck} />
          <h3>Revisa y aprueba</h3>
          <p>Verás sus propuestas con la etiqueta “Propuesto por Claude” y las apruebas con un clic.</p>
        </div>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="set-head"><IconBox icon={Monitor} /><div><h3>Claude Desktop</h3><p>La forma más fácil para empezar.</p></div>
            {info.desktopInstalled ? <Badge tone="green" icon={Check}>Conectado</Badge> : null}</div>
          <p>Pulsa el botón y WillyPost se añade solo a la configuración de Claude Desktop. Después, reinicia Claude Desktop.</p>
          <Button icon={Bot} loading={busy === 'install'} onClick={install}>{info.desktopInstalled ? 'Volver a conectar con Claude Desktop' : 'Conectar con Claude Desktop'}</Button>
          {info.desktopConfigPath ? <small className="muted block mt">Archivo de configuración: <code>{info.desktopConfigPath}</code></small> : null}
        </section>

        <section className="card">
          <div className="set-head"><IconBox icon={Terminal} /><div><h3>Claude Code</h3><p>Si trabajas desde la terminal.</p></div></div>
          <p>Pega este comando en tu terminal una sola vez:</p>
          {needsToken ? (
            <>
              <p className="muted">Este comando necesita tu token personal (como una contraseña para Claude). Pulsa el botón y lo pongo dentro del comando por ti.{info.hasToken ? ' Ya habías generado uno: el nuevo sustituirá al anterior.' : ''}</p>
              <Button variant="secondary" icon={KeyRound} loading={busy === 'token'} onClick={genToken}>Generar mi token</Button>
            </>
          ) : codeCmd ? (
            <>
              <div className="code-box"><code>{codeCmd}</code><CopyButton text={codeCmd} /></div>
              {token ? <small className="muted">Este comando ya lleva tu token. Cópialo ahora: por seguridad no volveré a mostrarlo.</small> : null}
            </>
          ) : <p className="muted">Cargando…</p>}
        </section>
      </div>

      <section className="card mt-lg">
        <div className="set-head"><IconBox icon={FileEdit} /><div><h3>¿Qué hace Claude con lo que crea?</h3><p>Tú decides cuánta libertad le das.</p></div></div>
        <div className="mode-grid">
          <button className={`mode-card ${mode === 'draft' ? 'on' : ''}`} onClick={() => setMode('draft')}>
            <FileEdit size={22} />
            <b>Que me lo proponga como borrador <Badge tone="green">Recomendado</Badge></b>
            <span>Todo lo que cree Claude llegará como borrador “Propuesto por Claude”. No sale nada hasta que lo apruebes.</span>
          </button>
          <button className={`mode-card ${mode === 'schedule' ? 'on' : ''}`} onClick={() => setMode('schedule')}>
            <CalendarCheck size={22} />
            <b>Que programe directamente</b>
            <span>Claude deja las publicaciones programadas y saldrán a su hora. Revisa el calendario de vez en cuando.</span>
          </button>
        </div>
        <div className="mode-switch">
          <Switch checked={mode === 'schedule'} onChange={(v) => setMode(v ? 'schedule' : 'draft')} label="Claude programa directamente" />
          <span>{mode === 'schedule' ? 'Claude programa directamente' : 'Claude deja borradores para que los apruebes'}</span>
        </div>
      </section>

      <section className="card mt-lg">
        <div className="set-head"><IconBox icon={Sparkles} /><div><h3>Prueba a pedirle esto</h3><p>Copia una frase y pégala en Claude.</p></div></div>
        <div className="examples">
          {EXAMPLES.map((e) => (
            <div className="example" key={e}>
              <p>“{e}”</p>
              <CopyButton text={e} />
            </div>
          ))}
        </div>
      </section>

      <section className="card mt-lg">
        <div className="set-head"><IconBox icon={KeyRound} /><div><h3>Acceso avanzado</h3><p>Token para conectar otros programas compatibles con MCP.</p></div>
          <Button variant="ghost" size="sm" onClick={() => setAdv((v) => !v)}>{adv ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {adv ? 'Ocultar' : 'Mostrar'}</Button></div>
        {adv && (
          <>
            <p>El token es como una contraseña para Claude. {info.hasToken ? 'Ya tienes uno; si generas otro, el anterior dejará de funcionar.' : 'Aún no has generado ninguno.'}</p>
            <div className="btn-row">
              <Button variant="secondary" icon={KeyRound} loading={busy === 'token'} onClick={genToken}>{info.hasToken ? 'Generar token nuevo' : 'Generar token'}</Button>
              {info.hasToken ? <Button variant="ghost" loading={busy === 'revoke'} onClick={revoke}>Desconectar Claude</Button> : null}
            </div>
            {token && (
              <div className="notice warn mt"><div>
                <b>Cópialo ahora: no volverás a verlo.</b>
                <div className="code-box"><code>{token}</code><CopyButton text={token} /></div>
              </div></div>
            )}
            {mcpJson && (
              <>
                <p className="mt">Configuración MCP (para conectar a mano):</p>
                <div className="code-box block"><pre>{mcpJson}</pre><CopyButton text={mcpJson} /></div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
