import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon, Images, Clapperboard, CircleDot, Check, X, ChevronLeft, ChevronRight, Hash, Library,
  AlertTriangle, Hand, Send, CalendarClock, ListOrdered, Save, Info, TriangleAlert, Lightbulb,
} from 'lucide-react';
import { useApp } from '../lib/store.jsx';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { fromLocalInput, toLocalInput, fmtDateTime, ymd } from '../lib/format.js';
import { TYPES, TYPE_LABEL, FEED_MAX, STORY_MAX, EDITABLE_STATUS } from '../lib/constants.js';
import { Button, Modal, Badge, Field, useConfirm } from './ui.jsx';
import { NetIcon, netLabel, netColor } from './NetIcon.jsx';
import { Dropzone, MediaPicker, MediaThumb } from './Media.jsx';
import { Preview } from './Previews.jsx';
import { TikTokPanel, YouTubePanel, tiktokBlockers, tiktokModeOf } from './NetworkSettings.jsx';

const TYPE_ICONS = { Image: ImageIcon, Images, Clapperboard, CircleDot };
const TYPE_PLURAL = { post: 'posts', carousel: 'carruseles', reel: 'reels y vídeos', story: 'stories' };
const len = (s) => [...(s || '')].length;

function initState(app) {
  const c = app.composer || {};
  const p = c.post;
  const d = c.date ? new Date(c.date) : null;
  const overrides = {};
  const options = {};
  if (p) {
    (p.targets || []).forEach((t) => {
      if (t.caption_override != null) overrides[t.account_id] = t.caption_override;
      if (t.options && Object.keys(t.options).length) options[t.account_id] = t.options;
      // Publicaciones antiguas de TikTok sin modo guardado: se enviaban a la bandeja.
      if (t.network === 'tiktok' && !(t.options && t.options.tiktok_mode)) options[t.account_id] = { ...(options[t.account_id] || {}), tiktok_mode: 'inbox' };
    });
  }
  const connected = app.accounts.filter((a) => a.status !== 'expired');
  return {
    type: p ? p.type : c.type || 'post',
    accountIds: p ? (p.targets || []).map((t) => t.account_id) : connected.length === 1 ? [connected[0].id] : [],
    media: p ? p.media || [] : [],
    caption: p ? p.caption || '' : c.caption || '',
    overrides,
    options,
    mode: 'date',
    when: p ? toLocalInput(p.scheduled_at) : d ? toLocalInput(d.toISOString()) : '',
    campaignId: p && p.campaign ? String(p.campaign.id) : '',
    notes: p ? p.notes || '' : '',
  };
}


// Opciones de Google Business Profile. TikTok y YouTube tienen su propio panel (NetworkSettings.jsx).
function OptionsPanel({ account, label, value, onChange }) {
  const n = account.network;
  return (
    <details className="opts">
      <summary><NetIcon id={n} size={20} /> Opciones de {label}{account.name ? ` · ${account.name}` : ''}</summary>
      <div className="opts-body">
        {n === 'gbp' && (
          <>
            <Field label="Botón de la publicación">
              <select className="input" value={value.cta ? value.cta.actionType : ''} onChange={(e) => onChange({ cta: e.target.value ? { actionType: e.target.value, url: value.cta ? value.cta.url || '' : '' } : null })}>
                <option value="">Sin botón</option>
                <option value="LEARN_MORE">Más información</option>
                <option value="BOOK">Reservar</option>
                <option value="ORDER">Pedir online</option>
                <option value="SHOP">Comprar</option>
                <option value="SIGN_UP">Registrarse</option>
                <option value="CALL">Llamar ahora</option>
              </select>
            </Field>
            {value.cta && value.cta.actionType && value.cta.actionType !== 'CALL' && (
              <Field label="Enlace del botón"><input className="input" value={value.cta.url || ''} placeholder="https://…" onChange={(e) => onChange({ cta: { ...value.cta, url: e.target.value } })} /></Field>
            )}
          </>
        )}
      </div>
    </details>
  );
}

export default function Composer() {
  const app = useApp();
  if (!app.composer) return null;
  return <ComposerInner key={app.composer.post ? 'p' + app.composer.post.id : 'new-' + (app.composer.date || '') + (app.composer.type || '')} />;
}

function ComposerInner() {
  const app = useApp();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const editing = app.composer.post || null;
  const init = useMemo(() => initState(app), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [type, setType] = useState(init.type);
  const [accountIds, setAccountIds] = useState(init.accountIds);
  const [media, setMedia] = useState(init.media);
  const [caption, setCaption] = useState(init.caption);
  const [overrides, setOverrides] = useState(init.overrides);
  const [options, setOptions] = useState(init.options);
  const [mode, setMode] = useState(init.mode);
  const [when, setWhen] = useState(init.when);
  const [campaignId, setCampaignId] = useState(init.campaignId);
  const [notes, setNotes] = useState(init.notes);
  const [tab, setTab] = useState('base');
  const [previewId, setPreviewId] = useState(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({ general: '', lines: [], byAccount: {} });
  const [campaigns, setCampaigns] = useState([]);
  const [snippets, setSnippets] = useState([]);
  const [snipOpen, setSnipOpen] = useState(false);
  const [slotWarn, setSlotWarn] = useState([]);
  const [queueNext, setQueueNext] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  // Datos de cada cuenta de TikTok (creator_info): se piden de nuevo cada vez que se abre el compositor.
  const [creators, setCreators] = useState({});
  const taRef = useRef(null);
  const dirty = useRef(false);
  const submitting = useRef(false);
  // Foto del estado al abrir: así sabemos si hay cambios sin guardar de verdad.
  const snap = JSON.stringify([type, accountIds, media.map((m) => m.id), caption, overrides, options, mode, when, campaignId, notes]);
  const initSnap = useRef(null);
  if (initSnap.current === null) initSnap.current = snap;
  const changed = snap !== initSnap.current;
  // Si cambias algo, los avisos de error anteriores ya no valen.
  useEffect(() => { setErrors((e) => ((e.general || e.lines.length) ? { general: '', lines: [], byAccount: {} } : e)); }, [snap]);

  useEffect(() => {
    if (!changed) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  useEffect(() => {
    api.get('/api/campaigns').then(setCampaigns).catch(() => {});
    api.get('/api/snippets').then(setSnippets).catch(() => {});
  }, []);

  const accounts = app.accounts;
  const selected = accountIds.map((id) => accounts.find((a) => a.id === id)).filter(Boolean);
  const netOf = (a) => app.netById(a.network);

  // ----- Información de entrega (API o manual) por red -----
  const infoFor = (a) => {
    const n = netOf(a);
    const label = netLabel(a.network, app.networks);
    if (a.mode === 'manual') return { manual: true, reason: `${label} está en modo manual: a su hora te aviso y lo publicas tú en dos clics.` };
    if (n && n.supports && n.supports[type] === false) {
      return { manual: true, reason: `${label} no permite publicar ${TYPE_PLURAL[type]} automáticamente. Irá en modo manual: a su hora te aviso, copias el texto y lo subes tú.` };
    }
    return { manual: false };
  };
  const manualNotices = selected.map((a) => ({ a, ...infoFor(a) })).filter((x) => x.manual);
  const apiTikTok = selected.filter((a) => a.network === 'tiktok' && !infoFor(a).manual);
  const apiYouTube = selected.filter((a) => a.network === 'youtube' && !infoFor(a).manual);

  const loadCreator = (id) => {
    setCreators((c) => ({ ...c, [id]: { loading: true, data: c[id] && c[id].data, error: '' } }));
    api.get(`/api/accounts/${id}/tiktok/creator-info`)
      .then((data) => setCreators((c) => ({ ...c, [id]: { loading: false, data, error: '' } })))
      .catch((e) => setCreators((c) => ({ ...c, [id]: { loading: false, data: null, error: e.message } })));
  };
  const tiktokIds = apiTikTok.map((a) => a.id).join(',');
  useEffect(() => {
    apiTikTok.forEach((a) => { if (!creators[a.id]) loadCreator(a.id); });
  }, [tiktokIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que impide programar/publicar en TikTok (las reglas de TikTok piden desactivar el botón).
  const blockAll = [];
  const blockNow = [];
  apiTikTok.forEach((a) => {
    const b = tiktokBlockers({ value: options[a.id] || {}, creator: creators[a.id], type, media });
    blockAll.push(...b.all);
    blockNow.push(...b.now);
  });
  const blockAllMsg = blockAll[0] || '';
  const blockNowMsg = blockAll[0] || blockNow[0] || '';
  const approvalNotices = selected.filter((a) => { const n = netOf(a); return n && n.needsApproval && a.mode !== 'manual'; });

  // ----- Textos -----
  const effective = (a) => (overrides[a.id] != null ? overrides[a.id] : caption);
  const tabs = [{ id: 'base', label: 'Texto base' }, ...selected.map((a) => {
    const same = selected.filter((x) => x.network === a.network).length > 1;
    return { id: String(a.id), acc: a, label: netLabel(a.network, app.networks) + (same ? ` · ${a.name}` : '') };
  })];
  const activeTab = tabs.find((t) => t.id === tab) ? tab : 'base';
  const activeAcc = activeTab === 'base' ? null : selected.find((a) => String(a.id) === activeTab);
  const text = activeAcc ? effective(activeAcc) : caption;
  const setText = (v) => {
    dirty.current = true;
    if (activeAcc) setOverrides((o) => ({ ...o, [activeAcc.id]: v }));
    else setCaption(v);
  };
  const limitOf = (a) => { const n = netOf(a); return n && n.limits ? n.limits.captionMax : null; };
  const activeLimit = activeAcc ? limitOf(activeAcc) : (selected.length ? Math.min(...selected.map((a) => limitOf(a) || Infinity)) : null);
  const overLimits = selected.filter((a) => { const l = limitOf(a); return l && len(effective(a)) > l; });

  const insertSnippet = (s) => {
    const el = taRef.current;
    const t = s.text || '';
    if (el && typeof el.selectionStart === 'number') {
      const a = el.selectionStart; const b = el.selectionEnd;
      const sep = a > 0 && !/\s$/.test(text.slice(0, a)) ? '\n\n' : '';
      const next = text.slice(0, a) + sep + t + text.slice(b);
      setText(next);
      setTimeout(() => { el.focus(); const pos = a + sep.length + t.length; el.setSelectionRange(pos, pos); }, 0);
    } else setText(text + (text ? '\n\n' : '') + t);
    setSnipOpen(false);
  };

  // ----- Medios -----
  // El máximo sale de las capacidades que manda el servidor para cada red (sin tope fijo en la interfaz).
  const anyCarouselMax = Math.max(10, ...app.networks.map((n) => (n.limits && n.limits.carouselMax) || 0));
  const carouselMax = selected.length ? Math.min(...selected.map((a) => (netOf(a)?.limits?.carouselMax) || 10)) : anyCarouselMax;
  const maxMedia = type === 'carousel' ? carouselMax : 1;
  const addMedia = (list) => setMedia((m) => {
    const ids = new Set(m.map((x) => x.id));
    const add = list.filter((x) => !ids.has(x.id));
    if (type !== 'carousel') return add.length ? [add[0]] : m;
    return [...m, ...add].slice(0, carouselMax);
  });
  const onUploaded = (list) => {
    if (type !== 'carousel' && list.length > 1) toast.info('En este formato solo cabe 1 archivo: he puesto el primero. Si quieres varias imágenes, elige “Carrusel”.', 8000);
    else if (type === 'carousel' && media.length + list.length > carouselMax) toast.info(`Un carrusel admite hasta ${carouselMax} imágenes: he añadido las que caben.`, 8000);
    addMedia(list);
    dirty.current = true;
  };
  const move = (i, to) => setMedia((m) => {
    if (to < 0 || to >= m.length) return m;
    const c = [...m]; const [it] = c.splice(i, 1); c.splice(to, 0, it); return c;
  });
  const hasVideo = media.some((m) => m.kind === 'video');
  const mediaHints = [];
  if (type === 'carousel' && media.length < 2) mediaHints.push('Un carrusel necesita al menos 2 imágenes.');
  if (type === 'carousel' && media.length > carouselMax) mediaHints.push(`Una de las redes elegidas admite como máximo ${carouselMax} imágenes por carrusel.`);
  if (type !== 'carousel' && media.length > 1) mediaHints.push('En este formato solo se publica el primer archivo. Cambia a Carrusel si quieres varios.');
  if ((type === 'reel') && media.length && !hasVideo) mediaHints.push('Un reel necesita un vídeo.');
  if (type === 'story' && !media.length) mediaHints.push('Una story necesita una imagen o un vídeo.');
  const needsMediaNets = selected.filter((a) => { const n = netOf(a); return n && n.supports && n.supports.textOnly === false && !media.length && type !== 'story'; });

  // ----- Programación -----
  const whenIso = fromLocalInput(when);
  const feedType = type !== 'story';
  useEffect(() => {
    if (mode !== 'date' || !whenIso || !selected.length) { setSlotWarn([]); return undefined; }
    const d0 = new Date(whenIso);
    const day = ymd(d0);
    const from = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).toISOString();
    const to = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1).toISOString();
    let live = true;
    api.get('/api/slots' + qs({ from, to })).then((rows) => {
      if (!live) return;
      const warns = [];
      selected.forEach((a) => {
        const r = (rows || []).find((x) => x.account_id === a.id && x.date === day);
        if (!r) return;
        const cur = feedType ? r.feed : r.story;
        const max = feedType ? (r.feedMax || FEED_MAX) : (r.storyMax || STORY_MAX);
        if (cur >= max && !(editing && editing.targets.some((t) => t.account_id === a.id) && editing.scheduled_at && ymd(new Date(editing.scheduled_at)) === day)) {
          warns.push(`${netLabel(a.network, app.networks)} (${a.name}) ya tiene ${cur}/${max} ${feedType ? 'publicaciones' : 'stories'} ese día. Elige otro día.`);
        }
      });
      setSlotWarn(warns);
    }).catch(() => {});
    return () => { live = false; };
  }, [mode, whenIso, accountIds.join(','), feedType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'queue' || !accountIds.length) { setQueueNext(null); return undefined; }
    let live = true;
    api.get('/api/queue/next' + qs({ account_ids: accountIds.join(','), type })).then((r) => { if (live) setQueueNext(r && r.scheduled_at); }).catch(() => { if (live) setQueueNext(null); });
    return () => { live = false; };
  }, [mode, accountIds.join(','), type]); // eslint-disable-line react-hooks/exhaustive-deps

  const quickDates = useMemo(() => {
    const out = [];
    const now = new Date();
    const times = app.queueTimes.slice(0, 3);
    for (let dayOff = 0; dayOff < 2 && out.length < 4; dayOff++) {
      for (const t of times) {
        const [h, m] = t.split(':').map(Number);
        const d = new Date(now); d.setDate(d.getDate() + dayOff); d.setHours(h, m, 0, 0);
        if (d > now && out.length < 4) out.push({ d, label: `${dayOff === 0 ? 'Hoy' : 'Mañana'} ${t}` });
      }
    }
    return out;
  }, [app.queueTimes]);

  // ----- Enviar -----
  const buildBody = (action) => {
    const body = {
      type,
      caption,
      media_ids: media.map((m) => m.id),
      targets: selected.map((a) => ({
        account_id: a.id,
        caption: overrides[a.id] != null && overrides[a.id] !== caption ? overrides[a.id] : null,
        options: a.network === 'tiktok' ? { ...(options[a.id] || {}), tiktok_mode: tiktokModeOf(options[a.id]) } : (options[a.id] || {}),
      })),
      scheduled_at: action === 'queue' || action === 'publish_now' ? null : whenIso,
      action,
      campaign_id: campaignId ? Number(campaignId) : null,
      notes,
    };
    if (!editing) body.created_by = 'user';
    return body;
  };

  const scrollToErrors = () => setTimeout(() => {
    const box = document.querySelector('.cmp-errors');
    if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 50);

  const submit = async (action) => {
    setErrors({ general: '', lines: [], byAccount: {} });
    if (action !== 'draft' && !selected.length) { setErrors({ general: 'Elige al menos una red para publicar.', lines: [], byAccount: {} }); return; }
    if (action === 'schedule' && !whenIso) { setErrors({ general: 'Elige el día y la hora, o usa "Añadir a la cola".', lines: [], byAccount: {} }); return; }
    if (action === 'schedule' && new Date(whenIso) < new Date()) { setErrors({ general: 'Esa fecha ya ha pasado. Elige una futura o usa "Publicar ahora".', lines: [], byAccount: {} }); return; }
    if (action !== 'draft') {
      const problem = (type === 'carousel' && media.length < 2) ? 'Un carrusel necesita al menos 2 imágenes.'
        : (type === 'reel' && !hasVideo) ? 'Un reel necesita un vídeo. Súbelo en el paso 3.'
          : (type === 'story' && !media.length) ? 'Una story necesita una imagen o un vídeo. Añádelo en el paso 3.'
            : needsMediaNets.length ? `${needsMediaNets.map((a) => netLabel(a.network, app.networks)).join(' y ')} no permite publicar solo texto: añade una imagen o un vídeo en el paso 3.` : '';
      if (problem) { setErrors({ general: problem, lines: [], byAccount: {} }); scrollToErrors(); return; }
    }
    if (submitting.current) return;
    if (action === 'publish_now') {
      const ok = await confirm({
        title: '¿Publicar ahora?',
        text: `Se publicará ya en ${selected.map((a) => netLabel(a.network, app.networks)).join(', ')}.${manualNotices.length ? ' Las redes en modo manual te aparecerán en "Para publicar a mano".' : ''}`,
        ok: 'Sí, publicar ahora',
      });
      if (!ok) return;
    }
    submitting.current = true;
    setBusy(action);
    try {
      const res = editing
        ? await api.put(`/api/posts/${editing.id}`, buildBody(action))
        : await api.post('/api/posts', buildBody(action));
      const msg = {
        draft: 'Borrador guardado.',
        schedule: 'Publicación programada.',
        queue: res && res.scheduled_at ? `Añadida a la cola para el ${fmtDateTime(res.scheduled_at)}.` : 'Añadida a la cola.',
        publish_now: 'Publicando ahora. Te aviso cuando termine.',
      }[action];
      const ttNote = action !== 'draft' && apiTikTok.length > 0;
      toast.success(ttNote ? `${msg} TikTok puede tardar unos minutos en mostrarlo en tu perfil.` : msg, ttNote ? 8000 : undefined);
      app.bump();
      app.closeComposer();
    } catch (e) {
      const byAccount = {};
      const lines = [];
      (e.details || []).forEach((d) => {
        if (typeof d === 'string') { lines.push(d); return; }
        if (!d.message) return;
        const line = d.network ? `${netLabel(d.network, app.networks)}: ${d.message}` : d.message;
        lines.push(line);
        if (d.account_id) (byAccount[d.account_id] = byAccount[d.account_id] || []).push(d.message);
      });
      const uniq = [...new Set(lines)];
      setErrors({ general: uniq.includes(e.message) ? '' : e.message, lines: uniq, byAccount });
      scrollToErrors();
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  };

  const requestClose = async () => {
    if (busy) return;
    if (changed) {
      const ok = await confirm({
        title: '¿Salir sin guardar?',
        text: editing ? 'Si cierras ahora se perderán los cambios que has hecho.' : 'Si cierras ahora perderás lo que has escrito. Antes puedes guardarlo con “Guardar borrador”.',
        ok: 'Salir sin guardar', cancel: 'Seguir editando', danger: true,
      });
      if (!ok) return;
    }
    app.closeComposer();
  };

  // ----- Vista previa -----
  const prevAcc = selected.find((a) => a.id === previewId) || activeAcc || selected[0] || null;
  const toggleAccount = (a) => {
    dirty.current = true;
    setAccountIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]));
  };
  const connectedAccounts = accounts;

  const publishedLocked = editing && !EDITABLE_STATUS.includes(editing.status);

  return (
    <Modal xl onClose={requestClose} title={editing ? (editing.status === 'draft' ? 'Editar borrador' : 'Editar publicación') : 'Crear publicación'}
      subtitle={editing && editing.created_by === 'claude' ? 'Propuesta por Claude: revísala y apruébala cuando te guste.' : 'Escribe una vez y adapta el texto a cada red.'}
      footer={(
        <>
          <div className="cmp-foot-left">
            {mode === 'date' && whenIso ? <span className="foot-when"><CalendarClock size={16} /> {fmtDateTime(whenIso)}</span> : null}
            {mode === 'queue' ? <span className="foot-when"><ListOrdered size={16} /> {queueNext ? fmtDateTime(queueNext) : 'Siguiente hueco libre'}</span> : null}
          </div>
          <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
          <Button variant="secondary" icon={Save} loading={busy === 'draft'} disabled={!!busy} onClick={() => submit('draft')}>Guardar borrador</Button>
          {/* Un botón desactivado no muestra su "title": lo lleva el contenedor (reglas de TikTok). */}
          <span className="btn-wrap" title={blockNowMsg || undefined}>
            <Button variant="secondary" icon={Send} loading={busy === 'publish_now'} disabled={!!busy || publishedLocked || !!blockNowMsg} onClick={() => submit('publish_now')}>Publicar ahora</Button>
          </span>
          <span className="btn-wrap" title={blockAllMsg || undefined}>
            {mode === 'queue'
              ? <Button icon={ListOrdered} loading={busy === 'queue'} disabled={!!busy || !!blockAllMsg} onClick={() => submit('queue')}>Añadir a la cola</Button>
              : <Button icon={CalendarClock} loading={busy === 'schedule'} disabled={!!busy || !!blockAllMsg} onClick={() => submit('schedule')}>Programar</Button>}
          </span>
        </>
      )}>
      {confirmEl}
      <div className="composer">
        <div className="cmp-main">
          {/* 1 · Tipo */}
          <section className="cmp-sec">
            <h3><i>1</i> ¿Qué vas a publicar?</h3>
            <div className="type-grid">
              {TYPES.map((t) => {
                const Ico = TYPE_ICONS[t.icon];
                return (
                  <button key={t.id} type="button" className={`type-btn ${type === t.id ? 'on' : ''}`} onClick={() => { setType(t.id); dirty.current = true; }}>
                    <Ico size={22} />
                    <b>{t.label}</b>
                    <small>{t.hint}</small>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2 · Redes */}
          <section className="cmp-sec">
            <h3><i>2</i> ¿Dónde?</h3>
            {connectedAccounts.length > 0 ? <p className="sec-hint">Toca cada red para marcarla o desmarcarla. Solo se publicará en las que tengan el check.</p> : null}
            {connectedAccounts.length === 0 ? (
              <div className="notice info"><Info size={18} /><div><b>Aún no tienes ninguna red.</b> Puedes guardar un borrador, pero para programar conecta una red (o añádela en modo manual) en <a href="#/redes" onClick={() => app.closeComposer()}>Redes</a>.</div></div>
            ) : (
              <div className="acc-grid">
                {connectedAccounts.map((a) => {
                  const on = accountIds.includes(a.id);
                  const blocked = a.status === 'expired';
                  return (
                    <button key={a.id} type="button" disabled={blocked} className={`acc-btn ${on ? 'on' : ''}`} onClick={() => toggleAccount(a)}
                      title={blocked ? 'Esta conexión ha caducado. Reconéctala en Redes.' : a.name}>
                      <span className="acc-av">
                        {a.avatar_url ? <img src={a.avatar_url} alt="" /> : <NetIcon id={a.network} size={40} color={netColor(a.network, app.networks)} />}
                        <i><NetIcon id={a.network} size={18} color={netColor(a.network, app.networks)} /></i>
                        {on ? <em><Check size={12} strokeWidth={3} /></em> : null}
                      </span>
                      <b>{a.name}</b>
                      <small>{blocked ? 'Caducada' : a.mode === 'manual' ? `${netLabel(a.network, app.networks)} · manual` : netLabel(a.network, app.networks)}</small>
                    </button>
                  );
                })}
              </div>
            )}
            {manualNotices.map((x) => (
              <div className="notice warn" key={x.a.id}><Hand size={18} /><div><b>{x.a.name}: modo manual.</b> {x.reason}</div></div>
            ))}
            {approvalNotices.map((a) => (
              <div className="notice info" key={'ap' + a.id}><Info size={18} /><div><b>{netLabel(a.network, app.networks)}:</b> {netOf(a).needsApproval}</div></div>
            ))}
          </section>

          {/* 3 · Medios */}
          <section className="cmp-sec">
            <h3><i>3</i> Imágenes o vídeo <small>{type === 'carousel' ? `hasta ${carouselMax}` : 'solo 1 archivo'}</small></h3>
            {media.length > 0 && (
              <div className="media-list">
                {media.map((m, i) => (
                  <div key={m.id} className={`media-item ${dragIdx === i ? 'drag' : ''}`} draggable
                    onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                    onDragOver={(e) => { if (dragIdx !== null) e.preventDefault(); }}
                    onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) move(dragIdx, i); setDragIdx(null); }}
                    onDragEnd={() => setDragIdx(null)}>
                    <MediaThumb m={m} />
                    <span className="media-num">{i + 1}</span>
                    <button type="button" className="media-x" aria-label="Quitar" onClick={() => { setMedia((l) => l.filter((x) => x.id !== m.id)); dirty.current = true; }}><X size={14} /></button>
                    {media.length > 1 && (
                      <span className="media-move">
                        <button type="button" aria-label="Mover antes" disabled={i === 0} onClick={() => move(i, i - 1)}><ChevronLeft size={14} /></button>
                        <button type="button" aria-label="Mover después" disabled={i === media.length - 1} onClick={() => move(i, i + 1)}><ChevronRight size={14} /></button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="media-add">
              <Dropzone compact onUploaded={onUploaded} />
              <Button variant="secondary" icon={Library} onClick={() => setPicker(true)}>Elegir de la biblioteca</Button>
            </div>
            {mediaHints.map((h) => <div className="notice warn" key={h}><TriangleAlert size={18} /><div>{h}</div></div>)}
            {needsMediaNets.length > 0 && (
              <div className="notice warn"><TriangleAlert size={18} /><div>{needsMediaNets.map((a) => netLabel(a.network, app.networks)).join(' y ')} no permite publicar solo texto: añade una imagen o vídeo.</div></div>
            )}
          </section>

          {/* 4 · Texto */}
          <section className="cmp-sec">
            <h3><i>4</i> Texto</h3>
            <div className="tabs scroll" role="tablist">
              {tabs.map((t) => {
                const over = t.acc && limitOf(t.acc) && len(effective(t.acc)) > limitOf(t.acc);
                return (
                  <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={`tab ${activeTab === t.id ? 'on' : ''}`}
                    onClick={() => { setTab(t.id); if (t.acc) setPreviewId(t.acc.id); }}>
                    {t.acc ? <NetIcon id={t.acc.network} size={18} color={netColor(t.acc.network, app.networks)} /> : null}
                    {t.label}
                    {t.acc && overrides[t.acc.id] != null && overrides[t.acc.id] !== caption ? <span className="tab-dot" title="Texto personalizado" /> : null}
                    {over ? <TriangleAlert size={13} className="tab-warn" /> : null}
                  </button>
                );
              })}
            </div>
            {activeAcc && (
              <div className="tab-hint">
                {overrides[activeAcc.id] != null && overrides[activeAcc.id] !== caption
                  ? <>Este texto es solo para {netLabel(activeAcc.network, app.networks)}. <button type="button" className="link" onClick={() => setOverrides((o) => { const c = { ...o }; delete c[activeAcc.id]; return c; })}>Volver al texto base</button></>
                  : <>Ahora mismo usa el texto base. Si lo cambias aquí, solo cambiará en {netLabel(activeAcc.network, app.networks)}.</>}
              </div>
            )}
            <textarea ref={taRef} className="textarea cmp-text" rows={7} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={activeAcc ? `Texto para ${netLabel(activeAcc.network, app.networks)}…` : 'Escribe aquí el texto de tu publicación. Luego podrás adaptarlo a cada red…'} />
            <div className="text-tools">
              <div className="snip-wrap">
                <Button variant="secondary" size="sm" icon={Hash} onClick={() => setSnipOpen((v) => !v)}>Textos guardados</Button>
                {snipOpen && (
                  <div className="snip-pop">
                    {snippets.length === 0 ? (
                      <p>Aún no tienes textos guardados. Crea grupos de hashtags en <a href="#/ajustes" onClick={() => app.closeComposer()}>Ajustes</a>.</p>
                    ) : snippets.map((s) => (
                      <button key={s.id} type="button" onClick={() => insertSnippet(s)}><b>{s.name}</b><span>{s.text}</span></button>
                    ))}
                  </div>
                )}
              </div>
              <span className={`counter ${activeLimit && len(text) > activeLimit ? 'over' : activeLimit && len(text) > activeLimit * 0.9 ? 'near' : ''}`}>
                {len(text)}{activeLimit && activeLimit !== Infinity ? ` / ${activeLimit}` : ''} caracteres
              </span>
            </div>
            {overLimits.length > 0 && (
              <div className="notice warn"><TriangleAlert size={18} /><div>El texto es demasiado largo para {overLimits.map((a) => `${netLabel(a.network, app.networks)} (máx. ${limitOf(a)})`).join(', ')}. Acórtalo en su pestaña.</div></div>
            )}
            {activeAcc && errors.byAccount[activeAcc.id] && errors.byAccount[activeAcc.id].map((m) => <div className="field-error" key={m}>{m}</div>)}
            {apiTikTok.map((a) => (
              <TikTokPanel key={a.id} account={a} value={options[a.id] || {}} creator={creators[a.id]} onRetry={() => loadCreator(a.id)}
                type={type} media={media} onChange={(patch) => setOptions((o) => ({ ...o, [a.id]: { ...(o[a.id] || {}), ...patch } }))} />
            ))}
            {apiYouTube.map((a) => (
              <YouTubePanel key={a.id} account={a} value={options[a.id] || {}} caption={effective(a)}
                onChange={(patch) => setOptions((o) => ({ ...o, [a.id]: { ...(o[a.id] || {}), ...patch } }))} />
            ))}
            {selected.filter((a) => a.network === 'gbp').map((a) => (
              <OptionsPanel key={a.id} account={a} label={netLabel(a.network, app.networks)} value={options[a.id] || {}}
                onChange={(patch) => setOptions((o) => ({ ...o, [a.id]: { ...(o[a.id] || {}), ...patch } }))} />
            ))}
          </section>

          {/* 5 · Cuándo */}
          <section className="cmp-sec">
            <h3><i>5</i> ¿Cuándo?</h3>
            <div className="when-grid">
              <button type="button" className={`when-card ${mode === 'date' ? 'on' : ''}`} onClick={() => setMode('date')}>
                <CalendarClock size={20} /><b>Elegir día y hora</b><small>Tú decides el momento exacto</small>
              </button>
              <button type="button" className={`when-card ${mode === 'queue' ? 'on' : ''}`} onClick={() => setMode('queue')}>
                <ListOrdered size={20} /><b>Añadir a la cola</b><small>Al siguiente hueco libre ({app.queueTimes.join(', ')})</small>
              </button>
            </div>
            {mode === 'date' ? (
              <div className="when-pick">
                <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Fecha y hora" />
                <div className="chips">
                  {quickDates.map((q) => <button key={q.label} type="button" className="chip" onClick={() => setWhen(toLocalInput(q.d.toISOString()))}>{q.label}</button>)}
                </div>
              </div>
            ) : (
              <div className="notice info"><Lightbulb size={18} /><div>{accountIds.length ? (queueNext ? <>Saldrá el <b>{fmtDateTime(queueNext)}</b>, respetando el límite diario de cada red.</> : 'Buscando el siguiente hueco libre…') : 'Elige una red para ver cuándo saldría.'}</div></div>
            )}
            {slotWarn.map((w) => <div className="notice warn" key={w}><AlertTriangle size={18} /><div>{w}</div></div>)}
            <div className="row-2 mt">
              <Field label="Campaña (opcional)">
                <select className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">Sin campaña</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Notas para ti (no se publican)">
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: pedir foto al cliente" />
              </Field>
            </div>
          </section>

          {(errors.general || errors.lines.length > 0) && (
            <div className="cmp-errors notice error" role="alert">
              <AlertTriangle size={18} />
              <div>
                <b>{errors.general || (errors.lines.length === 1 ? 'Revisa este punto' : 'Revisa estos puntos')}</b>
                {errors.lines.length > 0 && <ul>{errors.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
              </div>
            </div>
          )}
        </div>

        {/* Vista previa */}
        <aside className="cmp-preview">
          <div className="pv-title">Vista previa</div>
          {selected.length > 1 && (
            <div className="pv-nets">
              {selected.map((a) => (
                <button key={a.id} type="button" className={prevAcc && prevAcc.id === a.id ? 'on' : ''} onClick={() => setPreviewId(a.id)} title={a.name}>
                  <NetIcon id={a.network} size={26} color={netColor(a.network, app.networks)} />
                </button>
              ))}
            </div>
          )}
          <div className="pv-stage">
            <Preview
              net={prevAcc ? prevAcc.network : 'instagram'}
              type={type}
              caption={prevAcc ? effective(prevAcc) : caption}
              media={media}
              name={prevAcc ? prevAcc.name : 'Tu cuenta'}
              username={prevAcc ? prevAcc.username : ''}
              avatar={prevAcc ? prevAcc.avatar_url : ''}
            />
          </div>
          {prevAcc && infoFor(prevAcc).manual ? (
            <Badge tone="amber" icon={Hand}>Se publicará a mano</Badge>
          ) : prevAcc ? <Badge tone="green" icon={Check}>Se publicará solo</Badge> : null}
          <p className="pv-note">Así se verá de forma aproximada. Cada red puede variar un poco el diseño.</p>
        </aside>
      </div>
      {picker && (
        <MediaPicker onClose={() => setPicker(false)} selectedIds={media.map((m) => m.id)} max={type === 'carousel' ? carouselMax : 1}
          onPick={(list) => { addMedia(list); dirty.current = true; setPicker(false); }} />
      )}
    </Modal>
  );
}
