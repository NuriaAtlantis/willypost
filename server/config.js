import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export const PORT = Number(process.env.WILLYPOST_PORT || 4747);
export const SHARE_PORT = Number(process.env.WILLYPOST_SHARE_PORT || 4748);
export const APP_URL = `http://localhost:${PORT}`;
export const LOCAL_REDIRECT = `${APP_URL}/oauth/callback`;

// Dominio de WillyPost: TODAS las direcciones públicas salen de aquí (web, relé OAuth, servidor central y
// proxy de medios). Si algún día cambia el dominio, se cambia solo en esta línea (y en docs/config.js y broker/).
export const DOMAIN = (process.env.WILLYPOST_DOMAIN || 'willypost.com').trim().toLowerCase();
export const SITE_URL = `https://${DOMAIN}/`;
// Servidor central (modo sin carné): añade la clave secreta de las apps de WillyPost en los canjes de tokens.
export const BROKER_URL = `https://auth.${DOMAIN}`;
// Proxy de medios para TikTok (sirve las fotos del túnel desde un dominio verificado).
export const MEDIA_PROXY = `https://media.${DOMAIN}`;

// Página estática HTTPS que reenvía el código OAuth a localhost.
// Necesaria para Meta y LinkedIn (y TikTok en modo central), que exigen redirect HTTPS.
export const RELAY_URL = process.env.WILLYPOST_RELAY || `${SITE_URL}callback.html`;

function defaultDataDir() {
  if (process.env.WILLYPOST_DATA) return process.env.WILLYPOST_DATA;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'WillyPost');
  }
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'WillyPost');
  return path.join(home, '.willypost');
}

export const DATA_DIR = defaultDataDir();
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const BIN_DIR = path.join(DATA_DIR, 'bin');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const DB_PATH = path.join(DATA_DIR, 'willypost.db');
for (const d of [DATA_DIR, MEDIA_DIR, BIN_DIR, LOG_DIR]) fs.mkdirSync(d, { recursive: true });

export const FEED_DAILY_MAX = 5;
export const STORY_DAILY_MAX = 10;
export const RECONNECT_DAYS = 30;
export const RECONNECT_WARN_DAYS = 25;
export const MISSED_GRACE_MIN = 15;
export const DEFAULT_QUEUE_TIMES = ['09:00', '13:30', '19:00'];

/**
 * Dirección de retorno OAuth de una red. Con el carné propio, la de siempre (relé o localhost según la red).
 * En modo central (creds.central): Google usa localhost (cliente de escritorio + PKCE) y el resto, el relé
 * registrado en las apps de WillyPost (el que anuncia el servidor central).
 */
export function redirectUriFor(provider, creds = null) {
  if (creds?.central) return provider.family === 'google' ? LOCAL_REDIRECT : (creds.relay || RELAY_URL);
  return provider.redirect === 'relay' ? RELAY_URL : LOCAL_REDIRECT;
}
