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

## 1. Meta — un vídeo por permiso (9 vídeos)

Graba **tres sesiones largas** (Facebook, Instagram, Threads) y sácales los cortes de cada permiso; o graba
cada permiso por separado. Cada vídeo debe enseñar: inicio de sesión → pantalla de permisos (con el
nombre **WillyPost**) → el uso concreto de ese permiso.

### Sesión Facebook (base de los vídeos 1.1 a 1.5)
| # | Qué se ve | Rótulo |
|---|---|---|
| F1 | Plano 0 | (ver arriba) |
| F2 | **Redes** → tarjeta Facebook → clic en **Conectar Facebook** | "User clicks 'Conectar Facebook' (Connect Facebook)." |
| F3 | Facebook en inglés: *Continue as …*; pantalla con el nombre **WillyPost** y los permisos | "Facebook Login for Business: the user reviews WillyPost's permissions." |
| F4 | Elegir la Página de prueba (y el portfolio si aparece) → *Save/Continue* | "The user chooses which Page(s) WillyPost can access." |
| F5 | Página «Volviendo a WillyPost…» en `willypost.com/callback.html` (1 s) | "Redirect page on willypost.com forwards the code to the local app." |
| F6 | Diálogo **¿Qué quieres conectar de Facebook?** con la lista de Páginas → marcar → **Conectar** | "pages_show_list: WillyPost lists the user's Pages so they can pick one." |
| F7 | La Página conectada en Redes (nombre y foto) | "pages_read_engagement: Page name and picture shown as connected account." |
| F8 | **Crear publicación** → **Post** → ¿Dónde?: la Página → foto → texto → **Publicar ahora** | "pages_manage_posts: the user creates a post and publishes it to the Page." |
| F9 | **Lista** → la publicación → **Ver publicación** → se abre en Facebook | "The post is live on the Facebook Page (permalink read with pages_read_engagement)." |
| F10 | **Crear publicación** → **Reel / Vídeo** → vídeo vertical → la Página → **Programar** para dentro de 2 min → esperar → ver el Reel en Facebook | "publish_video: the user schedules a Reel; WillyPost uploads it to the Page at that time." |
| F11 | (Para business_management) Repetir F2–F6 con una Página que esté **dentro de un portfolio de negocio**; en F3 se ve la elección del portfolio | "business_management: Pages owned by a business portfolio appear in the list only with this permission." |

**Cortes:**
- 1.1 `pages_show_list` = F1–F6 · 1.2 `pages_read_engagement` = F1–F7 + F9 · 1.3 `pages_manage_posts` = F1–F9 · 1.4 `publish_video` = F1–F6 + F10 · 1.5 `business_management` = F1 + F11 + F7.

### Sesión Instagram (vídeos 1.6 y 1.7)
| # | Qué se ve | Rótulo |
|---|---|---|
| I1 | Plano 0 | |
| I2 | Redes → **Conectar Instagram** | "User clicks 'Conectar Instagram' (Connect Instagram)." |
| I3 | `instagram.com` en inglés: login con la cuenta profesional de prueba → pantalla de **WillyPost** con permisos → **Allow** | "Instagram Login: the user grants WillyPost basic profile and content publishing access." |
| I4 | Vuelta por `willypost.com/callback.html` → cuenta conectada con usuario y foto | "instagram_business_basic: username and profile picture identify the connected account." |
| I5 | **Crear publicación** → **Carrusel** → 3 fotos → Instagram → texto → **Publicar ahora** | "instagram_business_content_publish: the user publishes a carousel." |
| I6 | **Reel / Vídeo** → vídeo vertical → Instagram → **Programar** (2 min) → ver el Reel | "Scheduled Reel published at the chosen time." |
| I7 | Abrir el perfil de Instagram con las publicaciones | "Content is live on the user's Instagram account." |

**Cortes:** 1.6 `instagram_business_basic` = I1–I4 · 1.7 `instagram_business_content_publish` = I1–I7.

### Sesión Threads (vídeos 1.8 y 1.9)
| # | Qué se ve | Rótulo |
|---|---|---|
| T1 | Plano 0 | |
| T2 | Redes → **Conectar Threads** | "User clicks 'Conectar Threads' (Connect Threads)." |
| T3 | `threads.com` en inglés: login → pantalla de **WillyPost** → **Allow** | "Threads authorization: the user grants WillyPost access." |
| T4 | Vuelta → perfil conectado con usuario y foto | "threads_basic: profile username and picture shown in WillyPost." |
| T5 | **Crear publicación** → **Post** → Threads → texto (y una foto) → **Publicar ahora** | "threads_content_publish: the user publishes a post to Threads." |
| T6 | **Ver publicación** → el post en Threads | "The post is live on Threads." |

**Cortes:** 1.8 `threads_basic` = T1–T4 · 1.9 `threads_content_publish` = T1–T6.

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
