# Modo central (apps aprobadas por cada red)

Objetivo: que el alumno pulse «Conectar» y acepte, sin crear apps de desarrollador ni copiar claves.
Hay UNA app por red, titular **Diving With Us SL**, aprobada por cada plataforma. La opción de usar
tu propia app («carné») se mantiene como opción avanzada.

## Piezas y direcciones

| Pieza | Dirección | Qué hace |
|---|---|---|
| Web y guías (GitHub Pages, dominio propio) | `https://willypost.com/` | Portada, privacidad, términos, borrar datos, guías |
| Página de vuelta OAuth (ya existe) | `https://willypost.com/callback.html` | Reenvía `code` y `state` a `http://localhost:<puerto>/oauth/callback` |
| Servidor central (Cloudflare Worker) | `https://auth.willypost.com` | Añade la clave secreta en los canjes de tokens. No guarda nada. |
| Proxy de medios (mismo Worker) | `https://media.willypost.com` | Sirve a TikTok las fotos desde un dominio verificado |

**Alojamiento (decidido el 2-nov-2026): todo en Hostinger**, donde Nuria ya tiene sus webs.
- `willypost.com` se compra en Hostinger; su DNS se gestiona en el hPanel de Hostinger.
- La web sigue en GitHub Pages (se actualiza sola con el repositorio): en el DNS de Hostinger,
  registros A de `willypost.com` a las IP de GitHub Pages y CNAME `www` → `nuriaatlantis.github.io`.
- `auth.willypost.com` y `media.willypost.com` son subdominios en el hosting de Hostinger que sirven
  el broker en **PHP** (`broker/hostinger/`), con los secretos en un `config.php` fuera de `public_html`.
- `broker/worker.js` (Cloudflare) se mantiene como implementación de referencia, probada con tests,
  y como alternativa. Las dos versiones cumplen exactamente el mismo contrato.

Todas las direcciones salen de una sola constante de dominio (`willypost.com`) en `server/config.js`,
en `docs/config.js` y en `broker/wrangler.toml`. Si se compra otro dominio, se cambia solo ahí.

## Servidor central (broker) — contrato

Sin estado, sin base de datos, sin registros con tokens. Secretos como variables de entorno del Worker:
`META_APP_ID, META_APP_SECRET, META_CONFIG_ID, IG_APP_ID, IG_APP_SECRET, THREADS_APP_ID,
THREADS_APP_SECRET, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET` (el de Google es de tipo «App de escritorio»: Google lo
considera público, por eso se puede entregar). Una red sin sus variables simplemente no aparece.

### `GET /config`
Datos públicos para que WillyPost sepa qué redes funcionan en modo central (caché 1 h en la app):
```json
{ "version": 1,
  "relay": "https://willypost.com/callback.html",
  "media": "https://media.willypost.com",
  "networks": {
    "meta":      { "client_id": "…", "config_id": "…" },
    "instagram": { "client_id": "…" },
    "threads":   { "client_id": "…" },
    "tiktok":    { "client_id": "…" },
    "linkedin":  { "client_id": "…" },
    "google":    { "client_id": "…", "client_secret": "…" } } }
```
`meta` sirve para la red `facebook`; `google` para `youtube` y `gbp`.

### `POST /token/:family/:op`  (JSON de entrada, JSON de salida)
El broker añade `client_id`/`client_secret` (o `client_key` en TikTok), llama al endpoint oficial y
devuelve **tal cual** el JSON y el código HTTP de la red. Solo estas operaciones (lista cerrada):

| family | op | Entrada | Llamada oficial |
|---|---|---|---|
| meta | `code` | `{code, redirect_uri}` | GET `https://graph.facebook.com/v26.0/oauth/access_token` |
| meta | `long_lived` | `{access_token}` | GET mismo endpoint con `grant_type=fb_exchange_token` |
| instagram | `code` | `{code, redirect_uri}` | POST form `https://api.instagram.com/oauth/access_token` (`grant_type=authorization_code`) |
| instagram | `long_lived` | `{access_token}` | GET `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` |
| threads | `code` | `{code, redirect_uri}` | POST form `https://graph.threads.com/oauth/access_token` |
| threads | `long_lived` | `{access_token}` | GET `https://graph.threads.com/access_token?grant_type=th_exchange_token` |
| tiktok | `code` | `{code, redirect_uri, code_verifier}` | POST form `https://open.tiktokapis.com/v2/oauth/token/` |
| tiktok | `refresh` | `{refresh_token}` | mismo endpoint, `grant_type=refresh_token` |
| linkedin | `code` | `{code, redirect_uri}` | POST form `https://www.linkedin.com/oauth/v2/accessToken` |

Reglas: `redirect_uri` debe ser exactamente el `relay`; campos de texto limitados (≤ 4 KB);
cuerpo ≤ 16 KB; solo `POST` con `Content-Type: application/json`; respuesta con
`Cache-Control: no-store`; nunca se registra el cuerpo. La versión de Graph API debe coincidir con la
que usan los proveedores de WillyPost (hoy v26.0; un test lo comprueba). TikTok en modo central también usa el
`relay` como redirect (no localhost). Las extensiones del proxy de medios van siempre en minúsculas.

Errores propios del broker: `{ "error": "willypost_<motivo>", "message": "<texto en español>" }` con
400 (petición mal formada), 404 (operación o red no configurada), 413, 429, 502 (la red no responde).

### `GET https://media.willypost.com/t/<sub>/m/<token>/<archivo>`
Reenvía (streaming, sin guardar) `https://<sub>.trycloudflare.com/m/<token>/<archivo>`.
`<sub>` = `[a-z0-9-]{3,63}`, `<token>` = `[A-Za-z0-9_-]{16,128}`, `<archivo>` = `media.(jpg|jpeg|png|webp|gif|mp4|mov|webm)`.
Solo GET/HEAD; solo respuestas `image/*` o `video/*`; sin redirecciones (TikTok no las acepta);
pasa `Range`/`Content-Length`. TikTok verifica el dominio `willypost.com` por DNS (cubre subdominios).

### `GET /health` → `{ "ok": true, "networks": ["meta", …] }`

## WillyPost (app local)

- Cada familia usa **su propio carné si el alumno lo ha guardado**; si no, el **modo central** si
  `/config` la trae; si no, la red pide carné como ahora.
- En modo central, las llamadas que necesitan secreto van a `POST /token/:family/:op`; todo lo demás
  (Graph API, publicar, refrescos sin secreto como `ig_refresh_token` y `th_refresh_token`) sigue
  saliendo del ordenador del alumno.
- Google en modo central: cliente de escritorio, `redirect_uri = http://localhost:<puerto>/oauth/callback`
  con PKCE, canje directo a Google desde el ordenador (no pasa por el broker).
- Fotos de TikTok en modo central: la URL pública del túnel `https://<sub>.trycloudflare.com/m/…`
  se convierte en `https://media.willypost.com/t/<sub>/m/…`.
- `/api/networks` añade `central: true` cuando la red se puede conectar sin carné.
