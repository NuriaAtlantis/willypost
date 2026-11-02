// Ajustes obligatorios de TikTok y YouTube en el compositor.
//  - TikTok: https://developers.tiktok.com/doc/content-sharing-guidelines
//  - YouTube: https://developers.google.com/youtube/terms/required-minimum-functionality
import { AlertTriangle, Info, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Field } from './ui.jsx';
import { NetIcon } from './NetIcon.jsx';

export const PRIVACY_LABEL = {
  PUBLIC_TO_EVERYONE: 'Todo el mundo',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (seguidores a los que tú también sigues)',
  FOLLOWER_OF_CREATOR: 'Tus seguidores',
  SELF_ONLY: 'Solo yo',
};

const MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
const BRAND_POLICY_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';
export const COMMERCIAL_HINT = 'Tienes que indicar si tu contenido te promociona a ti, a un tercero o a ambos.';
const BRANDED_PRIVATE_HINT = 'La visibilidad del contenido de marca no puede ser privada.';

export const isPhotoType = (type) => type === 'post' || type === 'carousel';
export const tiktokModeOf = (value) => (value && value.tiktok_mode) || 'direct';

/** Lo que impide publicar en TikTok ahora mismo (para desactivar botones). */
export function tiktokBlockers({ value = {}, creator, type, media = [] }) {
  const out = { all: [], now: [] };
  if (tiktokModeOf(value) !== 'direct') return out;
  if (value.commercial && !value.brand_organic && !value.brand_content) out.all.push(COMMERCIAL_HINT);
  const c = creator && creator.data;
  if (c && c.can_post === false) out.now.push(`TikTok no deja publicar ahora en esta cuenta: ${c.reason || 'inténtalo más tarde.'}`);
  const dur = media[0] && Number(media[0].duration);
  if (c && type === 'reel' && c.max_video_post_duration_sec && dur > c.max_video_post_duration_sec) {
    out.all.push(`El vídeo dura ${Math.round(dur)} s y tu cuenta de TikTok solo permite hasta ${c.max_video_post_duration_sec} s.`);
  }
  return out;
}

function Toggle({ checked, onChange, disabled, children, note }) {
  return (
    <label className={`check-row tight ${disabled ? 'is-disabled' : ''}`} title={disabled && note ? note : undefined}>
      <input type="checkbox" checked={!!checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}{disabled && note ? <small className="opt-note"> · {note}</small> : null}</span>
    </label>
  );
}

/** Panel de TikTok: cuenta, privacidad sin valor por defecto, interacciones, contenido comercial y consentimiento. */
export function TikTokPanel({ account, value, onChange, creator, onRetry, type, media = [] }) {
  const mode = tiktokModeOf(value);
  const photo = isPhotoType(type);
  const c = creator && creator.data;
  const loading = !creator || creator.loading;
  const privacyOptions = c ? c.privacy_level_options || [] : [];
  const branded = !!(value.commercial && value.brand_content);
  const organic = !!(value.commercial && value.brand_organic);
  const what = photo ? 'Tu foto' : 'Tu vídeo';
  const dur = media[0] && Number(media[0].duration);
  const tooLong = c && !photo && c.max_video_post_duration_sec && dur > c.max_video_post_duration_sec;

  const setPrivacy = (v) => onChange({ tiktok_privacy: v || undefined });

  return (
    <div className="opts opts-open net-settings">
      <div className="opts-head"><NetIcon id="tiktok" size={20} /> Ajustes de TikTok</div>
      <div className="opts-body">
        {/* Cuenta donde se publicará (creator_info) */}
        <div className="creator-row">
          {c && c.avatar_url ? <img src={c.avatar_url} alt="" className="creator-av" /> : <span className="creator-av ph"><NetIcon id="tiktok" size={22} /></span>}
          <div>
            <div className="creator-lbl">Se publicará en tu cuenta de TikTok</div>
            <b>{(c && c.nickname) || account.name}</b>{(c && c.username) || account.username ? <span className="creator-user"> @{String((c && c.username) || account.username).replace(/^@/, '')}</span> : null}
          </div>
          {loading ? <Loader2 size={18} className="spin creator-spin" /> : null}
        </div>
        {creator && creator.error ? (
          <div className="notice error small"><AlertTriangle size={16} /><div>{creator.error} <button type="button" className="link" onClick={onRetry}><RefreshCw size={13} /> Volver a intentarlo</button></div></div>
        ) : null}
        {c && c.can_post === false ? (
          <div className="notice warn small"><Clock size={16} /><div><b>Ahora mismo TikTok no deja publicar en esta cuenta.</b> {c.reason} Puedes programarla para otro momento o intentarlo más tarde.</div></div>
        ) : null}

        <Field label="¿Cómo quieres enviarlo?">
          <select className="input" value={mode} onChange={(e) => onChange({ tiktok_mode: e.target.value })}>
            <option value="direct">Publicarlo directamente en TikTok</option>
            <option value="inbox">Dejarlo en mi bandeja de TikTok y terminarlo yo en la app</option>
          </select>
        </Field>

        {mode === 'inbox' ? (
          <div className="notice info small"><Info size={16} /><div>Te llegará una notificación en la app de TikTok. Allí eliges quién puede verlo y lo publicas tú.</div></div>
        ) : (
          <>
            <Field label="¿Quién puede verlo?" hint={!value.tiktok_privacy ? 'Elige una opción: TikTok pide que la marques tú.' : null}>
              <select className="input" value={value.tiktok_privacy || ''} disabled={!c} onChange={(e) => setPrivacy(e.target.value)}
                aria-invalid={!value.tiktok_privacy}>
                <option value="" disabled>{loading ? 'Cargando opciones de tu cuenta…' : 'Elige quién puede verlo…'}</option>
                {privacyOptions.map((p) => (
                  <option key={p} value={p} disabled={p === 'SELF_ONLY' && branded} title={p === 'SELF_ONLY' && branded ? BRANDED_PRIVATE_HINT : undefined}>
                    {PRIVACY_LABEL[p] || p}{p === 'SELF_ONLY' && branded ? ' (no disponible con contenido de marca)' : ''}
                  </option>
                ))}
                {value.tiktok_privacy && c && !privacyOptions.includes(value.tiktok_privacy) ? (
                  <option value={value.tiktok_privacy} disabled>{PRIVACY_LABEL[value.tiktok_privacy] || value.tiktok_privacy} (ya no disponible)</option>
                ) : null}
              </select>
            </Field>
            {value.tiktok_privacy && c && !privacyOptions.includes(value.tiktok_privacy) ? (
              <div className="field-error">Tu cuenta ya no permite «{PRIVACY_LABEL[value.tiktok_privacy] || value.tiktok_privacy}». Elige otra opción.</div>
            ) : null}

            <div className="opt-group">
              <div className="field-label">Qué pueden hacer los demás</div>
              <Toggle checked={value.allow_comment} disabled={!!(c && c.comment_disabled)} note="desactivado en tu app de TikTok"
                onChange={(v) => onChange({ allow_comment: v })}>Permitir comentarios</Toggle>
              {!photo && (
                <>
                  <Toggle checked={value.allow_duet} disabled={!!(c && c.duet_disabled)} note="desactivado en tu app de TikTok"
                    onChange={(v) => onChange({ allow_duet: v })}>Permitir dúos</Toggle>
                  <Toggle checked={value.allow_stitch} disabled={!!(c && c.stitch_disabled)} note="desactivado en tu app de TikTok"
                    onChange={(v) => onChange({ allow_stitch: v })}>Permitir stitch</Toggle>
                </>
              )}
            </div>

            {tooLong ? (
              <div className="notice error small"><AlertTriangle size={16} /><div>El vídeo dura {Math.round(dur)} s y tu cuenta de TikTok solo permite vídeos de hasta {c.max_video_post_duration_sec} s. Recórtalo o elige otro.</div></div>
            ) : null}

            <div className="opt-group">
              <label className="check-row tight switch-row">
                <input type="checkbox" checked={!!value.commercial}
                  onChange={(e) => onChange(e.target.checked ? { commercial: true } : { commercial: false, brand_organic: false, brand_content: false })} />
                <span><b>Divulgar contenido comercial</b><small className="opt-help">Actívalo si esta publicación promociona tu marca, un producto o un servicio (tuyo o de otra persona).</small></span>
              </label>
              {value.commercial ? (
                <div className="opt-sub">
                  <Toggle checked={value.brand_organic} onChange={(v) => onChange({ brand_organic: v })}>
                    Tu marca <small className="opt-help">Te promocionas a ti o a tu propio negocio.</small>
                  </Toggle>
                  <Toggle checked={value.brand_content} disabled={value.tiktok_privacy === 'SELF_ONLY'} note={BRANDED_PRIVATE_HINT}
                    onChange={(v) => onChange({ brand_content: v })}>
                    Contenido de marca <small className="opt-help">Colaboras con otra marca o te pagan por ello.</small>
                  </Toggle>
                  {branded ? (
                    <div className="notice info small"><Info size={16} /><div>{what} se etiquetará como «Colaboración pagada».</div></div>
                  ) : organic ? (
                    <div className="notice info small"><Info size={16} /><div>{what} se etiquetará como «Contenido promocional».</div></div>
                  ) : (
                    <div className="notice warn small"><AlertTriangle size={16} /><div>{COMMERCIAL_HINT}</div></div>
                  )}
                </div>
              ) : null}
            </div>

            <Toggle checked={value.is_aigc} onChange={(v) => onChange({ is_aigc: v })}>Contenido generado con IA</Toggle>

            <p className="opt-help">El texto que verá la gente es el de la pestaña <b>TikTok</b> del paso 4: puedes cambiarlo, con sus hashtags, antes de publicar.</p>

            <p className="consent-line">
              {branded ? (
                <>Al publicar, aceptas la <a href={BRAND_POLICY_URL} target="_blank" rel="noreferrer">Política de contenido de marca</a> y la <a href={MUSIC_URL} target="_blank" rel="noreferrer">Declaración de confirmación de uso de música</a> de TikTok.</>
              ) : (
                <>Al publicar, aceptas la <a href={MUSIC_URL} target="_blank" rel="noreferrer">Declaración de confirmación de uso de música</a> de TikTok.</>
              )}
            </p>
            <p className="opt-help"><Clock size={13} /> Cuando se publique, TikTok puede tardar unos minutos en procesarlo y mostrarlo en tu perfil.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Panel de YouTube: título, visibilidad (los elige la persona) y recordatorio de la descripción. */
export function YouTubePanel({ account, value, onChange, caption }) {
  const firstLine = String(caption || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  const title = value.title || '';
  return (
    <div className="opts opts-open net-settings">
      <div className="opts-head"><NetIcon id="youtube" size={20} /> Ajustes de YouTube{account.name ? ` · ${account.name}` : ''}</div>
      <div className="opts-body">
        <Field label="Título del vídeo" hint={`${[...title].length}/100${!title.trim() ? ' · Obligatorio: YouTube lo pide.' : ''}`}>
          <input className="input" maxLength={100} value={title} placeholder="Un título claro, con la palabra clave al principio" onChange={(e) => onChange({ title: e.target.value })} />
        </Field>
        {!title.trim() && firstLine ? (
          <button type="button" className="link" onClick={() => onChange({ title: [...firstLine].slice(0, 100).join('') })}>Usar la primera línea del texto como título</button>
        ) : null}
        <Field label="¿Quién puede verlo?" hint={!value.privacy ? 'Elige una opción.' : null}>
          <select className="input" value={value.privacy || ''} onChange={(e) => onChange({ privacy: e.target.value || undefined })} aria-invalid={!value.privacy}>
            <option value="" disabled>Elige la visibilidad…</option>
            <option value="public">Público (cualquiera puede verlo)</option>
            <option value="unlisted">No listado (solo quien tenga el enlace)</option>
            <option value="private">Privado (solo tú)</option>
          </select>
        </Field>
        <p className="opt-help">La descripción del vídeo es el texto de la pestaña <b>YouTube</b> del paso 4.</p>
      </div>
    </div>
  );
}
