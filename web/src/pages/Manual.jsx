import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Check, Hand, PartyPopper, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.jsx';
import { useToast } from '../lib/toast.jsx';
import { copyText, fmtDateTime } from '../lib/format.js';
import { NET_SITE, TYPE_LABEL } from '../lib/constants.js';
import { Button, PageHeader, Spinner, Empty, Badge, Field } from '../components/ui.jsx';
import { NetIcon, netColor, netLabel } from '../components/NetIcon.jsx';
import { MediaThumb } from '../components/Media.jsx';

export default function Manual() {
  const app = useApp();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [busy, setBusy] = useState(null);
  const [urls, setUrls] = useState({});
  const [openUrl, setOpenUrl] = useState({});
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/api/posts?status=manual').catch(() => []),
      api.get('/api/posts?status=partial').catch(() => []),
      api.get('/api/posts?status=scheduled').catch(() => []),
    ]).then(([m, p, s]) => {
      const list = [];
      [...m, ...p].forEach((post) => (post.targets || []).forEach((t) => { if (t.status === 'manual_pending') list.push({ post, target: t }); }));
      list.sort((a, b) => new Date(a.post.scheduled_at || 0) - new Date(b.post.scheduled_at || 0));
      setItems(list);
      const up = [];
      s.forEach((post) => (post.targets || []).forEach((t) => { if (t.delivery === 'manual' && t.status === 'pending') up.push({ post, target: t }); }));
      up.sort((a, b) => new Date(a.post.scheduled_at || 0) - new Date(b.post.scheduled_at || 0));
      setUpcoming(up);
    });
  }, [app.version]);

  const copy = async (key, text) => {
    if (await copyText(text)) { setCopied(key); toast.success('Texto copiado. Ya puedes pegarlo en la red.'); setTimeout(() => setCopied(null), 2000); } else toast.error('No he podido copiar. Selecciona el texto y usa Ctrl+C.');
  };
  const downloadAll = (list) => {
    // Los navegadores aceptan varias descargas seguidas si van con un pequeño margen.
    list.forEach((m, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = `${m.url}?download=1`; a.download = m.original_name || `archivo-${m.id}`;
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 400));
    toast.info('Descargando los archivos. Si tu navegador pregunta, permite las descargas múltiples.');
  };
  const done = async (t) => {
    setBusy(t.id);
    try {
      const url = (urls[t.id] || '').trim();
      await api.post(`/api/targets/${t.id}/manual-done`, url ? { url } : {});
      toast.success('¡Genial! Marcada como publicada.');
      app.bump();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader eyebrow="Modo manual" title="Para publicar" pill="a mano"
        sub="Estas publicaciones no se pueden enviar solas. Copia el texto, descarga los archivos, súbelo a la red y pulsa “Ya lo he publicado”." />

      {items === null ? <Spinner /> : items.length === 0 ? (
        <div className="card">
          <Empty icon={PartyPopper} title="No tienes nada pendiente a mano"
            text="Cuando llegue la hora de una publicación en modo manual, te avisaré con una notificación y aparecerá aquí con todo preparado."
            action={<Button variant="secondary" onClick={() => app.openComposer({})}>Crear publicación</Button>} />
        </div>
      ) : (
        <div className="manual-list">
          {items.map(({ post, target: t }) => {
            const text = t.caption != null ? t.caption : post.caption || '';
            const key = `${post.id}-${t.id}`;
            const site = NET_SITE[t.network];
            return (
              <article className="card manual-card" key={key}>
                <header>
                  <NetIcon id={t.network} size={42} color={netColor(t.network, app.networks)} />
                  <div>
                    <h3>{netLabel(t.network, app.networks)} <span>{t.account_name}</span></h3>
                    <small><Clock size={13} /> Tocaba publicar: {fmtDateTime(post.scheduled_at)} · {TYPE_LABEL[post.type]}</small>
                  </div>
                  <Badge tone="amber" icon={Hand}>Toca publicar</Badge>
                </header>
                {t.error ? <div className="notice warn"><div>{t.error}</div></div> : null}
                {t.warning ? <div className="notice warn"><div>{t.warning}</div></div> : null}
                <div className="manual-body">
                  <div className="manual-text">
                    <div className="manual-label">1. Copia el texto</div>
                    <pre>{text || '(Sin texto)'}</pre>
                    <Button variant={copied === key ? 'secondary' : 'primary'} icon={copied === key ? Check : Copy} onClick={() => copy(key, text)} disabled={!text}>{copied === key ? 'Copiado' : 'Copiar texto'}</Button>
                  </div>
                  <div className="manual-files">
                    <div className="manual-label">2. Descarga los archivos</div>
                    {post.media && post.media.length ? (
                      <div className="manual-media">
                        {post.media.map((m, i) => (
                          <a key={m.id} href={`${m.url}?download=1`} download={m.original_name || `archivo-${m.id}`} className="manual-file" title="Descargar">
                            <MediaThumb m={m} />
                            <span><Download size={14} /> {m.kind === 'video' ? 'Vídeo' : 'Imagen'}{post.media.length > 1 ? ` ${i + 1}` : ''}</span>
                          </a>
                        ))}
                      </div>
                    ) : <p className="muted">Esta publicación no lleva archivos.</p>}
                    {post.media && post.media.length > 1 ? <Button variant="secondary" size="sm" icon={Download} onClick={() => downloadAll(post.media)}>Descargar todos</Button> : null}
                  </div>
                  <div className="manual-go">
                    <div className="manual-label">3. Publícalo en {netLabel(t.network, app.networks)}</div>
                    {site ? <a className="btn btn-secondary" href={site} target="_blank" rel="noreferrer"><ExternalLink size={18} /> Abrir {netLabel(t.network, app.networks)}</a> : null}
                    <Button icon={Check} loading={busy === t.id} onClick={() => done(t)}>Ya lo he publicado</Button>
                    <button className="link" onClick={() => setOpenUrl((o) => ({ ...o, [t.id]: !o[t.id] }))}>
                      {openUrl[t.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Guardar el enlace (opcional)
                    </button>
                    {openUrl[t.id] && (
                      <Field><input className="input" placeholder="https://…" value={urls[t.id] || ''} onChange={(e) => setUrls((u) => ({ ...u, [t.id]: e.target.value }))} /></Field>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="card mt-lg">
          <h3 className="sec-title">Próximas en modo manual</h3>
          <p className="muted">A su hora te avisaré con una notificación de escritorio (mantén WillyPost abierto).</p>
          <div className="rows compact">
            {upcoming.map(({ post, target: t }) => (
              <div className="row static" key={`${post.id}-${t.id}`} onClick={() => app.openPost(post.id)} role="button" tabIndex={0}>
                <NetIcon id={t.network} size={28} color={netColor(t.network, app.networks)} />
                <div className="row-main"><b>{netLabel(t.network, app.networks)} · {t.account_name}</b><span className="row-meta">{(post.caption || '').slice(0, 90)}</span></div>
                <div className="row-date">{fmtDateTime(post.scheduled_at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
