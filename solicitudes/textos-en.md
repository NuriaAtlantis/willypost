# Textos en inglés, listos para pegar

Cada bloque `text` se copia tal cual en el formulario indicado. Antes de usarlos, sustituye
`B76160340` y `Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas` por los datos reales de Diving With Us SL. Los textos de cada
permiso son distintos a propósito (Meta y Google rechazan textos repetidos).

Nombres de pantalla de WillyPost que salen en los textos (la interfaz está en español):
*Redes* = Networks · *Conectar …* = Connect … · *Crear publicación* = Create post · *¿Dónde?* = Where? ·
*Imágenes o vídeo* = Images or video · *Texto* = Text · *¿Cuándo?* = When? · *Publicar ahora* = Publish now ·
*Programar* = Schedule · *Calendario* = Calendar · *Lista* = List · *Ver publicación* = View post.

---

## 0. Descripción general (sirve para todas)

**Corta (≤ 120 caracteres):**
```text
Free, non-profit desktop app that schedules and publishes posts to the user's own social media accounts.
```

**Larga:**
```text
WillyPost is a free, non-profit social media scheduler for the students of the Willy SEO Academy (small businesses, freelancers and local-marketing professionals). It is a desktop application for Windows and macOS that runs entirely on the user's own computer: the user writes a post, attaches images or a video, chooses which of their own accounts it goes to (Facebook Pages, Instagram professional accounts, Threads, TikTok, YouTube, Google Business Profile, LinkedIn) and when, and WillyPost publishes it at that time. It only publishes content the user has created and scheduled; it does not read messages, follow, like or comment, and it has no ads or analytics. All user data (posts, media, tokens) is stored only on the user's computer. The platform apps are owned by Diving With Us SL, which also runs a stateless connection service (auth.willypost.com) that adds the app secret during the OAuth code-for-token exchange and stores nothing. The program is open source (MIT + Commons Clause, cannot be sold): https://github.com/NuriaAtlantis/willypost. Website: https://willypost.com/ · English overview: https://willypost.com/en.html
```

---

## 1. Meta

App **WillyPost** (`1642727863583670`). Se piden **8 permisos**; no se pide `publish_video` (ya no existe) ni
`instagram_business_basic` / `instagram_business_content_publish` (WillyPost no los usa). Instagram se conecta
con Facebook Login for Business (configuración *WillyPost Instagram*), por eso sus textos hablan de la Página vinculada.

### 1.1 Datos de la app (ya puestos; solo para comprobar)
- **Display name:** `WillyPost`
- **App domains:** `willypost.com`
- **Category:** Business and pages (*Negocios y páginas*)
- **Privacy Policy URL:** `https://willypost.com/privacidad.html` (English summary: `https://willypost.com/en.html#privacy`)
- **Terms of Service URL:** `https://willypost.com/terminos.html`
- **Data deletion instructions URL:** `https://willypost.com/borrar-datos.html`

### 1.2 Uso de cada permiso (*Tell us how you're using this permission*)

#### Caso de uso «Administrar todos los aspectos de tu página»

**pages_show_list**
```text
WillyPost is a free desktop app that schedules and publishes posts to the Facebook Pages a user manages. In the "Redes" (Networks) screen the user clicks "Conectar Facebook" (Connect Facebook) and completes Facebook Login for Business, where they choose which Pages WillyPost may use. WillyPost then calls GET /me/accounts to list those Pages. When more than one Page is returned, WillyPost shows the dialog "¿Qué quieres conectar de Facebook?" (What do you want to connect from Facebook?) and the user ticks the Page(s) they want to schedule posts for. Without pages_show_list WillyPost cannot list the user's Pages, so the user cannot choose where to publish. We read only each Page's id, name, username and picture, and store them only on the user's own computer to label the connected account. The screencast shows the login, the Page list in WillyPost and the Page appearing as connected.
```

**pages_read_engagement**
```text
WillyPost uses pages_read_engagement to read the Page data it needs to publish on the user's behalf: the Page access token, name and picture returned by /me/accounts (the Page access token is required to publish as the Page), and, after a post is published, the post's permalink_url, so the user can open it from the post detail in WillyPost with "Ver publicación" (View post). We do not read comments, reactions, insights or followers. This data is stored only on the user's computer. The screencast shows the connected Page with its name and picture in the Networks screen, and the "View post" link opening the published post on Facebook.
```

**pages_manage_posts**
```text
Publishing to the user's Facebook Page is WillyPost's core feature. In "Crear publicación" (Create post) the user picks the type under "¿Qué vas a publicar?" (What are you posting?): a post (text, one or several photos, or a video) or a Reel. They attach the media under "Imágenes o vídeo" (Images or video), write the text, tick their Page under "¿Dónde?" (Where?) and click "Publicar ahora" (Publish now), or pick a date and time under "¿Cuándo?" (When?) and click "Programar" (Schedule). At that time WillyPost publishes with the Page access token through /{page-id}/feed, /{page-id}/photos, /{page-id}/videos or /{page-id}/video_reels (videos and Reels are published with this permission). WillyPost only publishes content the user created and explicitly scheduled; it never posts on its own. The screencast shows a photo post published immediately and a Reel scheduled and then live on the Page.
```

**business_management**
```text
Our users are small businesses and marketing freelancers, and their Facebook Pages usually belong to a Meta business portfolio. In Facebook Login for Business the user can grant access to Pages owned by a business portfolio, but without business_management /me/accounts does not return those Pages, so the user could not select them in WillyPost. We use this permission only so that business-owned Pages are listed when the user connects Facebook (and, in the Instagram connection, the business-owned Page linked to their Instagram account). We do not read or manage any other business asset: no ad accounts, catalogs, people or business settings. The screencast shows a Page owned by a business portfolio being selected in the Facebook dialog and then appearing as connected in WillyPost.
```

#### Caso de uso «Administrar mensajes y contenido en Instagram»

**instagram_basic**
```text
WillyPost lets users schedule posts to their Instagram professional account, which is linked to a Facebook Page they manage. In the "Redes" (Networks) screen the user clicks "Conectar Instagram" (Connect Instagram); Facebook Login for Business opens and the user selects their Instagram account and its Page. WillyPost then calls GET /me/accounts with the field instagram_business_account{id,username,name,profile_picture_url} to find the Instagram account linked to each granted Page. instagram_basic is required to read that id, username and profile picture: WillyPost shows them as the connected account and uses the id as the publishing target. After publishing, it reads the media permalink so the user can open the post with "Ver publicación" (View post). Data is stored only on the user's computer. The screencast shows the login and the connected Instagram account with its username and picture.
```

**instagram_content_publish**
```text
WillyPost publishes the photos, carousels, Reels and stories that the user schedules to their own Instagram professional account. In "Crear publicación" (Create post) the user picks the type under "¿Qué vas a publicar?" (What are you posting?), attaches the media, writes the caption, ticks their Instagram account under "¿Dónde?" (Where?) and clicks "Publicar ahora" (Publish now) or schedules a date and time with "Programar" (Schedule). At that time WillyPost calls POST /{ig-user-id}/media on graph.facebook.com with the linked Page's access token to create the media container(s), waits until status_code is FINISHED and calls /{ig-user-id}/media_publish. Only content the user created and approved is published. The screencast shows a carousel published immediately and a Reel scheduled and then live on Instagram.
```

Solo si el formulario vuelve a pedir estos tres permisos dentro del caso de uso de Instagram (son de la configuración *WillyPost Instagram*), usa estas versiones, distintas de las de Páginas:

**pages_show_list (versión Instagram)**
```text
In WillyPost, Instagram professional accounts are connected through Facebook Login for Business, because we use the Instagram API through the Facebook Page linked to the account. When the user clicks "Conectar Instagram" (Connect Instagram) and selects their Instagram account and its Page, WillyPost calls GET /me/accounts to get the Pages the user granted and, for each one, its linked instagram_business_account. pages_show_list is required for this call; without it WillyPost cannot find the Instagram account to publish to. In the Instagram connection the Pages are not shown or used for anything else.
```

**pages_read_engagement (versión Instagram)**
```text
To publish to Instagram through the Facebook Page linked to the user's Instagram professional account, WillyPost needs that Page's access token, which /me/accounts returns only with pages_read_engagement. WillyPost stores this token only on the user's computer and uses it exclusively for the Instagram content publishing calls (media and media_publish) of the account the user connected with "Conectar Instagram" (Connect Instagram). We do not read the Page's posts, comments or insights.
```

**business_management (versión Instagram)**
```text
Many users' Instagram professional accounts are linked to a Facebook Page that belongs to a Meta business portfolio. Without business_management, /me/accounts does not return those business-owned Pages, so their linked Instagram account cannot be found when the user clicks "Conectar Instagram" (Connect Instagram). We use this permission only to list those Pages and their Instagram account during the connection; we do not access ad accounts, catalogs, people or any other business asset.
```

#### Caso de uso «Acceder a la API de Threads»

**threads_basic**
```text
WillyPost lets users schedule posts to their own Threads profile. In the "Redes" (Networks) screen the user clicks "Conectar Threads" (Connect Threads) and approves the Threads authorization window. WillyPost then calls GET /me to read the profile id, username and profile picture, which it shows as the connected profile and uses as the publishing target; threads_basic is also required by every other Threads endpoint we call. After publishing, WillyPost reads the post permalink so the user can open it with "Ver publicación" (View post). Data is stored only on the user's computer. The screencast shows the Threads authorization and the connected profile in WillyPost.
```

**threads_content_publish**
```text
WillyPost publishes the text, image, video and carousel posts the user schedules to their Threads profile. In "Crear publicación" (Create post) the user writes the text (up to 500 characters), optionally attaches images or a video, ticks their Threads profile under "¿Dónde?" (Where?) and clicks "Publicar ahora" (Publish now) or schedules it with "Programar" (Schedule). At that time WillyPost creates the Threads media container (POST /{threads-user-id}/threads), waits until it is ready and calls /{threads-user-id}/threads_publish. Only content the user created and approved is published. The screencast shows a Threads post with a photo published from WillyPost and then visible on Threads.
```

### 1.3 Instrucciones para el revisor (*Reviewer instructions / App verification details*)
```text
WillyPost is a free, non-profit desktop app (Windows 10/11 and macOS) that lets small businesses schedule posts to their own social media accounts. It runs on the user's computer and opens its interface in the browser at http://localhost:4747. The interface is in Spanish; the screencasts have English captions, and an English overview is at https://willypost.com/en.html.

Test credentials: the login details of a Facebook account that manages a test Page with a linked Instagram professional account, and of its Threads profile, are provided in the test credentials fields of this submission form. WillyPost itself needs no credentials: the account is created locally during setup.

How to install and test on Windows:
1. Open https://willypost.com/ and click "Descargar" (Download). A ZIP file (willypost-main.zip) is downloaded.
2. Right-click the ZIP > "Extract All..." > "Extract", and open the extracted folder.
3. Double-click "Instalar WillyPost" (Install WillyPost). If Windows shows "Windows protected your PC", click "More info" > "Run anyway". The installer needs no admin rights, takes 2-3 minutes and opens WillyPost in the browser at http://localhost:4747.
4. Create a local account with "Crear mi cuenta" (Create my account): any name, email and password. They never leave the computer.
5. In the left menu, click "Redes" (Networks).
6. Facebook: click "Conectar Facebook" (Connect Facebook) and log in with the test Facebook account. In the Facebook Login for Business window, select the test Page and continue. Back in WillyPost, if the dialog "¿Qué quieres conectar de Facebook?" (What do you want to connect?) appears, tick the Page and click "Conectar" (Connect).
7. Instagram: click "Conectar Instagram" (Connect Instagram). A Facebook Login for Business window opens, because Instagram is connected through the Facebook Page linked to the Instagram professional account. Select the Instagram account and its Page and continue.
8. Threads: click "Conectar Threads" (Connect Threads), log in with the Threads profile and click "Allow".
9. Click "+ Crear publicación" (Create post). Under "¿Qué vas a publicar?" (What are you posting?) choose "Post", "Carrusel" (Carousel) or "Reel / Vídeo"; under "¿Dónde?" (Where?) tick one or more connected accounts; add an image or video under "Imágenes o vídeo" (Images or video); write the text; then click "Publicar ahora" (Publish now), or pick a date and time under "¿Cuándo?" (When?) and click "Programar" (Schedule). WillyPost publishes in the background at that time while the computer is on.
10. Open "Lista" (List), open the post and click "Ver publicación" (View post) to see it on Facebook, Instagram or Threads.

If installing a desktop app is not possible in your test environment, the screencasts show the complete flow for every permission.

How login works: Meta redirects to https://willypost.com/callback.html, a static page that forwards the authorization code to WillyPost on the same computer (http://localhost:4747). The code is exchanged for a token through our connection service https://auth.willypost.com, which only adds the app secret and stores nothing. Tokens and posts are stored only on the user's computer.

Contact: nuria.olive@gmail.com
```

### 1.4 Tratamiento de datos (*Data handling questions*) y verificación de acceso

**Responsable de los datos / entidad que responde**
```text
Diving With Us SL (Spain), tax ID B76160340, Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas. Contact: nuria.olive@gmail.com.
```

**¿Hay encargados o proveedores con acceso a los datos de la plataforma? (*Data processors / service providers*)**
```text
Platform Data is stored only on each user's own computer, never on our servers. Two providers are involved in transit only: (1) Hostinger, which hosts our stateless connection service auth.willypost.com; it receives OAuth authorization codes and tokens only during the code-for-token exchange to add the app secret, with no database and no logging of codes, tokens or request bodies; (2) GitHub Pages, which hosts the static website and the redirect page willypost.com/callback.html (the authorization code is in the URL for an instant; the page forwards it to localhost and stores nothing). Media files are served to Meta directly from the user's computer through a temporary Cloudflare Quick Tunnel; this carries the user's own images and videos, not Platform Data.
```
(Si el formulario pide el nombre legal de Hostinger, cópialo de la factura de Hostinger de Diving With Us SL.)

**¿En qué países se tratan?**
```text
On each user's own computer (mostly Spain). The connection service runs on Hostinger web hosting contracted by Diving With Us SL; it keeps no data.
```

**Solicitudes de autoridades públicas**
```text
We hold no Platform Data on our servers, so we have nothing to disclose. If we ever received a request, we would verify its legality, challenge it if it were unlawful or overbroad, disclose only the minimum required by law, notify the user where allowed, and keep a record of the request. We have never received such a request.
```

**Verificación de acceso / proveedor de tecnología (si la piden)**
```text
Diving With Us SL (business portfolio "AtlantisLZT", already business-verified) owns and operates the WillyPost app on behalf of the users of WillyPost, a free, non-profit desktop social media scheduler for small businesses and freelancers, mainly students of the Willy SEO Academy. Users connect their own Facebook Pages, Instagram professional accounts linked to those Pages, and Threads profiles to schedule and publish their own content. We access no data beyond what is needed to list the user's Pages and accounts and to publish the posts they schedule, and we store no Platform Data on our servers: all data stays on the user's computer.
```

---

## 2. TikTok

### 2.1 Descripción (≤ 120 caracteres)
```text
Free, non-profit desktop scheduler: users post videos to their own TikTok account or send them to their inbox.
```

### 2.2 Cómo se usa cada producto y permiso
```text
WillyPost is a free, non-profit desktop app (Windows/macOS) that lets small businesses and freelancers (students of the Willy SEO Academy) schedule posts to their own social media accounts. It is publicly downloadable from https://willypost.com/ and open source.

Login Kit / user.info.basic: in WillyPost's Networks screen the user clicks "Conectar TikTok" (Connect TikTok). The TikTok authorization page opens; after the user approves, TikTok redirects to https://willypost.com/callback.html, which forwards the code to the WillyPost app on the user's computer. WillyPost reads the user's open_id, display name and avatar to show which TikTok account is connected and, on the posting screen, which account will receive the post.

Content Posting API / video.upload: when preparing a post, the user can choose "send to your TikTok inbox". At the time the user scheduled, WillyPost uploads the video (FILE_UPLOAD) to the user's TikTok inbox; the user receives a TikTok notification and finishes editing and posting in the TikTok app.

Content Posting API / video.publish: the user can instead choose "post directly". On the posting screen WillyPost queries creator_info, shows the creator's nickname, lets the user pick the privacy level from the allowed options (no default), the comment/duet/stitch settings (off by default, disabled if the creator disabled them), the commercial content disclosure and shows the Music Usage Confirmation declaration. When the user confirms, the post is saved with exactly those choices and published at the scheduled time; WillyPost then polls the publish status and shows the result. WillyPost never posts content the user has not created and explicitly confirmed, and adds no watermarks.

Data: tokens and post data are stored only on the user's computer. Photos are served to TikTok from our verified domain media.willypost.com, which passes them through in transit without storing them.
```

### 2.3 Auditoría de publicación directa (*Content Posting API audit*)
Respuestas típicas del formulario (⚠️ las preguntas exactas pueden cambiar; adapta el texto que corresponda):

- **What does your app do / who are your users?**
```text
WillyPost is a free, non-profit, publicly downloadable desktop social media scheduler (https://willypost.com/) for small businesses, freelancers and marketing professionals, mainly students of the Willy SEO Academy in Spain. Users create their own posts and publish them to their own accounts on several networks, including TikTok.
```
- **How will users post to TikTok?**
```text
From WillyPost's "Create post" screen, the user selects their connected TikTok account, attaches a video, writes the caption and chooses "post directly". The screen shows the creator's nickname from creator_info, a privacy dropdown with only the allowed options and no default value, Allow comment/duet/stitch checkboxes unchecked by default, the commercial content disclosure toggle with "Your brand"/"Branded content" and the Music Usage Confirmation (and Branded Content Policy when applicable) before the confirm button. The post is published at the time the user chose, with exactly the settings the user selected, and WillyPost shows the publish status.
```
- **Expected volume**
```text
Each user posts a few videos per week to their own account. We expect up to [[N_USUARIOS]] creators in the first year; WillyPost also enforces its own limit of 5 feed posts per account per day.
```
(Sustituye `[[N_USUARIOS]]` por una estimación realista de alumnos que usarán TikTok.)

---

## 3. Google

### 3.1 Descripción de la app y uso de los datos (Centro de verificación)
```text
WillyPost is a free, non-profit desktop app (Windows/macOS) that lets small businesses and freelancers schedule posts to their own social media accounts, including YouTube Shorts and Google Business Profile local posts. It runs entirely on the user's computer and uses a Desktop OAuth client with PKCE; the redirect goes to http://localhost on the user's own machine and the token exchange happens directly between the user's computer and Google (no server of ours is involved). Google user data (OAuth tokens, channel name and id, list of business locations) is stored only on the user's computer and used only to upload the user's own videos and publish the user's own local posts at the time they schedule. It is not transferred to anyone, not used for ads, not read by humans and not used to train AI models. Homepage: https://willypost.com/ · Privacy policy: https://willypost.com/privacidad.html (English summary: https://willypost.com/en.html#google).
```

### 3.2 Justificación de cada permiso

**youtube.upload**
```text
WillyPost's main YouTube feature is uploading the vertical videos (Shorts) that the user schedules. In "Create post" the user attaches a video, writes the title and description, chooses the visibility (public, unlisted or private), selects their YouTube channel and a date/time. At that time WillyPost calls videos.insert with a resumable upload. youtube.upload is the narrowest scope that allows uploading videos; we do not need to edit, delete or manage existing videos, so broader scopes like youtube or youtube.force-ssl are not requested.
```

**youtube.readonly**
```text
After the user connects YouTube, WillyPost calls channels.list?part=snippet&mine=true once to read the channel id, title and thumbnail. This is shown in the Networks screen so the user can see which channel (or Brand Account) is connected before scheduling uploads. youtube.upload alone does not allow channels.list. We do not read any other YouTube data (no videos, comments, analytics or subscriptions).
```

**business.manage**
```text
WillyPost lets local businesses publish "local posts" (updates with text, an optional photo and an optional call-to-action button) to their Google Business Profile at the time they schedule. After connecting, WillyPost lists the user's accounts (Account Management API) and locations (Business Information API) so the user can choose which business profile to connect, and then creates local posts with accounts.locations.localPosts.create. business.manage is the only scope that grants these APIs. We do not edit business information, reviews or other data.
```

### 3.3 Formulario de acceso a la API de Business Profile
```text
Company: Diving With Us SL (B76160340). Project number: [[NUMERO_PROYECTO_GOOGLE]].
Use case: WillyPost (https://willypost.com/) is a free, non-profit desktop social media scheduler for small businesses and freelancers, students of the Willy SEO Academy. Business owners connect their own Google Business Profile with OAuth (scope business.manage) and schedule local posts (text, one photo, optional call-to-action button) that WillyPost publishes at the chosen time via accounts.locations.localPosts. We only list the user's accounts/locations so they can choose one, and create local posts. We do not modify business information or reviews, and we store no data on our servers: everything stays on the user's computer. Expected usage: a few posts per location per week.
```

### 3.4 Formulario de cuota y auditoría de YouTube
```text
Project number: [[NUMERO_PROYECTO_GOOGLE]]. App: WillyPost (https://willypost.com/), a free, non-profit desktop social media scheduler (Windows/macOS) for small businesses and freelancers. It uses YouTube Data API v3 only to (1) read the connected channel's title/id once per connection (channels.list mine=true) and (2) upload the user's own scheduled Shorts (videos.insert, resumable). All requests are made from the user's computer with their own OAuth token; no YouTube data is stored on our servers and nothing is shared with third parties. The privacy policy links the YouTube Terms of Service and Google Privacy Policy and explains how to revoke access (https://willypost.com/privacidad.html).
Quota request: each user uploads a few Shorts per week. With about [[N_USUARIOS]] users, we expect up to [[SUBIDAS_DIA]] videos.insert calls per day at peak, above the default 100 uploads per day per project. We request [[SUBIDAS_DIA]] videos.insert per day; other endpoints stay well within 10,000 units/day.
Demo video: [[ENLACE_VIDEO_DEMO]]
```

---

## 4. LinkedIn (si pide descripción)
```text
WillyPost is a free, non-profit desktop app that lets small businesses and freelancers schedule and publish posts to their own LinkedIn profile (Share on LinkedIn + Sign In with LinkedIn using OpenID Connect). Data stays on the user's computer.
```
