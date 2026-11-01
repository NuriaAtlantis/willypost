import { useState } from 'react';
import { ArrowRight, Download, ShieldCheck, KeyRound, Eye, EyeOff, CalendarDays, Sparkles, Plug } from 'lucide-react';
import { api } from '../lib/api.js';
import { downloadText, copyText } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { go } from '../lib/router.js';
import { Button, Field, CopyButton } from '../components/ui.jsx';
import { Logo } from '../components/Layout.jsx';

function Shell({ children, headline }) {
  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="halo" />
        <Logo inverted size="lg" />
        <div className="auth-claim">
          <h1>{headline}</h1>
          <p>El programador de redes sociales que te regala la Willy SEO Academy. Gratis, en tu ordenador y con Claude dentro.</p>
          <ul>
            <li><span><CalendarDays size={18} /></span> Calendario visual con arrastrar y soltar</li>
            <li><span><Plug size={18} /></span> Instagram, Facebook, TikTok, YouTube, LinkedIn y más</li>
            <li><span><Sparkles size={18} /></span> Pídele a Claude una campaña entera y apruébala</li>
          </ul>
        </div>
        <small className="auth-foot">Tus datos y tus claves se quedan en tu ordenador.</small>
      </section>
      <section className="auth-form">
        <div className="auth-card">{children}</div>
      </section>
    </div>
  );
}

export function RecoveryStep({ code, title = 'Guarda tu código de recuperación', onDone, doneLabel = 'Ya lo he guardado, continuar' }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const download = () => {
    downloadText('willypost-codigo-de-recuperacion.txt', `WillyPost · Código de recuperación\n\n${code}\n\nGuarda este archivo en un sitio seguro (fuera de este ordenador, si puedes).\nLo necesitarás si olvidas tu contraseña: no hay otra forma de recuperarla.\n`);
    setDownloaded(true);
    toast.success('Código descargado. Guárdalo en un lugar seguro.');
  };
  return (
    <Shell headline={<>Un último paso: <span className="pill-title">guárdalo</span></>}>
      <div className="auth-icon"><ShieldCheck size={28} /></div>
      <h2>{title}</h2>
      <p className="auth-sub">Todo se queda en tu ordenador, así que no hay “recuperar por email”. Si olvidas la contraseña, este código es la <b>única</b> forma de volver a entrar.</p>
      <div className="recovery-code" aria-label="Código de recuperación">{code}</div>
      <div className="btn-row">
        <Button variant="secondary" icon={Download} onClick={download}>Descargar como .txt</Button>
        <CopyButton text={code} label="Copiar código" size="md" />
      </div>
      <label className="check-row">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>He guardado el código en un lugar seguro{downloaded ? ' (descargado)' : ''}.</span>
      </label>
      <Button className="wide" disabled={!saved} onClick={onDone}>{doneLabel} <ArrowRight size={18} /></Button>
    </Shell>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete, ...rest }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input className="input" type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete} {...rest} />
      <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
  );
}

export default function Auth({ mode, hasUsers, onLogin, onRegistered, onResetDone }) {
  const [m, setM] = useState(mode); // 'login' | 'registro' | 'reset'
  const [f, setF] = useState({ name: '', email: '', password: '', recoveryCode: '', newPassword: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (m === 'login') {
        const r = await api.post('/api/auth/login', { email: f.email.trim(), password: f.password });
        onLogin(r.user);
      } else if (m === 'registro') {
        if (f.password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const r = await api.post('/api/auth/register', { name: f.name.trim(), email: f.email.trim(), password: f.password });
        onRegistered(r.user, r.recoveryCode);
      } else {
        if (f.newPassword.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
        const r = await api.post('/api/auth/reset', { email: f.email.trim(), recoveryCode: f.recoveryCode.trim(), newPassword: f.newPassword });
        onResetDone(r.recoveryCode);
      }
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const switchTo = (to) => { setM(to); setErr(''); if (to !== 'reset') go(to === 'login' ? '/login' : '/registro'); };

  return (
    <Shell headline={m === 'registro' ? <>Programa tus redes <span className="pill-title">sin estrés</span></> : m === 'reset' ? <>Vuelve a <span className="pill-title">entrar</span></> : <>Te estábamos <span className="pill-title">esperando</span></>}>
      <div className="auth-icon">{m === 'reset' ? <KeyRound size={28} /> : <CalendarDays size={28} />}</div>
      <h2>{m === 'registro' ? 'Crea tu cuenta' : m === 'reset' ? 'Restablece tu contraseña' : 'Entra en WillyPost'}</h2>
      <p className="auth-sub">
        {m === 'registro' ? 'Es gratis y se guarda solo en tu ordenador. No te enviaremos ningún email.' : m === 'reset' ? 'Usa el código de recuperación que guardaste al registrarte.' : 'Tu calendario de publicaciones te espera.'}
      </p>
      <form onSubmit={submit} className="auth-fields">
        {m === 'registro' && <Field label="Tu nombre"><input className="input" value={f.name} onChange={set('name')} placeholder="Ana García" autoComplete="name" required autoFocus /></Field>}
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} placeholder="tu@email.com" autoComplete="email" required autoFocus={m !== 'registro'} /></Field>
        {m !== 'reset' && (
          <Field label="Contraseña" hint={m === 'registro' ? 'Mínimo 8 caracteres.' : undefined}>
            <PasswordInput value={f.password} onChange={set('password')} placeholder="••••••••" autoComplete={m === 'login' ? 'current-password' : 'new-password'} required />
          </Field>
        )}
        {m === 'reset' && (
          <>
            <Field label="Código de recuperación"><input className="input mono" value={f.recoveryCode} onChange={set('recoveryCode')} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" required /></Field>
            <Field label="Nueva contraseña" hint="Mínimo 8 caracteres."><PasswordInput value={f.newPassword} onChange={set('newPassword')} placeholder="••••••••" autoComplete="new-password" required /></Field>
          </>
        )}
        {err && <div className="notice error" role="alert"><div>{err}</div></div>}
        <Button type="submit" loading={busy} className="wide">
          {m === 'registro' ? 'Crear mi cuenta' : m === 'reset' ? 'Cambiar contraseña' : 'Entrar'} <ArrowRight size={18} />
        </Button>
      </form>
      <div className="auth-links">
        {m === 'login' && <button className="link" onClick={() => switchTo('reset')}>¿Olvidaste la contraseña?</button>}
        {m === 'login' && <span>¿Primera vez? <button className="link" onClick={() => switchTo('registro')}>Crea tu cuenta</button></span>}
        {m === 'registro' && hasUsers && <span>¿Ya tienes cuenta? <button className="link" onClick={() => switchTo('login')}>Entra</button></span>}
        {m === 'reset' && <button className="link" onClick={() => switchTo('login')}>Volver a entrar</button>}
      </div>
    </Shell>
  );
}
