import path from 'node:path';
import fs from 'node:fs';
import { run, now } from './db.js';
import { APP_URL, ROOT } from './config.js';

let notifier = null;
try {
  notifier = (await import('node-notifier')).default;
} catch {
  notifier = null;
}

const ICON = path.join(ROOT, 'scripts', 'willypost.png');

/** Guarda la notificación (campana de la app) y la muestra en el escritorio. */
export function notify(userId, { kind = 'info', title, body = '', postId = null, desktop = true, open = '/#/' }) {
  run(
    'INSERT INTO notifications (user_id, kind, title, body, post_id, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    userId, kind, title, body, postId, now(),
  );
  if (desktop && notifier && process.env.WILLYPOST_NO_DESKTOP_NOTIFY !== '1') {
    try {
      notifier.notify({
        title: `WillyPost · ${title}`,
        message: body || title,
        appID: 'WillyPost',
        icon: fs.existsSync(ICON) ? ICON : undefined,
        open: APP_URL + open,
        wait: false,
      });
    } catch {
      /* las notificaciones de escritorio son opcionales */
    }
  }
}
