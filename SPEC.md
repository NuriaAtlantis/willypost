# WillyPost — Especificación técnica (contrato entre módulos)

WillyPost es un programador de redes sociales **local** (tipo Metricool/Buffer/Later) que regala la
Willy SEO Academy a sus alumnos. Cada alumno lo instala en su ordenador (Windows/Mac), se registra
con email (cuenta 100% local), conecta sus redes con **su propio "carné" de desarrollador** (app
OAuth propia por red, guiada por un asistente), programa en un calendario y puede pedirle a **Claude**
campañas completas a través de un **servidor MCP** incluido.

Este documento es la fuente de verdad. Si un módulo necesita algo que no está aquí, se añade aquí.

## 0. Decisiones de producto (cerradas con la clienta)

- Redes: Facebook (Páginas), Instagram (cuenta profesional), TikTok, Google Business Profile (GBP),
  YouTube Shorts, LinkedIn (perfil personal), Threads, Bluesky.
- Tipos de contenido: `post` (texto/imagen), `carousel` (varias imágenes), `reel` (vídeo vertical), `story`.
- Límite por cuenta y día natural (hora local): **5 publicaciones de feed** (post+carousel+reel) y
  **10 stories**. Se valida al programar (HTTP 409) y lo muestra el calendario.
- **Reconexión obligatoria cada 30 días** por cuenta: `reconnect_due_at = connected_at + 30 días`.
  Desde el día 25: aviso. Pasado el día 30: la cuenta queda `expired`, no publica, y sus envíos
  pendientes pasan a `failed` con el mensaje "Reconecta tu cuenta".
- Solo las redes del propio alumno (sin multi-cliente en v1). Sin métricas en v1.
- Registro: email + contraseña, local. No se envía nada a nadie. Al registrarse se muestra un
  **código de recuperación** (para restablecer la contraseña).
- Claude: un ajuste `claude_mode` = `draft` (por defecto: lo que crea Claude llega como borrador
  "Propuesto por Claude" y el alumno lo aprueba) o `schedule` (Claude programa directamente).
- El ordenador debe estar encendido. Si estaba apagado a la hora programada, al arrancar los envíos
  atrasados (>15 min) pasan a estado `missed` y la app pregunta: Publicar ahora / Reprogramar / Omitir.
- **Modo manual (red de seguridad)**: si una red no está conectada por API, o la API no permite ese
  tipo de contenido (p. ej. carrusel en TikTok, story en Threads), el envío es `manual`: a su hora
  salta una notificación de escritorio y aparece en "Para publicar a mano" con botón Copiar texto,
  Descargar archivos, Abrir la red y "Ya lo he publicado".
- Instalación: descargar ZIP de GitHub → doble clic en `Instalar WillyPost` → se abre en el navegador
  en `http://localhost:4747`. Arranca solo al encender el ordenador.

## 1. Stack

- Node.js >= 22.13 (el instalador trae Node 24 LTS portable si no hay). ESM (`"type": "module"`).
- Backend: Express 5, `node:sqlite` (DatabaseSync, sin compilación nativa), multer 2, sharp (convertir
  imágenes a JPEG para Instagram y miniaturas), node-notifier (notificaciones de escritorio).
- Frontend: React 19 + Vite (en `web/`), FullCalendar 6 (daygrid, timegrid, list, interaction),
  lucide-react, @fontsource/onest. **El build (`web/dist`) se sube al repo**: el alumno no compila.
- MCP: `@modelcontextprotocol/sdk` + zod, transporte stdio, en `mcp/server.js`. Habla con la API
  HTTP local usando un token Bearer.
- Ejecutar siempre con `node --disable-warning=ExperimentalWarning server/index.js`.

## 2. Estructura del repositorio

```
willypost/
  package.json            scripts: start, dev, build:web, mcp
  server/
    index.js              arranque: DB, rutas, estáticos web/dist, scheduler, servidor de medios
    config.js             puertos, rutas de datos, RELAY_URL, versión
    db.js                 node:sqlite + migraciones (sección 4)
    auth.js               registro/login/sesiones/tokens API (scrypt de node:crypto)
    scheduler.js          bucle de publicación (sección 7)
    limits.js             límites 5/10 por día
    media.js              subida, miniaturas, conversión, rutas de medios
    share.js              servidor público de medios (puerto 4748) + túnel cloudflared (sección 8)
    notify.js             notificaciones de escritorio + tabla notifications
    oauth.js              estado OAuth, PKCE, callback genérico
    routes/*.js           API REST (sección 5)
    providers/
      index.js            registro de proveedores
      _http.js            helpers fetch (fetchJson, form, errores legibles)
      facebook.js instagram.js threads.js tiktok.js youtube.js gbp.js linkedin.js bluesky.js
  mcp/server.js           servidor MCP para Claude (sección 9)
  web/                    app React (sección 10); web/dist compilado y versionado
  docs/                   GitHub Pages: index.html, callback.html (relé OAuth), privacidad.html, guias/
  scripts/                instaladores y arranque (sección 11)
  skills/willypost-campanas/SKILL.md   skill opcional de Claude para crear campañas
```

Datos del usuario (fuera del repo, para que actualizar no los borre):
- Windows `%APPDATA%\WillyPost`, Mac `~/Library/Application Support/WillyPost`, Linux `~/.willypost`.
- Variable `WILLYPOST_DATA` lo sobrescribe. Dentro: `willypost.db`, `media/`, `bin/` (cloudflared), `logs/`.

## 3. Configuración (`server/config.js`)

```js
export const PORT = 4747;              // app + API (solo 127.0.0.1)
export const SHARE_PORT = 4748;        // solo sirve /m/:token (es lo único que expone el túnel)
export const APP_URL = `http://localhost:${PORT}`;
export const LOCAL_REDIRECT = `${APP_URL}/oauth/callback`;
export const RELAY_URL = process.env.WILLYPOST_RELAY || 'https://nuriaatlantis.github.io/willypost/callback.html'; // se ajusta al publicar el repo
export const DATA_DIR = ...;           // ver sección 2
export const FEED_DAILY_MAX = 5, STORY_DAILY_MAX = 10, RECONNECT_DAYS = 30, RECONNECT_WARN_DAYS = 25;
```

**Relé OAuth**: Meta (Facebook, Instagram, Threads) y LinkedIn exigen redirect HTTPS. Usamos una página
estática en GitHub Pages (`docs/callback.html`) que reenvía `?code&state` (y `error`) a
`http://localhost:4747/oauth/callback`. El `code` solo sirve con el secreto, que nunca sale del ordenador.
Google, TikTok (Login Kit Desktop) usan `LOCAL_REDIRECT` directamente. Cada proveedor declara
`redirect: 'relay' | 'local'`.

## 4. Base de datos (SQLite)

Fechas: ISO 8601 en UTC (`2026-11-03T09:30:00.000Z`). IDs: enteros autoincrementales.

```sql
users(id, email UNIQUE, name, password_hash, recovery_hash, created_at)
sessions(token PK, user_id, expires_at)                       -- cookie wp_session, 30 días
api_tokens(id, user_id, token_hash, label, created_at)        -- Bearer para MCP
settings(user_id, key, value, PRIMARY KEY(user_id,key))       -- claude_mode, timezone, onboarding_done, queue_times (JSON ["09:00","13:00","19:00"])
credentials(user_id, family, client_id, client_secret, extra JSON, updated_at, PRIMARY KEY(user_id,family))
  -- family: 'meta' (Facebook + Instagram vía Facebook Login), 'instagram' (Instagram Login), 'threads', 'google', 'tiktok', 'linkedin'
accounts(id, user_id, network, external_id, name, username, avatar_url,
         access_token, refresh_token, token_expires_at, meta JSON,
         mode 'api'|'manual', connected_at, last_error, created_at,
         UNIQUE(user_id, network, external_id))
oauth_pending(id, user_id, network, state, code_verifier, candidates JSON, account_id_reconnect, created_at)
media(id, user_id, filename, original_name, mime, kind 'image'|'video', size, width, height, created_at)
campaigns(id, user_id, name, description, color, created_at)
snippets(id, user_id, name, text, created_at)                -- grupos de hashtags / textos guardados
posts(id, user_id, type, caption, status, scheduled_at, created_by 'user'|'claude',
      campaign_id, notes, created_at, updated_at)
post_media(post_id, media_id, position)
post_targets(id, post_id, account_id, caption_override, options JSON, delivery 'api'|'manual',
             status, external_id, external_url, error, attempts, published_at, updated_at)
notifications(id, user_id, kind, title, body, post_id, read, created_at)
```

Estados de `posts.status`: `draft` · `scheduled` · `publishing` · `published` · `partial` (alguna red falló o
queda manual) · `failed` · `missed` · `manual` (solo quedan envíos manuales pendientes).
Estados de `post_targets.status`: `pending` · `publishing` · `published` · `failed` · `manual_pending` ·
`manual_done` · `skipped`.

Estado calculado de una cuenta (`accountStatus`): `ok` | `expiring` (días 25-30) | `expired` (>30 días o token
caducado sin refresh) | `error` (último intento con error de auth) | `manual` (mode manual).
`days_left = ceil((connected_at + 30d - now)/1d)`.

## 5. API REST (JSON). Prefijo `/api`. Auth: cookie `wp_session` o `Authorization: Bearer <api token>`

Errores: `{ "error": "mensaje en español para el usuario", "details": [...] }` con 400/401/404/409/500.

**Auth**
- `GET /api/auth/state` → `{ hasUsers, user|null }`
- `POST /api/auth/register {name,email,password}` → `{ user, recoveryCode }` (y cookie)
- `POST /api/auth/login {email,password}` → `{ user }`
- `POST /api/auth/logout`
- `POST /api/auth/reset {email, recoveryCode, newPassword}` → `{ ok, recoveryCode }` (nuevo código)
- `GET /api/me` → `{ user, settings }` · `PUT /api/settings {clave: valor,...}` → `{ settings }`

**Catálogo de redes**
- `GET /api/networks` → `[{ id, label, color, family, authType:'oauth'|'apppassword', redirect, redirectUri,
  supports:{post,carousel,reel,story,textOnly}, limits:{captionMax, carouselMax, videoMaxSec},
  needsApproval: string|null, notes: string, credsConfigured: bool, guide: 'guias/<id>.html' }]`

**Credenciales ("carnés")**
- `GET /api/credentials` → `[{ family, configured, client_id }]` (nunca devuelve el secreto)
- `PUT /api/credentials/:family {client_id, client_secret, extra?}` · `DELETE /api/credentials/:family`

**Cuentas**
- `GET /api/accounts` → `[{ id, network, name, username, avatar_url, mode, status, connected_at, reconnect_due_at, days_left, last_error }]`
- `POST /api/accounts/connect/:network` → `{ authUrl }` (OAuth). Bluesky: body `{handle, appPassword}` → `{ account }`
- `GET /oauth/callback?code&state[&error]` (sin /api) → si hay varias candidatas (páginas de FB, fichas de GBP)
  redirige a `/#/redes?pick=<pendingId>`; si no, guarda y redirige a `/#/redes?ok=<network>`; error → `/#/redes?error=<msg>`
- `GET /api/accounts/pending/:id` → `{ network, candidates:[{external_id,name,username,avatar_url}] }`
- `POST /api/accounts/pending/:id {external_ids:[...]}` → `{ accounts }`
- `POST /api/accounts/:id/reconnect` → `{ authUrl }` (Bluesky: `{appPassword}`)
- `POST /api/accounts/manual {network, name}` → cuenta en modo manual
- `DELETE /api/accounts/:id`

**Medios**
- `POST /api/media` multipart campo `files` (varios) → `[media]`
- `POST /api/media/from-path {path}` → `media` (lo usa el MCP: Claude pasa una ruta local)
- `GET /api/media` → `[media]` · `DELETE /api/media/:id`
- `GET /media/:id/file` y `GET /media/:id/thumb` (con sesión) → binario
- Objeto media: `{ id, url:'/media/1/file', thumb:'/media/1/thumb', original_name, mime, kind, size, width, height, created_at }`

**Publicaciones**
- `GET /api/posts?from&to&status&campaign_id` → `[post]`
- `GET /api/posts/:id` → `post`
- `POST /api/posts` body:
  ```json
  { "type":"post|carousel|reel|story", "caption":"texto base",
    "media_ids":[3,4], "targets":[{"account_id":1,"caption":null,"options":{}}],
    "scheduled_at":"ISO|null", "action":"draft|schedule|publish_now|queue",
    "campaign_id":null, "notes":"", "created_by":"user|claude" }
  ```
  `queue` = siguiente hueco libre de `queue_times` que respete los límites. Si `created_by=claude` y
  `claude_mode=draft`, `schedule` se convierte en `draft` (con `scheduled_at` conservado como fecha propuesta).
  Validación por red (sección 6) → 400 con `details:[{account_id, network, message}]`. Límite diario → 409.
- `PUT /api/posts/:id` (mismo body; no permitido si `published`)
- `POST /api/posts/:id/approve` → programa un borrador (requiere `scheduled_at`)
- `POST /api/posts/:id/publish-now` · `POST /api/posts/:id/duplicate` · `DELETE /api/posts/:id`
- `POST /api/posts/:id/missed {action:'publish'|'reschedule'|'skip', scheduled_at?}`
- `POST /api/targets/:id/manual-done {url?}` · `POST /api/targets/:id/retry`
- Objeto post:
  ```json
  { "id":1, "type":"reel", "caption":"...", "status":"scheduled", "scheduled_at":"...", "created_by":"user",
    "campaign": {"id":1,"name":"Black Friday","color":"#5881B9"} | null, "notes":"",
    "media":[media], "targets":[{ "id":1, "account_id":1, "network":"instagram", "account_name":"@willyseo",
      "caption":"texto efectivo", "caption_override":null, "options":{}, "delivery":"api|manual",
      "status":"pending", "external_url":null, "error":null, "published_at":null }],
    "created_at":"...", "updated_at":"..." }
  ```
- `GET /api/slots?from&to` → `[{ date:'2026-11-03', account_id, feed, story, feedMax:5, storyMax:10 }]`
- `GET /api/queue/next?account_ids=1,2&type=post` → `{ scheduled_at }`

**Otros**
- `GET/POST /api/campaigns`, `PUT/DELETE /api/campaigns/:id`
- `GET/POST /api/snippets`, `DELETE /api/snippets/:id`
- `GET /api/notifications` · `POST /api/notifications/read-all`
- `GET /api/claude` → `{ hasToken, mcp:{command,args,env}, claudeCodeCommand, desktopConfigPath, desktopInstalled }`
- `POST /api/claude/token` → `{ token }` (se muestra una vez) · `POST /api/claude/install-desktop` → `{ ok, path }`
- `GET /api/health` → `{ ok, version }`

## 6. Contrato de proveedores (`server/providers/<id>.js`)

```js
export default {
  id: 'instagram', label: 'Instagram', color: '#E1306C', family: 'instagram',
  authType: 'oauth',            // o 'apppassword' (bluesky)
  redirect: 'relay',            // 'relay' | 'local'
  supports: { post: true, carousel: true, reel: true, story: true, textOnly: false },
  limits: { captionMax: 2200, carouselMax: 10, videoMaxSec: 900 },
  needsApproval: null,          // texto si la red exige aprobación previa (GBP, TikTok público)
  notes: 'Requiere cuenta profesional.',

  // OAuth
  getAuthUrl({ creds, redirectUri, state, codeChallenge }) => string,
  async exchangeCode({ creds, redirectUri, code, codeVerifier }) => Candidate[],
      // Candidate: { external_id, name, username, avatar_url, access_token, refresh_token, token_expires_at, meta }
      // Si devuelve >1, el usuario elige (páginas de FB, fichas de GBP).
  async refresh({ account, creds }) => { access_token, refresh_token?, token_expires_at? } | null,
  // App password (bluesky)
  async connectWithPassword({ handle, appPassword }) => Candidate,

  validate({ type, caption, media, options }) => string[],   // mensajes en español; [] si ok.
      // Si la red no soporta el tipo por API, NO es error: el core marca delivery 'manual'.
  async publish({ account, creds, type, caption, media, options, ctx }) => { external_id, url },
      // media: [{ id, path (absoluta), mime, kind, width, height, original_name }]
      // ctx.publicUrl(mediaItem) → Promise<string> URL https temporal (abre túnel si hace falta)
      // ctx.log(...), ctx.sleep(ms), ctx.toJpeg(mediaItem) → Promise<{path, mime}>
      // Errores: throw new ProviderError(mensajeEspañol, { auth: bool, retryable: bool })
};
```

Extras acordados durante la construcción:
- `pkceMethod: 'tiktok-hex'` en un proveedor → el core genera el reto PKCE en hexadecimal (TikTok Desktop).
- `ProviderError` con `manual: true` → el core pasa el envío a `manual_pending` (p. ej. story de Facebook rechazada).
- `publish()` puede devolver `warning` (p. ej. YouTube dejó el vídeo en privado) → se guarda en `post_targets.warning`.
- `creds.extra.scopes` / `creds.extra.config_id` permiten ajustar el login de Meta sin tocar código.

`ProviderError` y helpers en `server/providers/_http.js`. Si `auth:true`, la cuenta pasa a `error` y se pide
reconectar. Los tokens se refrescan antes de publicar si `token_expires_at` < ahora + 10 min.

Capacidades por API (lo que no está, va por modo manual):
| red | post | carousel | reel | story | texto solo | medios | notas |
|---|---|---|---|---|---|---|---|
| facebook | ✓ | ✓ (multi-foto) | ✓ (video_reels) | ✓ intentar photo_stories/video_stories; si falla → manual | ✓ | foto por URL o binario; vídeo binario | Páginas |
| instagram | ✓ | ✓ | ✓ | ✓ | ✗ | URL pública (túnel) | JPEG; cuenta profesional; Instagram Login |
| threads | ✓ | ✓ | ✓ (vídeo) | ✗ | ✓ | URL pública | 500 caracteres |
| tiktok | ✗ | ✗ (fotos exigen dominio verificado) | ✓ FILE_UPLOAD | ✗ | ✗ | binario | sin auditoría: va a la bandeja (MEDIA_UPLOAD, por defecto) o privado (SELF_ONLY) |
| youtube | ✗ | ✗ | ✓ (Short) | ✗ | ✗ | subida resumible | options.title |
| gbp | ✓ (1 foto) | ✗ | ✗ | ✗ | ✓ | sourceUrl (túnel) | requiere aprobación de API de Google |
| linkedin | ✓ | ✓ (multi-imagen) | ✓ | ✗ | ✓ | binario | perfil personal |
| bluesky | ✓ | ✓ (≤4) | ✓ | ✗ | ✓ | uploadBlob | 300 caracteres, app password |

## 7. Scheduler (`server/scheduler.js`)

- Cada 20 s: envíos `pending` de posts `scheduled` con `scheduled_at <= ahora`.
- Al arrancar: envíos `pending` con `scheduled_at < ahora - 15 min` → post `missed` + notificación.
- `delivery = manual` → `manual_pending` + notificación de escritorio "Hora de publicar en Instagram".
- Cuenta caducada (30 días) → `failed` "Tu conexión con X ha caducado (30 días). Reconéctala en Redes."
- Reintentos: hasta 3 con espera 1, 5, 15 min si `retryable`.
- Recalcula `posts.status` tras cada envío. Notifica publicado / fallido.
- Diario: refresco preventivo de tokens (Instagram, Threads) y avisos de reconexión (días 25-30).

## 8. Medios públicos y túnel (`server/share.js`)

- Servidor aparte en `127.0.0.1:4748` que SOLO sirve `GET /m/:token/:filename` (tokens aleatorios de
  32 bytes, caducan en 2 h). Nada más es accesible desde fuera.
- `ctx.publicUrl(media)`: crea token y, si no hay túnel, descarga `cloudflared` (GitHub releases oficiales
  de cloudflare/cloudflared, a `DATA_DIR/bin`) y lanza `cloudflared tunnel --url http://127.0.0.1:4748 --no-autoupdate`,
  lee la URL `https://*.trycloudflare.com`. Cierra el túnel tras 15 min sin uso.
- `WILLYPOST_PUBLIC_BASE` permite usar otra URL pública (avanzado).

## 9. Servidor MCP (`mcp/server.js`)

stdio. Env: `WILLYPOST_URL` (def. `http://localhost:4747`), `WILLYPOST_TOKEN`. Herramientas (nombres en inglés,
descripciones en español, devuelven texto legible + JSON):
- `willypost_status` — usuario, fecha/hora y zona local, redes conectadas y su estado, `claude_mode`, límites.
- `list_accounts`
- `get_calendar {from, to}` — publicaciones con estado.
- `get_free_slots {from, to}` — huecos por cuenta y día respetando 5/10.
- `upload_media {path}` — sube un archivo local (imagen/vídeo) y devuelve `media_id`.
- `list_media`
- `create_post {type, caption, networks?|account_ids?, captions_by_network?, media_ids?, scheduled_at?, campaign?, notes?}`
- `create_campaign {name, description?, posts:[...mismo formato que create_post]}` — crea la campaña y todas sus piezas;
  devuelve resumen e incidencias por pieza sin abortar el resto.
- `update_post {id, ...}` · `delete_post {id}` (no publicados)
- `get_network_specs` — tamaños, formatos, límites de caracteres y buenas prácticas por red.
Siempre marca `created_by: 'claude'`. Si el servidor no responde: "Abre WillyPost (doble clic en el icono) y vuelve a intentarlo".

## 10. Interfaz (web/) — estética Willy SEO Academy

Tokens: ver `web/src/styles/tokens.css` (sacados de willyseo.net). Fuente Onest. Azul `#4A73AA`, tinta `#1B2638`,
marino `#203046`, fondo `#F4F6FA`, tarjetas blancas radio 24, borde `#E4E8EF`, sombras largas y suaves, titulares
800 con letter-spacing negativo y "pill" azul rotada -1.5° en la palabra clave. Tuteo, frases cortas y directas.

Rutas (hash router): `#/login`, `#/registro`, `#/` (calendario), `#/lista`, `#/manual`, `#/redes`, `#/medios`,
`#/ajustes`, `#/claude`, `#/ayuda`.
- Layout: barra lateral blanca (logo WillyPost + "by Willy SEO Academy", navegación con iconos Lucide, insignias
  de pendientes), cabecera con buscador de fecha, campana de notificaciones y botón primario "+ Crear publicación".
- Calendario: FullCalendar mes/semana/lista, eventos como chips con color de la red, icono del tipo y miniatura;
  arrastrar para reprogramar (respeta límites); en cada día, contador por red "3/5". Panel lateral de
  **borradores sin fecha** que se arrastran al calendario. Filtro por red y por campaña.
- Compositor (modal grande): tipo (Post, Carrusel, Reel, Story) → redes (avatares seleccionables) → medios
  (arrastrar archivos o elegir de la biblioteca, reordenar) → texto base + pestañas por red con contador de
  caracteres y snippets (hashtags guardados) → vista previa por red → fecha/hora o "Añadir a la cola" → botones
  Guardar borrador / Programar / Publicar ahora. Avisos claros si una red irá en modo manual.
- Redes: tarjeta por red con estado, anillo de 30 días, Conectar / Reconectar, y **asistente "Configura tu carné"**
  paso a paso (con la URI de redirección para copiar y los campos App ID / Secret).
- Para publicar a mano: lista con Copiar texto, Descargar, Abrir red, Ya publicado.
- Claude: explica en 3 pasos cómo conectarlo, botón "Conectar con Claude Desktop", comando para Claude Code,
  ejemplos de peticiones ("Hazme una campaña de Black Friday de 2 semanas para Instagram y TikTok"), y el
  interruptor de `claude_mode`.
- Pendientes de aprobar: badge "Propuesto por Claude" con botón Aprobar.
- Avisos: banner si hay `missed`, cuentas por caducar o fallos.

## 11. Instaladores y arranque (`scripts/`, lanzadores en la raíz)

Objetivo: el alumno descarga el ZIP, hace doble clic en "Instalar WillyPost" y funciona. Sin permisos de administrador.

**Dónde se instala.** El instalador copia la aplicación a una carpeta propia y trabaja desde ahí (así el alumno puede borrar la
carpeta descargada y no se rompe nada):
- Windows: `%LOCALAPPDATA%\WillyPost\app` · Mac: `~/Library/Application Support/WillyPost/app` (`WILLYPOST_APP_DIR` lo cambia).
- Los datos NO están ahí (sección 2), así que actualizar/reinstalar no los toca.
- Node: si hay `node` >= 22.13 se usa; si no, se descarga Node 24 LTS portable (con comprobación SHA-256) a `<app>/runtime/node`.
  La ruta del Node elegido queda en `<app>/runtime/node-path.txt`. Dependencias: `npm ci --omit=dev` (respaldo `npm install`).
- Arranque del servidor, siempre desde la raíz de la app: `<node> --disable-warning=ExperimentalWarning server/index.js`.

**Windows** (`Instalar WillyPost.bat` -> `scripts/windows/instalar.ps1`, lógica común en `lib.ps1`)
- Acceso en el Escritorio y en el menú Inicio (carpeta WillyPost, con "Desinstalar WillyPost"), arranque automático con un acceso en la
  carpeta Inicio del usuario, y entrada en "Aplicaciones instaladas" (HKCU). Todos apuntan a `wscript.exe iniciar-oculto.vbs [abrir]`,
  que arranca el servidor sin ventana (registro en `<datos>/logs/servidor.log`) y, con `abrir`, abre el navegador.
- `scripts/windows/iniciar.bat` (arranca y abre; `visible` lo ejecuta en la ventana), `detener.bat`, `Desinstalar WillyPost.bat`.

**macOS** (`Instalar WillyPost.command` -> `scripts/mac/instalar.sh`, lógica común en `lib.sh`)
- LaunchAgent `~/Library/LaunchAgents/com.willyseo.willypost.plist` (RunAtLoad, KeepAlive solo si falla, registro en `<datos>/logs/servidor.log`),
  app `~/Applications/WillyPost.app` (lanzador con icono, aparece en Launchpad/Spotlight), `Abrir WillyPost.command`, `Desinstalar WillyPost.command`.
- Quita la cuarentena (`xattr -dr com.apple.quarantine`). El primer arranque exige "clic derecho -> Abrir" (Gatekeeper).

**Lo que el instalador exige al núcleo**
- `GET http://127.0.0.1:4747/api/health` responde 200 con JSON que contiene `"ok":true` (lo usan los instaladores, `iniciar-oculto.vbs`, `abrir.sh`).
- El servidor escucha en `127.0.0.1` y, si el puerto ya lo tiene otro WillyPost, sale con código 0 (así `KeepAlive` no lo relanza en bucle).
- Respeta `WILLYPOST_PORT`, `WILLYPOST_SHARE_PORT` y `WILLYPOST_DATA` (los scripts también los leen, para pruebas).
- Termina limpio con SIGTERM/SIGINT (y cierra el túnel hijo).

**Variables de prueba de los instaladores:** `DRYRUN=1` (solo imprime), `WILLYPOST_FORCE=1`, `WILLYPOST_NO_OPEN=1`,
`WILLYPOST_SKIP_SHORTCUTS=1` (solo Windows), `WILLYPOST_IGNORE_SYSTEM_NODE=1`, `WILLYPOST_FAKE_OS=Darwin` (probar los .sh fuera de Mac).

## 12. Web de documentación (`docs/`, GitHub Pages)

HTML/CSS/JS estáticos, sin build. Se publica desde `main` / `/docs`. `docs/config.js` es el ÚNICO sitio donde viven la URL del repositorio,
la URI de redirección del relé (`relayUrl`, debe coincidir con `RELAY_URL` de `server/config.js`), la de localhost y el email de contacto.
`docs/callback.html` es el relé OAuth: reenvía `?code&state&error` a `http://localhost:4747/oauth/callback`, sin scripts ni recursos externos.
Guías por red en `docs/guias/<id>.html` (el asistente de Redes enlaza a `guias/<network.id>.html`; `claude.html` y `index.html` también existen).
