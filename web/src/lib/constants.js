// Dónde viven las guías paso a paso (GitHub Pages del repositorio). Cámbialo aquí si cambia la URL.
export const DOCS_BASE = 'https://nuriaatlantis.github.io/willypost/';

export const FEED_MAX = 5;
export const STORY_MAX = 10;

export const TYPES = [
  { id: 'post', label: 'Post', hint: 'Texto con imagen', icon: 'Image' },
  { id: 'carousel', label: 'Carrusel', hint: 'Varias imágenes', icon: 'Images' },
  { id: 'reel', label: 'Reel / Vídeo', hint: 'Vídeo vertical', icon: 'Clapperboard' },
  { id: 'story', label: 'Story', hint: 'Dura 24 horas', icon: 'CircleDot' },
];
export const TYPE_LABEL = { post: 'Post', carousel: 'Carrusel', reel: 'Reel', story: 'Story' };

// Datos de reserva por si /api/networks tarda o falla (el servidor manda la verdad).
export const NET_FALLBACK = {
  facebook: { label: 'Facebook', color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  threads: { label: 'Threads', color: '#101010' },
  tiktok: { label: 'TikTok', color: '#111111' },
  youtube: { label: 'YouTube Shorts', color: '#FF0000' },
  gbp: { label: 'Google Business Profile', color: '#34A853' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2' },
  bluesky: { label: 'Bluesky', color: '#1185FE' },
};
export const NET_ORDER = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'threads', 'bluesky', 'gbp'];

export const NET_SITE = {
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  threads: 'https://www.threads.net/',
  tiktok: 'https://www.tiktok.com/upload',
  youtube: 'https://studio.youtube.com/',
  gbp: 'https://business.google.com/',
  linkedin: 'https://www.linkedin.com/feed/',
  bluesky: 'https://bsky.app/',
};

export const POST_STATUS = {
  draft: { label: 'Borrador', tone: 'gray' },
  scheduled: { label: 'Programada', tone: 'blue' },
  publishing: { label: 'Publicando…', tone: 'blue' },
  published: { label: 'Publicada', tone: 'green' },
  partial: { label: 'Parcial', tone: 'amber' },
  failed: { label: 'Fallida', tone: 'red' },
  missed: { label: 'Sin publicar', tone: 'amber' },
  manual: { label: 'A mano', tone: 'amber' },
};
// Estados en los que el servidor deja editar una publicación.
export const EDITABLE_STATUS = ['draft', 'scheduled', 'missed', 'failed'];
export const TARGET_STATUS = {
  pending: { label: 'Pendiente', tone: 'gray' },
  publishing: { label: 'Publicando…', tone: 'blue' },
  published: { label: 'Publicada', tone: 'green' },
  failed: { label: 'Ha fallado', tone: 'red' },
  manual_pending: { label: 'Toca publicar a mano', tone: 'amber' },
  manual_done: { label: 'Publicada a mano', tone: 'green' },
  skipped: { label: 'Omitida', tone: 'gray' },
};
export const ACCOUNT_STATUS = {
  ok: { label: 'Conectada', tone: 'green' },
  expiring: { label: 'Reconecta pronto', tone: 'amber' },
  expired: { label: 'Caducada', tone: 'red' },
  error: { label: 'Con error', tone: 'red' },
  manual: { label: 'Modo manual', tone: 'gray' },
};

// Familias de credenciales ("carnés")
export const FAMILY_INFO = {
  meta: {
    title: 'Carné de Facebook (Meta)',
    portal: 'https://developers.facebook.com/apps/',
    portalLabel: 'Meta para desarrolladores',
    idLabel: 'ID de la app',
    secretLabel: 'Clave secreta de la app',
    steps: [
      'Entra en Meta para desarrolladores con tu cuenta de Facebook y pulsa "Crear app".',
      'Elige el caso de uso "Gestionar todo en tu Página" (si no aparece: "Otro" y tipo "Empresa"). Ponle el nombre que quieras.',
      'En "Inicio de sesión con Facebook" → Configuración, pega la URI de redirección que ves abajo (la guía te dice dónde está exactamente).',
      'En Configuración > Básica copia el "ID de la app" y la "Clave secreta" y pégalos aquí.',
    ],
  },
  instagram: {
    title: 'Carné de Instagram (Meta)',
    portal: 'https://developers.facebook.com/apps/',
    portalLabel: 'Meta para desarrolladores',
    idLabel: 'ID de la app de Instagram',
    secretLabel: 'Clave secreta de la app de Instagram',
    steps: [
      'Entra en Meta para desarrolladores y abre tu app (o crea una nueva).',
      'Añade el producto "Instagram" y elige "Inicio de sesión con Instagram".',
      'Pega la URI de redirección que ves abajo en "URI de redireccionamiento OAuth válidos".',
      'Copia el "ID de la app de Instagram" y su clave secreta y pégalos aquí.',
    ],
  },
  threads: {
    title: 'Carné de Threads (Meta)',
    portal: 'https://developers.facebook.com/apps/',
    portalLabel: 'Meta para desarrolladores',
    idLabel: 'ID de la app de Threads',
    secretLabel: 'Clave secreta de la app de Threads',
    steps: [
      'Entra en Meta para desarrolladores y abre tu app (o crea una nueva).',
      'Añade el caso de uso "Acceder a la API de Threads".',
      'Pega la URI de redirección que ves abajo y añade tu usuario como "Probador de Threads".',
      'Copia el "ID de la app de Threads" y su clave secreta y pégalos aquí.',
    ],
  },
  google: {
    title: 'Carné de Google (YouTube + Google Business)',
    portal: 'https://console.cloud.google.com/apis/credentials',
    portalLabel: 'Google Cloud Console',
    idLabel: 'ID de cliente',
    secretLabel: 'Secreto de cliente',
    steps: [
      'Entra en Google Cloud Console y crea un proyecto nuevo.',
      'Activa las APIs "YouTube Data API v3" y la de Google Business Profile.',
      'En Credenciales crea un "ID de cliente de OAuth" de tipo "Aplicación web" y pega la URI de redirección que ves abajo.',
      'Copia el ID de cliente y el secreto y pégalos aquí.',
    ],
  },
  tiktok: {
    title: 'Carné de TikTok',
    portal: 'https://developers.tiktok.com/apps/',
    portalLabel: 'TikTok para desarrolladores',
    idLabel: 'Client key',
    secretLabel: 'Client secret',
    steps: [
      'Entra en TikTok para desarrolladores y pulsa "Connect an app".',
      'Añade el producto "Login Kit" y el producto "Content Posting API".',
      'Pega la URI de redirección que ves abajo en el Login Kit.',
      'Copia la "Client key" y el "Client secret" y pégalos aquí.',
    ],
  },
  linkedin: {
    title: 'Carné de LinkedIn',
    portal: 'https://www.linkedin.com/developers/apps',
    portalLabel: 'LinkedIn para desarrolladores',
    idLabel: 'Client ID',
    secretLabel: 'Client Secret',
    steps: [
      'Entra en LinkedIn para desarrolladores y pulsa "Create app" (necesitas una página de empresa, aunque sea vacía).',
      'En la pestaña Products solicita "Share on LinkedIn" y "Sign In with LinkedIn using OpenID Connect".',
      'En la pestaña Auth pega la URI de redirección que ves abajo.',
      'Copia el Client ID y el Client Secret y pégalos aquí.',
    ],
  },
};
