import { Facebook, Instagram, Linkedin, Youtube, AtSign, Store, Film, Image as ImageIcon, Images, Clapperboard, CircleDot } from 'lucide-react';
import { NET_FALLBACK } from '../lib/constants.js';

const TikTok = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.6 3c.3 2.4 1.7 4 4 4.2v3.1c-1.5.1-2.9-.4-4-1.2v6.2c0 3.2-2.6 5.7-5.8 5.7S5 18.5 5 15.3s2.6-5.7 5.8-5.7c.3 0 .6 0 .9.1v3.2a2.6 2.6 0 0 0-.9-.2 2.6 2.6 0 1 0 2.6 2.6V3h3.2Z" />
  </svg>
);
const Bluesky = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6.3 3.9C8.5 5.5 10.9 8.8 12 11c1.1-2.2 3.500-5.500 5.700-7.100 1.600-1.200 4.200-2.100 4.200.8 0 .6-.3 4.800-.5 5.500-.7 2.400-3.100 3-5.300 2.600 3.800.6 4.800 2.800 2.700 5-4 4.200-5.800-.9-6.800-3.500-1 2.600-2.800 7.700-6.800 3.500-2.100-2.200-1.100-4.400 2.700-5-2.200.4-4.600-.2-5.300-2.600C2.200 9.500 1.900 5.300 1.900 4.700c0-2.900 2.600-2 4.400-.8Z" />
  </svg>
);

const GLYPH = {
  facebook: (s) => <Facebook size={s} fill="currentColor" strokeWidth={1.5} />,
  instagram: (s) => <Instagram size={s} strokeWidth={2.2} />,
  linkedin: (s) => <Linkedin size={s} fill="currentColor" strokeWidth={1.5} />,
  youtube: (s) => <Youtube size={s} strokeWidth={2.2} />,
  threads: (s) => <AtSign size={s} strokeWidth={2.6} />,
  gbp: (s) => <Store size={s} strokeWidth={2.2} />,
  tiktok: (s) => <TikTok size={s} />,
  bluesky: (s) => <Bluesky size={s} />,
};

export const netColor = (id, networks) => {
  const n = networks && networks.find((x) => x.id === id);
  return (n && n.color) || (NET_FALLBACK[id] && NET_FALLBACK[id].color) || '#4A73AA';
};
export const netLabel = (id, networks) => {
  const n = networks && networks.find((x) => x.id === id);
  return (n && n.label) || (NET_FALLBACK[id] && NET_FALLBACK[id].label) || id;
};

// Círculo con el color de la red y su glifo en blanco
export function NetIcon({ id, size = 32, color, title }) {
  const g = GLYPH[id];
  const bg = color || (NET_FALLBACK[id] && NET_FALLBACK[id].color) || '#4A73AA';
  return (
    <span className="neticon" title={title} style={{ width: size, height: size, background: bg }}>
      {g ? g(Math.round(size * 0.52)) : <b style={{ fontSize: size * 0.45 }}>{(id || '?')[0].toUpperCase()}</b>}
    </span>
  );
}

export function NetDot({ id, color, size = 9 }) {
  const bg = color || (NET_FALLBACK[id] && NET_FALLBACK[id].color) || '#4A73AA';
  return <span className="netdot" style={{ width: size, height: size, background: bg }} />;
}

export const TYPE_ICON = { post: ImageIcon, carousel: Images, reel: Clapperboard, story: CircleDot, video: Film };
