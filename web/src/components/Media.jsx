import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, ImageOff, Upload, Check, Loader2, Images } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { fmtSize } from '../lib/format.js';
import { Button, Modal, Spinner, Empty } from './ui.jsx';

export function MediaThumb({ m, className = '', full }) {
  const [bad, setBad] = useState(false);
  if (!m) return <div className={`mthumb empty ${className}`}><ImageOff size={18} /></div>;
  const src = full ? m.url : (m.thumb || m.url);
  if (m.kind === 'video' && (full || bad)) {
    return (
      <div className={`mthumb ${className}`}>
        <video src={`${m.url}#t=0.3`} muted playsInline preload="metadata" controls={full} />
        {!full && <span className="mthumb-play"><Film size={14} /></span>}
      </div>
    );
  }
  if (bad) return <div className={`mthumb empty ${className}`}><ImageOff size={18} /></div>;
  return (
    <div className={`mthumb ${className}`}>
      <img src={src} alt={m.original_name || ''} loading="lazy" onError={() => setBad(true)} draggable={false} />
      {m.kind === 'video' && !full ? <span className="mthumb-play"><Film size={14} /></span> : null}
    </div>
  );
}

// Zona de arrastrar y soltar + botón de elegir archivos
export function Dropzone({ onUploaded, compact, accept = 'image/*,video/*', multiple = true }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const toast = useToast();

  const upload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const res = await api.upload('/api/media', files);
      const list = Array.isArray(res) ? res : res && res.media ? res.media : [];
      toast.success(list.length === 1 ? 'Archivo subido.' : `${list.length} archivos subidos.`);
      onUploaded && onUploaded(list);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
      onClick={() => input.current && input.current.click()}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current && input.current.click(); } }}
    >
      {busy ? <Loader2 className="spin" size={22} /> : <Upload size={22} />}
      <div>
        <b>{busy ? 'Subiendo…' : compact ? 'Sube imágenes o vídeos: haz clic o arrástralos aquí' : 'Arrastra aquí tus imágenes o vídeos'}</b>
        {!compact && <span>o haz clic para elegirlos en tu ordenador</span>}
      </div>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// Biblioteca para elegir medios (modal)
export function MediaPicker({ onClose, onPick, selectedIds = [], max = 10, filterKind }) {
  const [items, setItems] = useState(null);
  const [sel, setSel] = useState([]);
  const toast = useToast();
  useEffect(() => { api.get('/api/media').then(setItems).catch((e) => { toast.error(e.message); setItems([]); }); }, [toast]);
  const shown = useMemo(() => (items || []).filter((m) => !filterKind || m.kind === filterKind), [items, filterKind]);
  const room = Math.max(0, max - selectedIds.length);
  const toggle = (m) => setSel((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : s.length < room ? [...s, m.id] : s));
  return (
    <Modal onClose={onClose} wide title="Elige de tu biblioteca" subtitle={room ? `Puedes añadir hasta ${room} más.` : 'Ya has llegado al máximo de archivos.'}
      footer={(<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!sel.length} onClick={() => onPick(sel.map((id) => (items || []).find((m) => m.id === id)).filter(Boolean))}>Añadir {sel.length || ''} {sel.length === 1 ? 'archivo' : 'archivos'}</Button></>)}>
      <Dropzone compact onUploaded={(list) => { setItems((cur) => [...list, ...(cur || [])]); setSel((s) => [...s, ...list.map((m) => m.id)].slice(0, room)); }} />
      {items === null ? <Spinner /> : shown.length === 0 ? (
        <Empty compact icon={Images} title="Tu biblioteca está vacía" text="Sube tu primera imagen o vídeo y aparecerá aquí." />
      ) : (
        <div className="media-grid picker">
          {shown.map((m) => {
            const used = selectedIds.includes(m.id);
            const on = sel.includes(m.id);
            return (
              <button key={m.id} type="button" className={`media-cell ${on ? 'on' : ''} ${used ? 'used' : ''}`} onClick={() => !used && toggle(m)} disabled={used}>
                <MediaThumb m={m} />
                {on ? <span className="media-check"><Check size={16} /></span> : null}
                {used ? <span className="media-used">Ya añadido</span> : null}
                <span className="media-name">{m.original_name} · {fmtSize(m.size)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
