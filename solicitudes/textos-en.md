# Textos en inglés, listos para pegar

Cada bloque `text` se copia tal cual en el formulario indicado. Antes de usarlos, sustituye
`[[CIF_DIVING]]` y `[[DOMICILIO_DIVING]]` por los datos reales de Diving With Us SL. Los textos de cada
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

### 1.1 Datos de la app
- **Display name:** `WillyPost`
- **Category:** Business and Pages
- **Privacy Policy URL:** `https://willypost.com/privacidad.html` (English summary: `https://willypost.com/en.html#privacy`)
- **Terms of Service URL:** `https://willypost.com/terminos.html`
- **Data deletion instructions URL:** `https://willypost.com/borrar-datos.html`

### 1.2 Uso de cada permiso (*Tell us how you're using this permission*)

**pages_show_list**
```text
WillyPost is a desktop scheduler that publishes posts to Facebook Pages the user manages. After the user clicks "Conectar Facebook" (Connect Facebook) in the Networks screen and approves Facebook Login for Business, WillyPost calls /me/accounts to list the Pages the user granted. The list is shown in a dialog ("¿Qué quieres conectar de Facebook?" — "What do you want to connect?") so the user can tick the Page(s) to schedule posts for. Without this permission the user cannot choose a Page and the app cannot work. We only read the Page id, name and picture, and store them on the user's own computer to label the connected account. The screencast shows the login, the Page list and the Page appearing as connected.
```

**pages_read_engagement**
```text
WillyPost needs pages_read_engagement to read basic data of the Page the user connects: the Page name, picture and the Page access token returned with /me/accounts, which is required to publish as the Page. After publishing, WillyPost also reads the permalink of the created post so the user can open it from the post detail ("Ver publicación" — "View post"). We do not read comments, insights or followers. The data is stored only on the user's computer. The screencast shows the connected Page with its name and picture and the "View post" link opening the published post on Facebook.
```

**pages_manage_posts**
```text
This is the core feature of WillyPost: publishing the posts the user scheduled to their Facebook Page. In "Crear publicación" (Create post) the user writes the text, attaches photos (single photo or multi-photo post), selects their Facebook Page under "¿Dónde?" (Where?) and either clicks "Publicar ahora" (Publish now) or schedules a date and time. At that time WillyPost calls the Page feed/photos endpoints with the Page access token to create the post. WillyPost only publishes content the user created and approved; it never posts automatically on its own. The screencast shows a post being created in WillyPost and then visible on the Facebook Page.
```

**publish_video**
```text
WillyPost lets users schedule videos and Reels for their Facebook Page. When the user attaches a vertical video in "Crear publicación", chooses "Reel / Vídeo" as the post type under "¿Qué vas a publicar?" (What are you posting?) and their Page as destination, WillyPost uploads the video with the Page video/Reels publishing endpoints (video_reels upload and finish) at the scheduled time. publish_video is required to upload video content to the Page. The screencast shows the user scheduling a Reel in WillyPost and the Reel published on the Facebook Page.
```

**business_management**
```text
Many of our users (small businesses and marketing freelancers) keep their Facebook Pages inside a Meta business portfolio. Without business_management, /me/accounts does not return those Pages, so the user cannot select them in WillyPost. We only use this permission so that business-owned Pages are listed during connection; we do not read or manage any other business asset (ad accounts, catalogs, people, etc.). The screencast shows a Page owned by a business portfolio appearing in WillyPost's Page selection list after login and being connected.
```

**instagram_business_basic**
```text
WillyPost uses Instagram API with Instagram Login so users can schedule posts to their Instagram professional account without a Facebook Page. After the user clicks "Conectar Instagram" (Connect Instagram) and approves the Instagram authorization window, WillyPost reads the account id, username, account type and profile picture (GET /me) to show which account is connected and to know the publishing target. The data is stored only on the user's computer. The screencast shows the Instagram login, the consent screen and the connected account with its username and picture in WillyPost.
```

**instagram_business_content_publish**
```text
WillyPost publishes the photos, carousels, Reels and stories that the user schedules to their own Instagram professional account. In "Crear publicación" the user picks the post type, attaches the media, writes the caption, selects their Instagram account and clicks "Publicar ahora" or schedules it. At the scheduled time WillyPost creates the media container(s) with the user's media URL and calls media_publish, then shows the permalink in WillyPost. Only content created and approved by the user is published. The screencast shows a carousel and a Reel being scheduled in WillyPost and appearing on Instagram.
```

**threads_basic**
```text
WillyPost lets users schedule posts to their own Threads profile. After the user clicks "Conectar Threads" (Connect Threads) and approves the Threads authorization window, WillyPost reads the profile id, username and profile picture (GET /me) to display the connected profile and to know where to publish. It is also required by all Threads endpoints we call. The data is stored only on the user's computer. The screencast shows the Threads login and consent, and the connected profile in WillyPost.
```

**threads_content_publish**
```text
WillyPost publishes the text, image, video and carousel posts the user schedules to their Threads profile. In "Crear publicación" the user writes the text (up to 500 characters), optionally attaches media, selects their Threads profile and clicks "Publicar ahora" or schedules it. At that time WillyPost creates the Threads media container, waits until it is ready and calls threads_publish, then shows the permalink. Only user-created content is published. The screencast shows a Threads post being scheduled in WillyPost and visible on Threads.
```

### 1.3 Instrucciones para el revisor (*Reviewer instructions / App verification details*)
```text
WillyPost is a desktop app (Windows/macOS) that runs locally and opens its interface in the browser at http://localhost:4747. There is no server-side account: the reviewer creates a local account during installation, so no test credentials are needed for WillyPost itself. The interface is in Spanish; the screencasts have English captions and an English overview is at https://willypost.com/en.html.

The complete flow for every permission is shown in the screencasts, in case installing a desktop app is not possible in your test environment.

To test it yourself on Windows 10/11:
1. Download https://github.com/NuriaAtlantis/willypost/archive/refs/heads/main.zip and extract it (right-click > Extract All).
2. Double-click "Instalar WillyPost" (Install WillyPost). If SmartScreen appears, click "More info" > "Run anyway". It installs in 2-3 minutes without admin rights and opens http://localhost:4747.
3. Create a local account ("Crear mi cuenta"): any name, email and password (they never leave the computer).
4. Go to "Redes" (Networks) in the left menu.
5. Facebook: click "Conectar Facebook" > log in with your Meta test user that manages a test Page > choose the Page > accept. Back in WillyPost, tick the Page and click "Conectar".
   Instagram: click "Conectar Instagram" > log in with an Instagram professional (business/creator) test account > "Allow".
   Threads: click "Conectar Threads" > log in > "Allow".
6. Click "+ Crear publicación" (top right). Under "¿Dónde?" tick the connected account, add an image or video under "Imágenes o vídeo", write a text under "Texto" and click "Publicar ahora" (Publish now). Or pick a date/time under "¿Cuándo?" and click "Programar" (Schedule).
7. Open the post in "Lista" (List) and click "Ver publicación" (View post) to open it on Facebook/Instagram/Threads.

The browser returns from Meta to https://willypost.com/callback.html, a static page that forwards the authorization code to http://localhost:4747 on the same computer. The code is exchanged through our connection service auth.willypost.com, which only adds the app secret and stores nothing.

Contact: nuria.olive@gmail.com
```

### 1.4 Tratamiento de datos (*Data handling questions*) y verificación de acceso

**Responsable de los datos / entidad que responde**
```text
Diving With Us SL (Spain), tax ID [[CIF_DIVING]], [[DOMICILIO_DIVING]]. Contact: nuria.olive@gmail.com.
```

**¿Hay encargados o proveedores con acceso a los datos de la plataforma? (*Data processors / service providers*)**
```text
Platform Data is stored only on each user's own computer, never on our servers. Two providers are involved in transit only: (1) Hostinger, which hosts our stateless connection service auth.willypost.com; it receives OAuth authorization codes and tokens only during the code-for-token exchange to add the app secret, with no database and no logging of codes, tokens or request bodies; (2) GitHub Pages, which hosts the static website and the redirect page willypost.com/callback.html (the authorization code is in the URL for an instant, the page forwards it to localhost and stores nothing). Media files are served to Meta directly from the user's computer through a temporary Cloudflare Quick Tunnel; this carries the user's own images/videos, not Platform Data.
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
Diving With Us SL owns and operates the WillyPost apps on behalf of the users of WillyPost, a free non-profit desktop social media scheduler for the students of the Willy SEO Academy (small businesses and freelancers). Users connect their own Facebook Pages, Instagram professional accounts and Threads profiles to schedule and publish their own content. We do not access any data beyond what is needed to list the user's Pages/accounts and publish the posts they schedule, and we store no Platform Data on our servers: all data stays on the user's computer.
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
Company: Diving With Us SL ([[CIF_DIVING]]). Project number: [[NUMERO_PROYECTO_GOOGLE]].
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
