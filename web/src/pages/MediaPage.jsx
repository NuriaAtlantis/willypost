import { useEffect, useState } from 'react';
import { Trash2, Images, Film, Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { fmtSize, fmtDayShort } from '../lib/format.js';
import { PageHeader, Spinner, Empty, Modal, Button, useConfirm } from '../components/ui.jsx';
import { Dropzone, MediaThumb } from '../components/Media.jsx';

export default function MediaPage() {
  const app = useApp();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [view, setView] = useState(null);
  const [confirm, confirmEl] = useConfirm();

  const load = () => api.get('/api/media').then(setItems).catch((e) => { toast.error(e.message); setItems([]); });
  useEffect(() => { load(); }, [app.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (m) => {
    if (!(await confirm({ title: 'Eliminar archivo', text: `Se borrará “${m.original_name}” de tu biblioteca. Las publicaciones que ya lo usan podrían quedarse sin imagen.`, ok: 'Sí, eliminar', danger: true }))) return;
    try { await api.del(`/api/media/${m.id}`); toast.success('Archivo eliminado.'); setView(null); load(); } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      {confirmEl}
      <PageHeader eyebrow="Tu biblioteca" title="Imágenes y" pill="vídeos" sub="Sube aquí tus archivos una vez y úsalos en todas tus publicaciones." />
      <div className="card">
        <Dropzone onUploaded={(list) => setItems((cur) => [...list, ...(cur || [])])} />
        {items === null ? <Spinner /> : items.length === 0 ? (
          <Empty icon={Images} title="Aún no has subido nada" text="Arrastra tus fotos y vídeos a la zona de arriba. Los verás aquí y podrás añadirlos a cualquier publicación." />
        ) : (
          <div className="media-grid">
            {items.map((m) => (
              <div className="media-cell lib" key={m.id}>
                <button type="button" className="media-open" onClick={() => setView(m)} aria-label={`Ver ${m.original_name}`}><MediaThumb m={m} /></button>
                <div className="media-meta">
                  <b title={m.original_name}>{m.original_name}</b>
                  <span>{m.kind === 'video' ? <Film size={12} /> : null} {m.width && m.height ? `${m.width}×${m.height} · ` : ''}{fmtSize(m.size)} · {fmtDayShort(m.created_at)}</span>
                </div>
                <button className="media-del" onClick={() => del(m)} title="Eliminar" aria-label="Eliminar"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {view && (
        <Modal wide onClose={() => setView(null)} title={view.original_name} subtitle={`${view.mime} · ${fmtSize(view.size)}`}
          footer={(<><Button variant="ghost" icon={Trash2} onClick={() => del(view)}>Eliminar</Button><span className="spacer" /><a className="btn btn-secondary" href={`${view.url}?download=1`} download={view.original_name}><Download size={18} /> Descargar</a></>)}>
          <div className="lightbox"><MediaThumb m={view} full /></div>
        </Modal>
      )}
    </div>
  );
}
