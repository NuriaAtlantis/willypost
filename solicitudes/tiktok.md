# TikTok — paso a paso

Resultado: una app **WillyPost** de la organización **Diving With Us SL** en TikTok for Developers, con
**Login Kit** y **Content Posting API** (publicación directa), aprobada y, después, **auditada** para
publicar en abierto.

Permisos (*scopes*) que pide WillyPost (`server/providers/tiktok.js`): `user.info.basic`, `video.upload`,
`video.publish`.

⚠️ = etiqueta o paso que no hemos podido comprobar en pantalla.

---

## 0. Antes de nada: la pantalla de publicación debe cumplir las normas de TikTok

TikTok **revisa la pantalla de WillyPost** donde se prepara la publicación (sus «Content Sharing
Guidelines»). Comprobado hoy en su documentación, para publicación directa exige:

- Mostrar **el nombre (y foto) de la cuenta** de TikTok que va a publicar, leído en ese momento de TikTok (`creator_info`).
- Un desplegable de **privacidad** con solo las opciones que TikTok devuelve, **sin ninguna elegida por defecto**: el usuario tiene que elegir.
- Casillas **Permitir comentarios / dúos / stitch** **desmarcadas por defecto** (y en gris si la cuenta las tiene desactivadas; en fotos, solo comentarios).
- Interruptor de **contenido comercial** (apagado por defecto) con «Tu marca» y «Contenido de marca», sus avisos («Contenido promocional» / «Colaboración pagada») y la regla de que el contenido de marca no puede ser privado.
- Antes del botón, la **declaración** «Al publicar, aceptas la Confirmación de uso de música de TikTok» (y la Política de contenido de marca si se marca).
- **Vista previa** del contenido, título editable, comprobar la **duración máxima** del vídeo, no añadir marcas de agua, no enviar nada hasta que el usuario lo confirme y avisar de que puede tardar unos minutos en aparecer.

**Hoy WillyPost no lo cumple del todo** (en `web/src/components/Composer.jsx` la privacidad no se elige y
las casillas son «Desactivar comentarios/dúos/stitch»). Esto lo tiene que cambiar el equipo técnico
**antes de grabar los vídeos** de TikTok. Con WillyPost programando para más tarde, enseña en el vídeo que
todas esas elecciones se hacen **al programar**, y que al llegar la hora se publica exactamente eso.

## 1. Cuenta de desarrollador y organización

1. Entra en https://developers.tiktok.com → **Log in** (con tu cuenta de TikTok o con email).
2. Crea la organización: tu foto (arriba a la derecha) → **My organizations** (⚠️ o *Manage organizations*) → **Create** → nombre **Diving With Us SL**. Así la app queda a nombre de la empresa y puedes añadir a otras personas.

## 2. Crear la app

1. Tu foto → **Manage apps** → **Connect an app** → elige como dueño la organización **Diving With Us SL**.
2. **App details** (⚠️ los nombres exactos pueden variar):

| Campo | Qué pones |
|---|---|
| App icon | `solicitudes/icono-1024.png` |
| App name | `WillyPost` |
| Category | ⚠️ *Business* / *Productivity* (la que más se parezca a «herramientas de redes sociales») |
| Description | `textos-en.md` §2.1 (máx. 120 caracteres) |
| Terms of Service URL | `https://willypost.com/terminos.html` |
| Privacy Policy URL | `https://willypost.com/privacidad.html` |
| Platforms | **Web** (Website URL `https://willypost.com/`). Si te deja, marca también **Desktop**. |

3. **Save**.

## 3. Productos y dirección de retorno

1. **Add products** → **Login Kit** y **Content Posting API**.
2. **Login Kit** → **Redirect URI** (⚠️ en la sección *Web*): `https://willypost.com/callback.html` (sin barra final, sin parámetros).
3. **Content Posting API** → activa **Direct Post** (⚠️ interruptor *Enable direct post*). Así aparece el permiso `video.publish`.
4. **Scopes**: comprueba que están `user.info.basic`, `video.upload` y `video.publish`. Quita cualquier otro.

> Nota técnica para el equipo: TikTok exige PKCE solo a las apps de **escritorio**, y las apps de
> escritorio solo aceptan direcciones de retorno `localhost`. Como el modo central usa
> `https://willypost.com/callback.html`, la app se registra como **Web**. La documentación de Login Kit for
> Web no menciona `code_verifier`; si TikTok rechaza el canje con ese campo, el servidor de conexión debe
> dejar de enviarlo para esta app. Probarlo en el Sandbox (§5).

## 4. Verificar el dominio willypost.com

TikTok solo descarga fotos (*PULL_FROM_URL*) de dominios verificados, y la revisión comprueba que la web es tuya.

1. En la app → **URL properties** (⚠️ o *Verify domains*) → **Add** → tipo **Domain** → `willypost.com`.
2. TikTok te da un registro **TXT** (algo como `tiktok-developers-site-verification=…`).
3. En el **hPanel de Hostinger → Dominios → willypost.com → DNS / Nameservers → Registros DNS** → **Añadir registro**: tipo **TXT**, nombre `@`, valor el que te dio TikTok, TTL por defecto. **Añadir**.
4. Vuelve a TikTok y pulsa **Verify** (si falla, espera 30 min y repite). Verificar el dominio cubre sus subdominios, incluido `media.willypost.com`.

## 5. Probar con el Sandbox (antes de la aprobación)

1. En la app → **Sandbox** → **Create sandbox** (⚠️). El sandbox tiene **su propio Client key y Client secret**.
2. **Target users**: añade tu cuenta de TikTok (y la de algún alumno de confianza, máx. ~10).
3. Para probar el modo central y grabar los vídeos, pon temporalmente en el `config.php` del servidor de conexión (`broker/LEEME.md`) el key/secret **del sandbox**. La cuenta de TikTok tiene que estar en **privado** para la publicación directa sin auditoría.
4. Conecta TikTok en WillyPost, envía un vídeo a la bandeja y otro en publicación directa (saldrá como «solo yo»). Graba los vídeos de `guiones-video.md` §2.
5. Al terminar, vuelve a poner el key/secret de **producción**: `TIKTOK_CLIENT_KEY` y `TIKTOK_CLIENT_SECRET` (en **App details** / *Credentials* de la app principal).

## 6. Enviar la app a revisión

1. En la app → **App review** (⚠️ sección al final de *App details*).
2. **Explain how each product and scope works within your app** → `textos-en.md` §2.2 (un párrafo por producto y permiso).
3. **Demo videos**: hasta **5 vídeos**, **50 MB** cada uno (mp4/mov) — los de `guiones-video.md` §2. Tienen que verse el dominio `willypost.com`, el inicio de sesión de TikTok y el uso de **cada** permiso.
4. **Submit for review**. TikTok contesta por email (días a un par de semanas). Si rechaza, indica el motivo; corrige y reenvía.

## 7. Auditoría de publicación directa (después de aprobada la app)

Hasta pasarla, la publicación directa solo puede ser **privada** («solo yo») y como mucho 5 usuarios al día.

1. Con la app ya en producción, abre el formulario de auditoría de Content Posting API (⚠️ desde la página del producto *Content Posting API* → *Apply for audit*, o https://developers.tiktok.com/application/content-posting-api).
2. Respuestas en `textos-en.md` §2.3 y el vídeo de la pantalla de publicación (`guiones-video.md` §2, vídeo 3).
3. TikTok revisa que cumples §0 al pie de la letra. Si aprueban, la publicación directa puede ser pública.

## 8. Dónde pegar los datos

| Dato | Variable del `config.php` |
|---|---|
| Client key (producción) | `TIKTOK_CLIENT_KEY` |
| Client secret (producción) | `TIKTOK_CLIENT_SECRET` |
