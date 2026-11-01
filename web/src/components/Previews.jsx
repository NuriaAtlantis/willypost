import { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Share2, Repeat2, Music, Globe, Play, MoreHorizontal, Image as ImageIcon } from 'lucide-react';
import { MediaThumb } from './Media.jsx';
import { NetIcon } from './NetIcon.jsx';

const Avatar = ({ url, name, size = 34, net }) => (
  <span className="pv-avatar" style={{ width: size, height: size }}>
    {url ? <img src={url} alt="" /> : <b>{(name || '?').replace('@', '')[0]?.toUpperCase()}</b>}
    {net ? <i><NetIcon id={net} size={Math.round(size * 0.45)} /></i> : null}
  </span>
);

function Placeholder({ ratio = '1 / 1' }) {
  return (
    <div className="pv-placeholder" style={{ aspectRatio: ratio }}>
      <ImageIcon size={30} />
      <span>Aquí irá tu imagen o vídeo</span>
    </div>
  );
}

function MediaBlock({ media, ratio = '1 / 1', dots }) {
  if (!media.length) return <Placeholder ratio={ratio} />;
  return (
    <div className="pv-media" style={{ aspectRatio: ratio }}>
      <MediaThumb m={media[0]} />
      {dots && media.length > 1 ? (
        <>
          <span className="pv-count">1/{media.length}</span>
          <span className="pv-dots">{media.map((m, i) => <i key={m.id} className={i === 0 ? 'on' : ''} />)}</span>
        </>
      ) : null}
    </div>
  );
}

function Clamp({ text, lines = 3, placeholder = 'Aquí verás tu texto…' }) {
  return <p className={`pv-text ${text ? '' : 'ph'}`} style={{ WebkitLineClamp: lines }}>{text || placeholder}</p>;
}

function Phone({ children, story }) {
  return (
    <div className="pv-phone">
      <div className="pv-notch" />
      <div className={`pv-screen ${story ? 'story' : ''}`}>{children}</div>
    </div>
  );
}

function Vertical({ net, type, caption, media, name, username, avatar }) {
  const isStory = type === 'story';
  return (
    <Phone story={isStory}>
      <div className="pv-vmedia">
        {media.length ? <MediaThumb m={media[0]} /> : <div className="pv-vph"><Play size={34} /><span>Vista vertical 9:16</span></div>}
      </div>
      {isStory ? (
        <div className="pv-story-top">
          <div className="pv-bars">{(media.length ? media : [1]).slice(0, 4).map((_, i) => <i key={i} className={i === 0 ? 'on' : ''} />)}</div>
          <div className="pv-story-who"><Avatar url={avatar} name={name} size={26} /><b>{username || name}</b><span>ahora</span></div>
        </div>
      ) : (
        <div className="pv-rail">
          <span><Heart size={22} /><em>12k</em></span>
          <span><MessageCircle size={22} /><em>340</em></span>
          <span><Send size={22} /></span>
          <span><MoreHorizontal size={22} /></span>
        </div>
      )}
      {!isStory && (
        <div className="pv-vcap">
          <b>@{(username || name || 'tu_cuenta').replace('@', '')}</b>
          <p style={{ WebkitLineClamp: 3 }}>{caption || 'Aquí verás tu texto…'}</p>
          {net === 'tiktok' || net === 'instagram' ? <small><Music size={11} /> Audio original</small> : null}
        </div>
      )}
    </Phone>
  );
}

function Instagram({ type, caption, media, name, username, avatar }) {
  const [ratio, setRatio] = useState('1 / 1');
  if (type === 'reel' || type === 'story') return <Vertical net="instagram" {...{ type, caption, media, name, username, avatar }} />;
  const user = (username || name || 'tu_cuenta').replace('@', '');
  return (
    <div className="pv-card ig">
      <div className="pv-head"><Avatar url={avatar} name={name} /><b>{user}</b><MoreHorizontal size={18} className="pv-more" /></div>
      <MediaBlock media={media} ratio={ratio} dots />
      <div className="pv-actions"><Heart size={22} /><MessageCircle size={22} /><Send size={22} /><Bookmark size={22} className="pv-right" /></div>
      <div className="pv-body"><p style={{ WebkitLineClamp: 3 }}><b>{user}</b> {caption || <span className="ph">Aquí verás tu texto…</span>}</p></div>
      <div className="pv-ratio">
        <button className={ratio === '1 / 1' ? 'on' : ''} onClick={() => setRatio('1 / 1')}>1:1</button>
        <button className={ratio === '4 / 5' ? 'on' : ''} onClick={() => setRatio('4 / 5')}>4:5</button>
      </div>
    </div>
  );
}

function Facebook({ type, caption, media, name, avatar }) {
  if (type === 'reel' || type === 'story') return <Vertical net="facebook" {...{ type, caption, media, name, avatar }} />;
  return (
    <div className="pv-card fb">
      <div className="pv-head"><Avatar url={avatar} name={name} /><div><b>{name || 'Tu página'}</b><small>Ahora · <Globe size={11} /></small></div><MoreHorizontal size={18} className="pv-more" /></div>
      <div className="pv-body"><Clamp text={caption} lines={5} /></div>
      {media.length > 1 ? (
        <div className="pv-grid">{media.slice(0, 4).map((m) => <MediaThumb key={m.id} m={m} />)}</div>
      ) : <MediaBlock media={media} ratio="1.91 / 1" />}
      <div className="pv-actions border"><span><ThumbsUp size={17} /> Me gusta</span><span><MessageCircle size={17} /> Comentar</span><span><Share2 size={17} /> Compartir</span></div>
    </div>
  );
}

function LinkedIn({ caption, media, name, avatar }) {
  return (
    <div className="pv-card li">
      <div className="pv-head"><Avatar url={avatar} name={name} size={40} /><div><b>{name || 'Tu nombre'}</b><small>Autónomo · Ahora · <Globe size={11} /></small></div></div>
      <div className="pv-body"><Clamp text={caption} lines={6} /></div>
      {media.length > 1 ? <div className="pv-grid">{media.slice(0, 4).map((m) => <MediaThumb key={m.id} m={m} />)}</div> : media.length ? <MediaBlock media={media} ratio="1.91 / 1" /> : null}
      <div className="pv-actions border"><span><ThumbsUp size={17} /> Recomendar</span><span><MessageCircle size={17} /> Comentar</span><span><Repeat2 size={17} /> Compartir</span><span><Send size={17} /> Enviar</span></div>
    </div>
  );
}

function Micro({ net, caption, media, name, username, avatar }) {
  return (
    <div className={`pv-card micro ${net}`}>
      <div className="pv-micro">
        <Avatar url={avatar} name={name} size={38} />
        <div className="pv-micro-main">
          <div><b>{name || 'Tu cuenta'}</b> <small>{username ? '@' + username.replace('@', '') : ''} · ahora</small></div>
          <Clamp text={caption} lines={8} />
          {media.length ? <div className={`pv-micro-media n${Math.min(media.length, 4)}`}>{media.slice(0, 4).map((m) => <MediaThumb key={m.id} m={m} />)}</div> : null}
          <div className="pv-icons"><MessageCircle size={17} /><Repeat2 size={17} /><Heart size={17} /><Send size={17} /></div>
        </div>
      </div>
    </div>
  );
}

function Gbp({ caption, media, name }) {
  return (
    <div className="pv-card gbp">
      <MediaBlock media={media} ratio="4 / 3" />
      <div className="pv-body">
        <small className="pv-tag">Novedad</small>
        <b>{name || 'Tu negocio'}</b>
        <Clamp text={caption} lines={5} />
        <span className="pv-cta">Más información</span>
      </div>
    </div>
  );
}

export function Preview({ net, type, caption, media = [], name, username, avatar }) {
  const p = { type, caption, media, name, username, avatar };
  switch (net) {
    case 'instagram': return <Instagram {...p} />;
    case 'facebook': return <Facebook {...p} />;
    case 'linkedin': return <LinkedIn {...p} />;
    case 'threads': return <Micro net="threads" {...p} />;
    case 'bluesky': return <Micro net="bluesky" {...p} />;
    case 'gbp': return <Gbp {...p} />;
    case 'tiktok':
    case 'youtube': return <Vertical net={net} {...p} />;
    default: return <Facebook {...p} />;
  }
}
