import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, Info, X } from 'lucide-react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(1);
  const remove = useCallback((id) => setItems((s) => s.filter((t) => t.id !== id)), []);
  const push = useCallback((kind, text, ms) => {
    const id = idRef.current++;
    // Si ya se está mostrando exactamente el mismo aviso, no lo repetimos.
    setItems((s) => (s.some((t) => t.text === text && t.kind === kind) ? s : [...s, { id, kind, text }]));
    setTimeout(() => remove(id), ms || (kind === 'error' ? 8000 : 4500));
  }, [remove]);
  const api = useMemo(() => ({
    success: (t, ms) => push('success', t, ms),
    error: (t, ms) => push('error', t, ms),
    info: (t, ms) => push('info', t, ms),
  }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'success' ? <CircleCheck size={20} /> : t.kind === 'error' ? <CircleAlert size={20} /> : <Info size={20} />}
            <span>{t.text}</span>
            <button className="toast-x" onClick={() => remove(t.id)} aria-label="Cerrar"><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
