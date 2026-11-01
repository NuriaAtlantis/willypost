import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, Copy, Check } from 'lucide-react';
import { copyText } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';

export function Button({ variant = 'primary', size, icon: Icon, loading, children, className = '', ...rest }) {
  return (
    <button
      className={`btn btn-${variant} ${size ? 'btn-' + size : ''} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={size === 'sm' ? 15 : 18} /> : null}
      {children}
    </button>
  );
}

export function IconBox({ icon: Icon, size = 44, tone = 'blue', round }) {
  return (
    <span className={`iconbox tone-${tone} ${round ? 'round' : ''}`} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.46)} />
    </span>
  );
}

export function Badge({ tone = 'gray', icon: Icon, children, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {Icon ? <Icon size={12} /> : null}
      {children}
    </span>
  );
}

export function Spinner({ label }) {
  return (
    <div className="spinner-wrap">
      <Loader2 className="spin" size={26} />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, action, compact }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      {Icon ? <IconBox icon={Icon} size={compact ? 52 : 68} round /> : null}
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, pill, sub, actions }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>
          {title} {pill ? <span className="pill-title">{pill}</span> : null}
        </h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

// Pila de ventanas abiertas: Escape solo cierra la de arriba.
const modalStack = [];

export function Modal({ open = true, onClose, title, subtitle, wide, xl, footer, children, className = '', hideClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const token = {};
    modalStack.push(token);
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Tab' && ref.current) {
        // El foco se queda dentro de la ventana abierta
        const items = [...ref.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0]; const last = items[items.length - 1];
        const act = document.activeElement;
        if (!ref.current.contains(act)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && (act === first || act === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current && closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    const t = setTimeout(() => {
      const el = ref.current && ref.current.querySelector('[data-autofocus]');
      if (el) el.focus(); else if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
      if (!modalStack.length) document.body.classList.remove('no-scroll');
      clearTimeout(t);
      if (prev && prev.focus) prev.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''} ${xl ? 'xl' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {(title || !hideClose) && (
          <div className="modal-head">
            <div>
              {title ? <h2>{title}</h2> : null}
              {subtitle ? <p className="modal-sub">{subtitle}</p> : null}
            </div>
            {!hideClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// Confirmación con promesa: const [confirm, confirmEl] = useConfirm(); if (await confirm({...})) ...
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => { state.resolve(v); setState(null); };
  const el = state ? (
    <Modal onClose={() => close(false)} title={state.title || '¿Seguro?'} hideClose
      footer={(
        <>
          <Button variant="secondary" onClick={() => close(false)}>{state.cancel || 'Cancelar'}</Button>
          <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>{state.ok || 'Sí, continuar'}</Button>
        </>
      )}>
      <p className="confirm-text">{state.text}</p>
    </Modal>
  ) : null;
  return [confirm, el];
}

export function CopyButton({ text, label = 'Copiar', done = 'Copiado', variant = 'secondary', size = 'sm', icon = true, className = '' }) {
  const [ok, setOk] = useState(false);
  const toast = useToast();
  const onClick = async () => {
    const r = await copyText(text);
    if (r) { setOk(true); setTimeout(() => setOk(false), 1800); } else toast.error('No he podido copiar. Selecciona el texto y copia con Ctrl+C.');
  };
  return (
    <Button variant={variant} size={size} onClick={onClick} icon={icon ? (ok ? Check : Copy) : undefined} className={className}>
      {ok ? done : label}
    </Button>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null ? <em>{t.count}</em> : null}
        </button>
      ))}
    </div>
  );
}

export function Ring({ days, total = 30, size = 56 }) {
  const d = Math.max(0, Math.min(total, days ?? 0));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const tone = d <= 0 ? 'var(--error)' : d <= 5 ? 'var(--warn)' : 'var(--azul-btn)';
  return (
    <div className="ring" style={{ width: size, height: size }} title={`${d} de ${total} días`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--azul-50)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - d / total)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span><b>{d}</b><i>días</i></span>
    </div>
  );
}
