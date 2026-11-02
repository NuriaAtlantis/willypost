# Google (YouTube y Google Business Profile) — paso a paso

Resultado: un proyecto de Google Cloud **WillyPost** con:
- pantalla de consentimiento **verificada** (marca + permisos sensibles),
- un cliente OAuth de tipo **App de escritorio** (Google lo considera público: por eso puede ir en `/config`),
- más cuota de subidas de YouTube,
- acceso a la API de Google Business Profile.

Permisos que pide WillyPost (`server/providers/youtube.js` y `gbp.js`):

| Permiso | Para qué | Tipo |
|---|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | Subir los vídeos programados | sensible |
| `https://www.googleapis.com/auth/youtube.readonly` | Leer el nombre y el ID del canal (`channels.list?mine=true`) para enseñar qué canal está conectado | sensible |
| `https://www.googleapis.com/auth/business.manage` | Listar las fichas y publicar novedades | sensible |

> Nota para el equipo técnico: Google pide «el permiso más estrecho posible». `youtube.readonly` solo se
> usa para leer el nombre del canal. Si se pudiera quitar (por ejemplo, leyendo el canal de la respuesta
> de la subida), la verificación sería más sencilla. Mientras el código lo pida, hay que justificarlo
> (texto en `textos-en.md` §3.2).

En modo central, Google **no pasa por el servidor de conexión**: el canje se hace entre el ordenador del
alumno y Google (cliente de escritorio + PKCE, retorno a `http://localhost:4747/oauth/callback`).

⚠️ = etiqueta o paso que no hemos podido comprobar en pantalla. Google renombró en 2025 la «Pantalla de
consentimiento de OAuth» como **Google Auth Platform** (menús *Branding*, *Audience*, *Data Access*,
*Clients*, *Verification Center*). Si ves el menú antiguo, los campos son los mismos.

---

## 0. Requisito previo: dominio verificado en Search Console

Hecho en `LEEME.md` Fase 0 (registro TXT en el hPanel de Hostinger). Tiene que hacerlo **la misma cuenta
de Google** que es propietaria del proyecto (o un editor del proyecto). La portada `https://willypost.com/`
ya describe la app, enlaza la privacidad y los términos, y la privacidad incluye la frase de uso limitado
(*Limited Use*) y lo que pide YouTube.

## 1. Crear el proyecto

1. https://console.cloud.google.com → selector de proyectos (arriba) → **Proyecto nuevo** → nombre `WillyPost` → **Crear**.
2. **Panel** (*Dashboard*) → tarjeta **Información del proyecto**: apunta el **Número de proyecto** (*Project number*). Lo pide el formulario de Business Profile (§6).

## 2. Activar las APIs

**APIs y servicios → Biblioteca** → busca y **Habilitar**:
- **YouTube Data API v3**.
- Para Business Profile (se activan ya, pero tendrán cuota 0 hasta que Google apruebe §6): **My Business Account Management API**, **My Business Business Information API** y **Google My Business API** (la v4, para las publicaciones).

## 3. Google Auth Platform (pantalla de consentimiento)

1. Menú ☰ → **Google Auth Platform** → **Empezar** (*Get started*):
   - Nombre de la app: `WillyPost` (igual que en la web).
   - Email de asistencia al usuario: `nuria.olive@gmail.com`.
   - Público (*Audience*): **Externo** (*External*).
   - Información de contacto: `nuria.olive@gmail.com`.
   - Acepta la política de datos de usuario → **Crear**.
2. **Marca** (*Branding*):
   - Logotipo: opcional. Si lo subes (120 × 120 px, puedes reducir `icono-1024.png`), Google verifica la marca antes de mostrarlo.
   - Página principal: `https://willypost.com/`
   - Política de privacidad: `https://willypost.com/privacidad.html`
   - Condiciones del servicio: `https://willypost.com/terminos.html`
   - **Dominios autorizados**: `willypost.com`
   - Contacto del desarrollador: `nuria.olive@gmail.com`
   - **Guardar**.
3. **Acceso a datos** (*Data Access*) → **Añadir o quitar permisos** → pega a mano (abajo del todo, «Añadir permisos manualmente») los tres de la tabla → **Actualizar** → **Guardar**. Aparecerán en «Tus permisos sensibles».
4. **Público** (*Audience*) → **Usuarios de prueba** → añade tu Gmail y las cuentas con las que vayas a probar o grabar (máx. 100). En modo *Prueba*, las conexiones caducan a los 7 días: es normal.

## 4. Cliente OAuth «App de escritorio»

1. **Clientes** (*Clients*) → **Crear cliente** → Tipo de aplicación: **App de escritorio** (*Desktop app*) → nombre `WillyPost escritorio` → **Crear**.
2. Copia el **ID de cliente** → `GOOGLE_CLIENT_ID` y el **Secreto del cliente** → `GOOGLE_CLIENT_SECRET` (en el `config.php` del servidor de conexión, `broker/LEEME.md`). El tipo escritorio no lleva dirección de retorno: Google acepta `http://localhost` automáticamente.

## 5. Probar, grabar y pedir la verificación

1. Con el servidor de conexión ya sirviendo el ID de Google, conecta **YouTube** y **Google Business Profile** desde tu WillyPost (con un usuario de prueba). Sube un Short y publica una novedad (la novedad solo funcionará cuando Google apruebe §6; mientras, graba la parte de YouTube y deja GBP para después si hace falta).
2. Graba el vídeo de `guiones-video.md` §3 (pantalla de Google **en inglés**: selector de idioma abajo a la izquierda) y súbelo a YouTube como **No listado**.
3. **Público** → **Publicar app** (*Publish app*) → pasa a **En producción**. Como hay permisos sensibles, Google pide verificación.
4. **Centro de verificación** (*Verification Center*) → **Preparar verificación / Enviar** (⚠️):
   - Justificación de cada permiso: `textos-en.md` §3.2.
   - Enlace del vídeo de demostración (YouTube no listado).
   - Descripción de la app y de cómo usa los datos: `textos-en.md` §3.1.
   - **Enviar**. Google contesta por email (al de contacto); responde rápido a sus preguntas, porque si no, cierran la solicitud.
5. Plazos habituales: marca, 2–3 días laborables; permisos sensibles, de unos días a varias semanas.

## 6. Acceso a la API de Google Business Profile

1. Requisitos (de Google): una **ficha de Google Business Profile verificada** y **activa desde hace más de 60 días**, gestionada por la cuenta con la que pides el acceso; una web que coincida con la empresa.
   - Usa la ficha verificada de un negocio de Diving With Us SL, con la cuenta de Google que la gestiona. ⚠️ El formulario puede pedir un email del mismo dominio que la web de la ficha.
2. Formulario: https://support.google.com/business/contact/api_default → elige **Application for Basic API Access** (⚠️ nombre de la opción).
3. Rellena: empresa `Diving With Us SL`, web, email de contacto, **número de proyecto** (§1), y el uso: `textos-en.md` §3.3.
4. Google contesta por email (1–2 semanas). Para saber si ya está: **APIs y servicios → My Business Account Management API → Cuotas**: si el límite por minuto es **300** (y no 0), estás aprobada.

## 7. Más cuota de YouTube

Según la documentación vigente, `videos.insert` tiene **su propio límite de 100 subidas al día por
proyecto** (además de los 10.000 puntos diarios del resto de llamadas). Con muchos alumnos usando la app
central, se queda corto.

1. Formulario: **YouTube API Services – Audit and Quota Extension**: https://support.google.com/youtube/contact/yt_api_form
2. Incluye: número de proyecto, descripción de la app, enlace a la web, a la privacidad y al vídeo de demostración, y la estimación de uso: `textos-en.md` §3.4.
3. Google hace una **auditoría de cumplimiento** de las políticas de YouTube (enlace a las Condiciones de YouTube y a la Política de privacidad de Google en la privacidad, forma de revocar el acceso: ya está en la web). Puede tardar semanas.

## 8. Dónde pegar los datos

| Dato | Variable del `config.php` |
|---|---|
| ID de cliente (escritorio) | `GOOGLE_CLIENT_ID` |
| Secreto del cliente (escritorio) | `GOOGLE_CLIENT_SECRET` |
