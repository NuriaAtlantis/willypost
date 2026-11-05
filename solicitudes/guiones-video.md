# Guiones de los vídeos de demostración

La interfaz de WillyPost está en **español**, así que cada vídeo lleva **subtítulos en inglés** (rótulos
de texto) que explican qué pasa. Los rótulos van entre comillas en cada plano: cópialos tal cual.

## Cómo grabar (igual para todos)

- **Resolución:** 1920 × 1080 (1080p). Navegador a pantalla completa, zoom 100 %, sin otras pestañas con datos personales. Cierra notificaciones.
- **Grabar:** OBS Studio (gratis) o la Barra de juegos de Windows (**Win + Alt + R**, graba la ventana del navegador). Mueve el ratón despacio y haz una pausa de 2 s en cada pantalla importante.
- **Rótulos:** en **Clipchamp** (viene con Windows 11): arrastra el vídeo → **Texto** → elige un estilo simple → escribe el rótulo → ajusta la duración al plano. Exporta en **1080p**.
- **Idioma de las redes:** pon Facebook, Instagram, Threads, TikTok y Google **en inglés** mientras grabas (Google lo exige: selector abajo a la izquierda de su pantalla). Así el revisor lee los permisos.
- **Barra de direcciones visible** en los planos de inicio de sesión: los revisores quieren ver `facebook.com`, `tiktok.com`, `accounts.google.com`… y la vuelta por `willypost.com/callback.html`.
- **Cuentas:** usa tus cuentas de prueba (Página de prueba, Instagram profesional de prueba…). Nada de datos de clientes.
- **Empieza siempre** con el plano 0 y **acaba** viendo la publicación en la red.
- Tamaño: Meta y Google no ponen problema; **TikTok: máximo 50 MB por vídeo y 5 vídeos**. Si pasa de 50 MB, exporta en Clipchamp con calidad «720p» solo ese vídeo (o recórtalo).

### Plano 0 (común, 10–15 s)
1. Portada `https://willypost.com/` → rótulo: **"WillyPost – free, non-profit desktop social media scheduler (UI in Spanish)."**
2. Abrir WillyPost en `http://localhost:4747`, ya con sesión iniciada en el **Calendario** → rótulo: **"WillyPost runs on the user's computer. 'Redes' = Networks."**

---

## 1. Meta — 8 vídeos, uno por permiso, sacados de 3 grabaciones

Graba **tres sesiones largas** (Facebook, Instagram, Threads) a 1080p y sácales los cortes de cada permiso
con Clipchamp. Cada vídeo debe enseñar: inicio de sesión con la barra de direcciones visible → pantalla de
Facebook/Threads con el nombre **WillyPost** → el uso concreto de ese permiso → el resultado en la red.
Estas grabaciones sirven también para las llamadas de prueba de `meta.md` §5.

**Antes de grabar**
- Facebook, Instagram y Threads **en inglés**. WillyPost actualizado y con el servidor de conexión ya configurado (`meta.md` §3).
- En Facebook vas a marcar **dos Páginas**, una de ellas del portfolio **AtlantisLZT**: con dos, WillyPost enseña su lista de Páginas (con una sola la conecta directamente y no se ve).
- Una cuenta de Instagram **profesional** vinculada a una de esas Páginas.
- Una foto, tres fotos para el carrusel y un vídeo vertical de 5–15 s, de contenido neutro. Lo de Instagram y Threads es público: bórralo a mano al acabar.

### Sesión Facebook (caso de uso «Administrar todos los aspectos de tu página»)
| # | Qué se ve | Rótulo |
|---|---|---|
| F1 | Plano 0 | (ver arriba) |
| F2 | **Redes** → tarjeta Facebook → **Conectar Facebook** | "The user clicks 'Conectar Facebook' (Connect Facebook)." |
| F3 | `facebook.com` (barra visible): *Continue as …* → pantalla con el nombre **WillyPost** | "Facebook Login for Business: WillyPost asks for access to the user's Pages." |
| F4 | Elegir el portfolio **AtlantisLZT** si aparece → marcar las dos Páginas → revisar los permisos → *Save* / *Continue* | "The user chooses the Pages WillyPost can use, including a Page owned by a business portfolio." |
| F5 | «Volviendo a WillyPost…» en `willypost.com/callback.html` (1 s) | "willypost.com/callback.html forwards the authorization code to the app on this computer." |
| F6 | Diálogo **¿Qué quieres conectar de Facebook?** con las dos Páginas → marcar una → **Conectar** | "pages_show_list: WillyPost lists the Pages returned by /me/accounts so the user can pick one." |
| F7 | La Página conectada en **Redes**, con su nombre y su foto | "pages_read_engagement: the Page name, picture and Page access token are read to set up publishing." |
| F8 | **Crear publicación** → **Post** → ¿Dónde?: la Página → una foto → texto → **Publicar ahora** → estado publicado | "pages_manage_posts: the user publishes a photo post to the Page." |
| F9 | **Crear publicación** → **Reel / Vídeo** → vídeo vertical → la Página → ¿Cuándo?: dentro de 2 min → **Programar** → se ve en el **Calendario** → pasa a publicado | "pages_manage_posts: the user schedules a Reel; WillyPost publishes it at the chosen time." |
| F10 | **Lista** → la publicación → **Ver publicación** → se abre en Facebook | "pages_read_engagement: WillyPost reads the permalink so the user can open the live post." |

**Cortes**
- `pages_show_list` = F1–F7.
- `pages_read_engagement` = F1–F7 + F10.
- `pages_manage_posts` = F1–F5 + F8–F10.
- `business_management` = F1–F7, con F4 más lento y este rótulo en lugar del suyo: "business_management: this Page belongs to the business portfolio 'AtlantisLZT'. Without this permission it would not be listed." y en F6: "The business-owned Page appears in WillyPost and can be connected."

### Sesión Instagram (caso de uso «Administrar mensajes y contenido en Instagram»)
| # | Qué se ve | Rótulo |
|---|---|---|
| I1 | Plano 0 | |
| I2 | **Redes** → tarjeta Instagram → **Conectar Instagram** | "The user clicks 'Conectar Instagram' (Connect Instagram). Instagram is connected through Facebook Login for Business." |
| I3 | `facebook.com` (barra visible): *Continue as …* → **WillyPost** → marcar la cuenta de **Instagram** → marcar su **Página** (y el portfolio si aparece) → revisar permisos → *Save* | "The user selects their Instagram professional account and the Facebook Page it is linked to." |
| I4 | Vuelta por `willypost.com/callback.html` → en **Redes**, la cuenta de Instagram conectada con su @usuario y su foto | "instagram_basic: WillyPost finds the Instagram account linked to the Page and shows its username and picture." |
| I5 | **Crear publicación** → **Carrusel** → 3 fotos → ¿Dónde?: Instagram → texto → **Publicar ahora** → publicado | "instagram_content_publish: the user publishes a carousel to Instagram." |
| I6 | **Reel / Vídeo** → vídeo vertical → Instagram → dentro de 2 min → **Programar** → pasa a publicado | "instagram_content_publish: the scheduled Reel is published at the chosen time." |
| I7 | **Lista** → **Ver publicación** → se abre en `instagram.com`; después el perfil con las dos publicaciones | "The content is live on the user's Instagram account." |

**Cortes**
- `instagram_basic` = I1–I4 + I7.
- `instagram_content_publish` = I1–I7.
- Solo si el formulario vuelve a pedir `pages_show_list`, `pages_read_engagement` o `business_management` dentro del caso de uso de Instagram: I1–I4, cambiando el rótulo de I4 por "pages_show_list / pages_read_engagement / business_management: /me/accounts returns the granted Page, its Page access token and its linked Instagram account."

### Sesión Threads (caso de uso «Acceder a la API de Threads»)
| # | Qué se ve | Rótulo |
|---|---|---|
| T1 | Plano 0 | |
| T2 | **Redes** → tarjeta Threads → **Conectar Threads** | "The user clicks 'Conectar Threads' (Connect Threads)." |
| T3 | `threads.com` (barra visible): login → pantalla de **WillyPost** con los permisos → **Allow** | "Threads authorization: the user grants WillyPost access to their profile and to publish." |
| T4 | Vuelta por `willypost.com/callback.html` → perfil conectado con @usuario y foto | "threads_basic: profile username and picture shown as the connected account." |
| T5 | **Crear publicación** → **Post** → ¿Dónde?: Threads → texto y una foto → **Publicar ahora** → publicado | "threads_content_publish: the user publishes a post with a photo to Threads." |
| T6 | **Lista** → **Ver publicación** → el post en Threads | "The post is live on Threads." |

**Cortes:** `threads_basic` = T1–T4 + T6 · `threads_content_publish` = T1–T6.

---

## 2. TikTok — 3 vídeos (máx. 5, ≤ 50 MB cada uno)

Requisito previo: la pantalla de publicación ya cumple las normas de TikTok (`tiktok.md` §0). Graba con el
**Sandbox** si la app aún no está aprobada, y la cuenta de TikTok de prueba en **privado**.

### Vídeo 2.1 — Login Kit y `user.info.basic` (≈ 1 min)
| # | Qué se ve | Rótulo |
|---|---|---|
| 1 | Plano 0 (incluye la portada willypost.com con los enlaces de Privacidad y Términos) | "Website with Privacy Policy and Terms: willypost.com" |
| 2 | Redes → **Conectar TikTok** | "User clicks 'Conectar TikTok' (Connect TikTok)." |
| 3 | `tiktok.com` en inglés: login → pantalla de autorización de **WillyPost** con los permisos → **Continue/Authorize** | "TikTok Login Kit: the user authorizes WillyPost (user.info.basic, video.upload, video.publish)." |
| 4 | Vuelta por `willypost.com/callback.html` → cuenta conectada con nombre y avatar | "user.info.basic: display name and avatar identify the connected TikTok account." |

### Vídeo 2.2 — `video.upload` (envío a la bandeja) (≈ 1,5 min)
| # | Qué se ve | Rótulo |
|---|---|---|
| 1 | **Crear publicación** → **Reel / Vídeo** → vídeo → ¿Dónde?: TikTok | "The user prepares a video for TikTok." |
| 2 | Opciones de TikTok → **Enviar a tu bandeja de TikTok** → texto → **Publicar ahora** | "video.upload: WillyPost sends the video to the user's TikTok inbox." |
| 3 | Estado en WillyPost (enviado a la bandeja) | "WillyPost shows the upload status." |
| 4 | Móvil (grabación de pantalla del teléfono o cámara): notificación de TikTok → bandeja → editar → Publicar | "The user finishes and posts the video in the TikTok app." |

### Vídeo 2.3 — `video.publish` (publicación directa) — también sirve para la auditoría (≈ 2 min)
| # | Qué se ve | Rótulo |
|---|---|---|
| 1 | **Crear publicación** → **Reel / Vídeo** → vídeo → TikTok → **Publicar directamente** | "video.publish: direct post." |
| 2 | Se ve el **nombre de la cuenta** de TikTok que publicará | "Creator nickname from creator_info is shown." |
| 3 | Desplegable de **privacidad** vacío → el usuario elige una opción (sin auditoría: «Solo yo») | "Privacy level: only options allowed by TikTok, no default; the user must choose." |
| 4 | Casillas **Permitir comentarios / dúos / stitch** desmarcadas → el usuario marca una | "Interaction settings are off by default; the user turns them on." |
| 5 | Interruptor **contenido comercial** → «Tu marca» / «Contenido de marca» y sus avisos; apagarlo | "Commercial content disclosure as required by TikTok." |
| 6 | Vista previa y la frase de la **Confirmación de uso de música** junto al botón | "Preview and Music Usage Confirmation shown before posting." |
| 7 | **Programar** para dentro de 2 min → estado «procesando» → «publicado» | "The post is published at the scheduled time with exactly these settings; status is polled." |
| 8 | Abrir el perfil de TikTok y ver el vídeo | "The video on the user's TikTok profile." |

(Si WillyPost publica **fotos** en TikTok, añade un vídeo 2.4 igual que el 2.3 con fotos, enseñando que
las URL son de `media.willypost.com`.)

---

## 3. Google — 1 vídeo para la verificación (subir a YouTube como «No listado»)

Pon la pantalla de Google **en inglés**. Google quiere ver: la app con el mismo nombre que en la
consola, la pantalla de consentimiento **completa** con todos los permisos, y el uso de **cada** permiso.

| # | Qué se ve | Rótulo |
|---|---|---|
| 1 | Portada `https://willypost.com/` → bajar hasta los enlaces de Privacidad y Términos → abrir la privacidad y enseñar el apartado «Datos de usuario de Google» | "WillyPost homepage and privacy policy (Google API Services User Data Policy, Limited Use)." |
| 2 | WillyPost → Redes → **Conectar YouTube** | "User clicks 'Conectar YouTube' (Connect YouTube)." |
| 3 | `accounts.google.com`: elegir cuenta. **Haz clic en la barra de direcciones** para que se vea la URL completa con el `client_id` | "Google OAuth consent for the WillyPost desktop client (client ID visible in the URL)." |
| 4 | Pantalla de consentimiento en inglés con **WillyPost** y los permisos de YouTube → marcar casillas → **Continue** | "Requested scopes: youtube.upload and youtube.readonly." |
| 5 | Vuelve a WillyPost: canal conectado con su **nombre** | "youtube.readonly: channels.list (mine) shows which channel is connected." |
| 6 | **Crear publicación** → **Reel / Vídeo** → vídeo vertical → YouTube → título, visibilidad → **Publicar ahora** | "youtube.upload: the user's scheduled Short is uploaded with videos.insert." |
| 7 | **Ver publicación** → el Short en YouTube Studio / YouTube | "The video on the user's channel." |
| 8 | Redes → **Conectar Google Business Profile** → cuenta → consentimiento en inglés con el permiso de Business Profile → **Continue** (URL con `client_id` visible) | "Requested scope: business.manage." |
| 9 | Diálogo con la lista de **fichas** → marcar → **Conectar** | "business.manage: list the user's business locations to choose one." |
| 10 | **Crear publicación** → **Post** → Google Business Profile → texto, foto, botón «Más información» → **Publicar ahora** | "business.manage: create a local post on the chosen profile." |
| 11 | La novedad en la ficha de Google (Maps o búsqueda) | "The update is live on Google Business Profile." |
| 12 | `myaccount.google.com/connections` → WillyPost → «Delete all connections» (opcional, al final) | "Users can revoke access at any time in their Google Account." |

Si Business Profile aún no tiene acceso a la API (google.md §6) cuando grabes, graba primero la parte de
YouTube (planos 1–7 y 12) y añade la de Business Profile cuando la aprueben (Google acepta actualizar el
vídeo en la misma solicitud).

El mismo vídeo sirve para el **formulario de cuota de YouTube** (google.md §7).

---

## 4. LinkedIn

No hace falta vídeo: sus productos son de autoservicio.
