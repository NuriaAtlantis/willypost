# Meta (Facebook, Instagram, Threads) — paso a paso

Resultado: una app **WillyPost** en el portfolio de negocio **Diving With Us SL**, con tres partes:
Páginas de Facebook, Instagram (inicio de sesión de Instagram, sin Página) y Threads; aprobada en App Review
para estos permisos:

| Red | Permisos (exactamente los que pide WillyPost) |
|---|---|
| Facebook | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`, `business_management` |
| Instagram | `instagram_business_basic`, `instagram_business_content_publish` |
| Threads | `threads_basic`, `threads_content_publish` |

`business_management` **sí** lo usa WillyPost (`server/providers/facebook.js`): sin él, las Páginas que
están dentro de un portfolio de negocio no salen en la lista. Hay que justificarlo también.

Lo que va entre paréntesis y en cursiva es el nombre en inglés del panel. ⚠️ = etiqueta o paso que no hemos
podido comprobar en pantalla.

---

## 1. Portfolio de negocio y verificación (empieza por aquí: es lo que más tarda)

1. Entra en https://business.facebook.com con tu cuenta personal de Facebook (con la verificación en dos pasos activada).
2. Si no tienes portfolio de **Diving With Us SL**, créalo: **Crear un portfolio de negocio** (*Create a business portfolio*) → nombre del negocio **exactamente como en la escritura**: `Diving With Us SL`; tu nombre y un email de trabajo.
3. **Configuración** (*Settings*) → **Información del negocio** (*Business info*): rellena nombre legal, dirección (`Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas`), teléfono, web y CIF (`B76160340`).
   - Web: puedes poner `https://willypost.com/` (su pie de página dice que las apps son de Diving With Us SL) o la web principal de la empresa si en ella aparece el nombre legal. Lo importante es que Meta vea el **nombre legal** en la web o en los documentos.
4. **Centro de seguridad** (*Security Center*) → **Verificación del negocio** → **Iniciar verificación** (*Start verification*). ⚠️ En algunas cuentas está en *Configuración → Información del negocio → Verificación*.
5. Meta te pedirá:
   - Un **documento oficial** con nombre y dirección: escritura de constitución o certificado del Registro Mercantil, y/o la tarjeta del NIF/CIF de la empresa. A veces también un recibo (luz, teléfono) a nombre de la empresa con la misma dirección.
   - Un método de confirmación: **email a una dirección del dominio de la web**, llamada/SMS al teléfono de la empresa, o verificación del dominio.
6. Envía y espera (de 2 días a 2 semanas). Te avisan por notificación y email.

> Consejo: el nombre, la dirección y el CIF deben coincidir **letra por letra** en el portfolio, en los
> documentos y en la web (sustituye `B76160340` y `Calle Toscón 7, C.C. Montaña Tropical, local 6, 35510 Puerto del Carmen (Tías), Las Palmas` antes de enviar).

## 2. Cuenta de desarrollador y la app

1. Entra en https://developers.facebook.com con la misma cuenta. Si es la primera vez: **Empezar** (*Get Started*), acepta las condiciones y verifica tu móvil.
2. https://developers.facebook.com/apps/creation/ → **Crear app** (*Create app*).
3. **Detalles de la app**: nombre `WillyPost`; email de contacto `nuria.olive@gmail.com`. **Siguiente**.
4. **Casos de uso** (*Use cases*): marca
   - **Gestionar todo en tu Página** (*Manage everything on your Page*),
   - el de **Instagram** (⚠️ suele llamarse *Gestionar mensajes y contenido en Instagram* / *Manage messaging & content on Instagram*; es el que usa la «API de Instagram con inicio de sesión de Instagram»),
   - **Acceder a la API de Threads** (*Access the Threads API*).
   Meta dice que Threads **sí** se puede combinar con «Gestionar todo en tu Página». Si alguno sale **en gris** (incompatible), crea esa red en **una segunda app** (por ejemplo «WillyPost Threads») dentro del mismo portfolio: el servidor de conexión ya tiene variables separadas para cada red, así que funciona igual. Los casos de uso **no se pueden quitar** después.
   **No** elijas «Autenticar y solicitar datos con el inicio de sesión con Facebook» (*Authenticate and request data from users with Facebook Login*): es incompatible con el de Páginas.
5. **Empresa** (*Business*): elige el portfolio **Diving With Us SL**. **Siguiente** → revisa los requisitos → **Ir al panel**.

## 3. Facebook (Páginas)

1. **Casos de uso** → **Gestionar todo en tu Página** → **Personalizar** (*Customize*) → **Permisos**: comprueba que están añadidos `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video` y `business_management`. Añade los que falten (**Añadir** / *Add*).
2. Dirección de retorno. Busca **Inicio de sesión con Facebook para empresas** (*Facebook Login for Business*) → **Configuración** (*Settings*). En **URI de redireccionamiento de OAuth válidos** (*Valid OAuth Redirect URIs*) pega:
   ```
   https://willypost.com/callback.html
   ```
   Deja activados **Inicio de sesión con OAuth del cliente** y **Inicio de sesión con OAuth web**; activa **Usar modo estricto para URI de redireccionamiento** si aparece. **Guardar cambios**. Comprueba que no se ha añadido una «/» al final.
3. Configuración de inicio de sesión: **Facebook Login para empresas** → **Configuraciones** (*Configurations*) → **Crear configuración** (*Create configuration*):
   - Nombre: `WillyPost`.
   - Variación de inicio de sesión: **General** (⚠️).
   - Tipo de token: **Token de acceso de usuario** (*User access token*).
   - Activos (*Assets*): **Páginas**.
   - Permisos: los cinco de arriba.
   - **Crear**. Copia el **ID de configuración** (*Configuration ID*) → variable `META_CONFIG_ID`.
4. ID y clave: **Configuración de la app** (*App settings*) → **Básica** (*Basic*): **Identificador de la app** → `META_APP_ID`; **Clave secreta de la app** → **Mostrar** → `META_APP_SECRET`.

## 4. Instagram (inicio de sesión de Instagram)

1. **Casos de uso** → el de Instagram → **Personalizar** → **Configuración de la API con inicio de sesión de Instagram** (*API setup with Instagram login*).
2. Arriba verás el **Identificador de la app de Instagram** (*Instagram app ID*) y la **Clave secreta de la app de Instagram** (*Instagram app secret*) → `IG_APP_ID` y `IG_APP_SECRET`. **No son** los de Facebook.
3. Permisos: comprueba `instagram_business_basic` e `instagram_business_content_publish` (añade el que falte).
4. Sección **Configurar el inicio de sesión para empresas de Instagram** (*Set up Instagram business login*) → **Configuración del inicio de sesión para empresas** (*Business login settings*):
   - **URI de redireccionamiento de OAuth** (*OAuth redirect URIs*): `https://willypost.com/callback.html`
   - **URL de devolución de llamada para desautorizar** (*Deauthorize callback URL*) y **URL de solicitud de eliminación de datos** (*Data deletion request URL*): las dos direcciones de `auth.willypost.com/meta/…` del aviso de §6.
   - **Guardar**.
5. Para probar con tu propia cuenta de Instagram antes de la aprobación: **Roles de la app** (*App roles*) → **Roles** → **Añadir personas** → **Probador de Instagram** (*Instagram Tester*) → tu usuario. Acéptalo en Instagram → **Configuración** → **Permisos de sitios web** → **Apps y sitios web** → **Invitaciones de probador**.

## 5. Threads

1. **Casos de uso** → **Acceder a la API de Threads** → **Personalizar** → **Permisos**: `threads_basic` (ya viene) y añade `threads_content_publish`.
2. **Configuración** (*Settings*) del caso de uso de Threads:
   - **Identificador de la app de Threads** / **Clave secreta** (*Threads app ID / secret*) → `THREADS_APP_ID` y `THREADS_APP_SECRET`.
   - **URL de devolución de llamada de redireccionamiento** (*Redirect Callback URLs*, sección *Client OAuth Settings*): `https://willypost.com/callback.html`
   - **URL de devolución de llamada para desinstalar** (*Uninstall Callback URL*) y **URL de devolución de llamada para eliminar** (*Delete Callback URL*): las dos direcciones de `auth.willypost.com/meta/…` del aviso de §6.
3. Para probar: **Roles de la app → Roles → Añadir personas → Probador de Threads** (*Threads Tester*). Acéptalo en Threads → **Configuración → Cuenta → Permisos de sitios web**.

## 6. Configuración básica de la app (obligatoria para revisión y para publicarla)

**Configuración de la app → Básica** (*App settings → Basic*):

| Campo | Qué pones |
|---|---|
| Nombre visible | `WillyPost` |
| Dominios de la app (*App domains*) | `willypost.com` |
| Email de contacto | `nuria.olive@gmail.com` |
| URL de la política de privacidad | `https://willypost.com/privacidad.html` |
| URL de las condiciones del servicio | `https://willypost.com/terminos.html` |
| Eliminación de datos de usuario (*User data deletion*) | elige **URL de instrucciones para la eliminación de datos** (*Data deletion instructions URL*) → `https://willypost.com/borrar-datos.html` |
| Icono de la app (1024 × 1024) | `solicitudes/icono-1024.png` |
| Categoría | **Empresas y páginas** (*Business and pages*) ⚠️ (si no existe, *Productividad*) |
| Propósito de la app (si lo pide) | Para otros (clientes) — la usan alumnos, no solo tu empresa |
| Plataforma (**Añadir plataforma** → *Website*) | URL del sitio: `https://willypost.com/` |

> **Avisos de desinstalación / eliminación de Instagram y Threads.** En esos paneles Meta pide
> *URLs de devolución de llamada* (Meta envía ahí un aviso cuando alguien quita la app). El servidor de
> conexión ya las tiene preparadas. Pega siempre estas dos:
> - Desautorizar / desinstalar (*Deauthorize* / *Uninstall*): `https://auth.willypost.com/meta/deauthorize`
> - Eliminación de datos / eliminar (*Data deletion request* / *Delete*): `https://auth.willypost.com/meta/delete`
>
> Como WillyPost no guarda nada en el servidor, responden «recibido» con un código de confirmación y el
> enlace a `borrar-datos.html`. No pongas `borrar-datos.html` en esos dos campos: es una página, no responde a avisos.

**Guardar cambios.**

### Verificación de acceso (*Access verification*) ⚠️
Como la app la usan negocios que no son Diving With Us SL, Meta puede pedir además la **Verificación de
acceso** («proveedor de tecnología»). Si en el panel (aviso arriba o en *App Review → Requisitos*) aparece,
complétala: es un formulario corto sobre a qué se dedica la empresa y cómo usa los datos (texto en
`textos-en.md` §1.4).

## 7. Probar antes de enviar (obligatorio)

Meta exige **al menos una llamada correcta a la API por cada permiso en los últimos 30 días**. Con la app
aún sin aprobar, tú (administradora) y los probadores sí podéis usar todos los permisos:
1. Cuando el servidor de conexión tenga las variables de Meta, abre tu WillyPost → **Redes** →
   **Conectar Facebook** → elige una Página tuya → **Conectar**. Haz una publicación con foto y otra con vídeo (Reel) → **Publicar ahora**.
2. **Conectar Instagram** → publica una foto y un carrusel.
3. **Conectar Threads** → publica un texto.
4. Comprueba en **Revisión de la app → Solicitudes / Permisos y funciones** que el contador de llamadas de cada permiso ya no está a cero (⚠️ puede tardar hasta 24 h en actualizarse).

## 8. Enviar a revisión

1. Menú **Revisión de la app** (*App Review*) → **Permisos y funciones** (*Permissions and features*). Para cada permiso de la tabla de arriba → **Solicitar acceso avanzado** (*Request advanced access*). ⚠️ En apps nuevas puede aparecer como **Casos de uso → Personalizar → «Solicitar»** junto a cada permiso.
2. **Solicitudes** (*Requests*) → abre la solicitud y rellena por cada permiso:
   - **Cómo se usa** (*Tell us how you're using this permission*): copia el texto de `textos-en.md` §1.2 (uno distinto por permiso).
   - **Vídeo** (*Screencast*): sube el de `guiones-video.md` correspondiente.
   - Marca la casilla de que cumples las condiciones de uso.
3. **Detalles de verificación de la app** / **Instrucciones para el revisor** (*App verification details / Reviewer instructions*): pega `textos-en.md` §1.3.
   - Credenciales de prueba: WillyPost **no tiene usuarios en ningún servidor**: el revisor crea su cuenta local al instalar. Indica que puede usar sus propias cuentas de prueba de Facebook/Instagram/Threads (las de Meta para revisores) y que **todo el flujo está en los vídeos** por si no puede instalar un programa de Windows.
4. **Preguntas sobre el tratamiento de datos** (*Data handling questions*): `textos-en.md` §1.4.
5. **Enviar para revisión** (*Submit for review*).

Si rechazan algo, el mensaje dice qué permiso y por qué. Lo normal es que pidan un vídeo más claro: corrige
solo eso y vuelve a enviar.

## 9. Cuando aprueben

1. **Publicar** (*Publish*) la app (o cambia **Modo de la app: Desarrollo → Live** si ves ese interruptor).
2. Comprueba con una cuenta que **no** tenga rol en la app que «Conectar Facebook / Instagram / Threads» funciona.
3. Cada año Meta pide la **Comprobación del uso de datos** (*Data Use Checkup*): te llega un aviso; se contesta en 5 minutos con los mismos textos.
