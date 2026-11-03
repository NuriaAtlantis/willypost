# Kit de solicitudes: que Meta, TikTok, Google y LinkedIn aprueben WillyPost

Objetivo: que los alumnos conecten sus redes pulsando **«Conectar»** y aceptando, sin crear apps de
desarrollador. Para eso hace falta **una app por plataforma**, a nombre de **Diving With Us SL**, aprobada
por cada red. Este kit tiene todo lo que se puede dejar preparado; lo que solo puedes hacer tú está marcado
con 👤.

> Preparado el 2 de noviembre de 2026. Los paneles de las redes cambian a menudo: si un botón no se llama
> exactamente como pone aquí, busca el nombre en inglés que va entre paréntesis. Donde no estamos seguros
> de una etiqueta lo decimos.

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `LEEME.md` | Este archivo: orden, plazos, qué haces tú y lista de comprobación. |
| `meta.md` | Paso a paso de Meta (Facebook, Instagram, Threads) y la verificación del negocio. |
| `tiktok.md` | Paso a paso de TikTok (app, verificación del dominio, revisión y auditoría de publicación directa). |
| `google.md` | Paso a paso de Google (YouTube y Google Business Profile): proyecto, verificación, cuota, acceso a GBP. |
| `linkedin.md` | Paso a paso de LinkedIn (sin revisión, solo productos de autoservicio). |
| `textos-en.md` | Textos en inglés listos para copiar y pegar en cada formulario. |
| `guiones-video.md` | Guiones plano a plano de cada vídeo de demostración que piden. |
| `icono-1024.png` | Icono de la app, 1024 × 1024 px, cuadrado (las plataformas redondean las esquinas). |

## Datos que se repiten en todos los formularios

| Dato | Valor |
|---|---|
| Nombre de la app | **WillyPost** |
| Titular | **Diving With Us SL** — CIF `B76160340` — domicilio `Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas` |
| Web (página de inicio) | `https://willypost.com/` |
| Política de privacidad | `https://willypost.com/privacidad.html` |
| Condiciones del servicio | `https://willypost.com/terminos.html` |
| Eliminación de datos (instrucciones) | `https://willypost.com/borrar-datos.html` |
| Página en inglés para revisores | `https://willypost.com/en.html` |
| Dirección de retorno (Meta, TikTok, LinkedIn) | `https://willypost.com/callback.html` |
| Google | Cliente OAuth de tipo **App de escritorio** (no lleva dirección de retorno) |
| Email de contacto | `nuria.olive@gmail.com` |
| Icono | `solicitudes/icono-1024.png` |
| Descarga del programa (para revisores) | `https://github.com/NuriaAtlantis/willypost/archive/refs/heads/main.zip` |

`B76160340` y `Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas` están sin rellenar a propósito, también en la web
(`docs/privacidad.html`, `docs/terminos.html`, `docs/en.html`): hay que poner los datos exactos de la
escritura antes de publicar la web y antes de enviar nada.

## Orden y plazos (orientativos)

Los plazos son los habituales que publican otros desarrolladores; cada plataforma va a su ritmo y puede
pedir cambios y volver a revisar.

### Fase 0 — Dominio y web (día 1, 1–2 horas + espera de DNS)
1. 👤 Compra **willypost.com** en **Hostinger**.
2. 👤 En el **hPanel de Hostinger → Dominios → willypost.com → DNS / Nameservers → Registros DNS**:
   - Borra el registro **A** de `@` que Hostinger pone por defecto (apunta a su página de aparcamiento).
   - Añade 4 registros **A** para `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (GitHub Pages).
   - (Opcional, IPv6) 4 registros **AAAA** para `@`: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`.
   - Registro **CNAME** `www` → `nuriaatlantis.github.io` (si ya existe un CNAME `www`, cámbialo).
   - Los subdominios `auth` y `media` los crea la guía del servidor de conexión (`broker/LEEME.md`): **no borres sus registros**.
3. 👤 En GitHub → repositorio `willypost` → **Settings → Pages**: en **Custom domain** escribe `willypost.com` y **Save** (el archivo `docs/CNAME` ya está preparado). Cuando GitHub lo permita (puede tardar hasta 24 h), marca **Enforce HTTPS**.
4. 👤 (Recomendado) GitHub → tu foto → **Settings → Pages → Add a domain**: verifica `willypost.com` con el registro TXT que te dé GitHub (se añade en el mismo hPanel → DNS). Evita que otra cuenta de GitHub pueda usar tu dominio.
5. 👤 **Google Search Console** (https://search.google.com/search-console) → **Añadir propiedad → Dominio** → `willypost.com`. Te da un registro **TXT** (`google-site-verification=…`): añádelo en hPanel → DNS (tipo TXT, nombre `@`) y pulsa **Verificar**. Hazlo con la **misma cuenta de Google** que será propietaria del proyecto de Google Cloud.
6. 👤 Monta el servidor de conexión (`auth.willypost.com` y `media.willypost.com`) siguiendo `broker/LEEME.md`. Las claves secretas que consigas en cada plataforma se pegan en su **`config.php`** (fuera de `public_html`), con los nombres de `CENTRAL.md`.
7. Comprueba que `https://willypost.com/`, `/privacidad.html`, `/terminos.html`, `/borrar-datos.html`, `/en.html` y `/callback.html` se abren con candado.

### Fase 1 — Crear las cuentas y las apps (días 1–3; arranca ya lo que tarda)
- 👤 **Meta: verificación del negocio Diving With Us SL** (lo que más tarda: de 2 días a 2 semanas). Ver `meta.md` §1.
- 👤 **Google Business Profile: solicitud de acceso a la API** (1–2 semanas). Ver `google.md` §6. Necesita una ficha verificada y activa desde hace más de 60 días.
- 👤 Crear las apps: `meta.md` §2–5, `tiktok.md` §1–4, `google.md` §1–5, `linkedin.md` (LinkedIn queda funcionando el mismo día).

### Fase 2 — Probar con tus cuentas y grabar los vídeos (días 3–7)
- Cuando el código del modo central esté en la versión que descargan los alumnos, conecta **tus propias cuentas** con la app central de cada red (como administradora de la app ya tienes todos los permisos, aunque no estén aprobados) y haz **al menos una publicación de prueba en cada red**. Meta exige que cada permiso haya tenido al menos una llamada correcta en los últimos 30 días antes de pedir la revisión.
- 👤 Graba los vídeos siguiendo `guiones-video.md`.

### Fase 3 — Enviar a revisión (día 7 en adelante)
| Plataforma | Qué se envía | Plazo habitual |
|---|---|---|
| Meta | App Review de los 9 permisos (+ `business_management`) | 1–3 semanas; a veces piden cambios |
| TikTok | Revisión de la app; después, auditoría de publicación directa | días a varias semanas cada una |
| Google | Verificación de marca + de permisos sensibles; formulario de cuota de YouTube | 1–6 semanas |
| LinkedIn | Nada (autoservicio) | inmediato |

### Fase 4 — Cuando aprueben
- Meta: comprobar que la app está **Publicada** (*Live*).
- TikTok: la app pasa a producción; tras la auditoría, la publicación directa deja de ser privada.
- Google: la pantalla de consentimiento deja de avisar de «app no verificada».
- Avisa a los alumnos: «actualiza WillyPost y pulsa Conectar».

## Qué haces tú y qué está preparado

| Tú (👤) | Preparado en el repositorio |
|---|---|
| Comprar el dominio y tocar el DNS en Hostinger | `docs/CNAME`, `docs/config.js` apuntando a willypost.com |
| Iniciar sesión en cada panel y aceptar sus condiciones | Paso a paso por plataforma (`meta.md`, `tiktok.md`, `google.md`, `linkedin.md`) |
| Subir los documentos de Diving With Us SL (escrituras, CIF, recibo) | Web con privacidad, términos, borrado de datos y página en inglés |
| Grabar los vídeos | Guiones (`guiones-video.md`) |
| Pegar los textos y enviar | Textos en inglés (`textos-en.md`) e icono (`icono-1024.png`) |
| Copiar los ID y claves al `config.php` del servidor de conexión | Lista de variables (`CENTRAL.md`, `broker/LEEME.md`) |
| Responder a los revisores | — |

**Nunca** pegues una clave secreta en un email, en un chat, en el repositorio ni en la web: solo en el
`config.php` del servidor (fuera de `public_html`). El **ID** de cada app sí es público.

## Dónde va cada ID y clave (config.php del servidor de conexión)

| Variable | De dónde sale |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | Meta → tu app → Configuración de la app → Básica |
| `META_CONFIG_ID` | Meta → Facebook Login para empresas → Configuraciones (ver `meta.md` §3) |
| `IG_APP_ID`, `IG_APP_SECRET` | Meta → caso de uso de Instagram → Configuración de la API con inicio de sesión de Instagram |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Meta → caso de uso de Threads → Configuración |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok → Manage apps → tu app → App details / Credentials |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn → tu app → pestaña Auth |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → Google Auth Platform → Clientes → cliente «App de escritorio» |

Una red sin sus variables simplemente no aparece en modo central (los alumnos siguen pudiendo usar su
propia app), así que puedes ir activando redes una a una según te las aprueben.

## Lista de comprobación

**Antes de empezar**
- [ ] CIF y domicilio de Diving With Us SL puestos en la web (sustituir `B76160340` y `Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas`) y en estos textos
- [ ] willypost.com comprado en Hostinger
- [ ] DNS: 4 registros A + CNAME www → GitHub Pages; subdominios auth y media (broker)
- [ ] GitHub Pages con dominio propio y «Enforce HTTPS»
- [ ] Dominio verificado en Google Search Console (TXT en hPanel)
- [ ] Servidor de conexión funcionando: `https://auth.willypost.com/health` responde `{"ok":true,…}`
- [ ] Las 6 páginas públicas abren con candado

**Meta**
- [ ] Portfolio de negocio «Diving With Us SL» creado y **verificado**
- [ ] App «WillyPost» creada en ese portfolio, con Facebook, Instagram y Threads configurados
- [ ] Icono, privacidad, términos, borrado de datos, categoría y email en Configuración básica
- [ ] Una publicación de prueba correcta en Facebook, Instagram y Threads (últimos 30 días)
- [ ] Un vídeo por permiso y textos pegados
- [ ] Enviado a revisión · [ ] Aprobado · [ ] App publicada (Live)

**TikTok**
- [ ] Organización «Diving With Us SL» en TikTok for Developers
- [ ] App con Login Kit + Content Posting API (publicación directa activada)
- [ ] Dominio willypost.com verificado (TXT en hPanel)
- [ ] La pantalla de publicación de WillyPost cumple las normas de TikTok (ver `tiktok.md` §0)
- [ ] Vídeos (máx. 5, 50 MB cada uno) y textos · [ ] Enviada · [ ] Aprobada · [ ] Auditoría de publicación directa aprobada

**Google**
- [ ] Proyecto «WillyPost» en Google Cloud, APIs activadas
- [ ] Marca (Branding) completa, dominio autorizado willypost.com
- [ ] Cliente «App de escritorio» creado; ID y secreto en el config.php
- [ ] Vídeo de demostración subido a YouTube como «No listado»
- [ ] Verificación enviada · [ ] Aprobada
- [ ] Formulario de cuota de YouTube enviado
- [ ] Formulario de acceso a la API de Business Profile enviado · [ ] Aprobado

**LinkedIn**
- [ ] Página de LinkedIn (WillyPost o Diving With Us SL) creada
- [ ] App creada y **verificada** por la Página
- [ ] Productos «Share on LinkedIn» y «Sign In with LinkedIn using OpenID Connect» añadidos
- [ ] Dirección de retorno pegada; ID y secreto en el config.php
