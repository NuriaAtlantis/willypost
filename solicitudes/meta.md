# Meta (Facebook, Instagram, Threads) — lo que falta

> Actualizado el 5 de noviembre de 2026, con la app real ya creada. Lo que va entre paréntesis y en cursiva
> es el nombre en inglés del panel. ⚠️ = etiqueta o paso que no hemos podido comprobar en pantalla.

## Lo que ya está hecho (no tocar)

| Pieza | Valor |
|---|---|
| App | **WillyPost** · identificador de la app `1642727863583670` |
| Portfolio de negocio | **AtlantisLZT** (titular Diving With Us SL) · **verificado** |
| Casos de uso | «Administrar todos los aspectos de tu página» · «Administrar mensajes y contenido en Instagram» · «Acceder a la API de Threads» |
| Facebook Login for Business · configuración **WillyPost** | ID `1739698170463858` · token de acceso de usuario · `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` |
| Facebook Login for Business · configuración **WillyPost Instagram** | ID `1266976112293099` · token de acceso de usuario · `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management` |
| Threads | `threads_basic`, `threads_content_publish` · redirección `https://willypost.com/callback.html` · desinstalar `https://auth.willypost.com/meta/deauthorize` · eliminar `https://auth.willypost.com/meta/delete` |
| Redirección de Facebook Login for Business | `https://willypost.com/callback.html` |
| Borrado de datos | instrucciones `https://willypost.com/borrar-datos.html` · avisos de desautorizar y eliminar puestos |
| Configuración básica | privacidad, condiciones, borrado de datos, categoría **Negocios y páginas**, plataforma **Sitio web** |

**Cómo conecta WillyPost con Instagram.** Meta ya no deja que las apps nuevas usen «Instagram API with
Instagram Login». WillyPost usa el **inicio de sesión unificado**: al pulsar «Conectar Instagram» se abre
Facebook Login for Business con la configuración *WillyPost Instagram*, y WillyPost publica en la cuenta
profesional de Instagram **vinculada a una Página de Facebook**, a través de `graph.facebook.com` con el token
de esa Página. Por eso la cuenta de Instagram tiene que ser profesional (Empresa o Creador) y estar vinculada a
una Página que administres.

## Permisos que se piden en la revisión (8)

| Caso de uso | Permisos |
|---|---|
| Administrar todos los aspectos de tu página | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` |
| Administrar mensajes y contenido en Instagram | `instagram_basic`, `instagram_content_publish` (y, si el formulario los vuelve a pedir aquí, `pages_show_list`, `pages_read_engagement` y `business_management` con su texto «versión Instagram») |
| Acceder a la API de Threads | `threads_basic`, `threads_content_publish` |

- **`publish_video` ya no existe** en el caso de uso de Páginas: los vídeos y Reels de Página se publican con `pages_manage_posts`. No lo busques ni lo pidas.
- **`instagram_business_basic` e `instagram_business_content_publish` NO se piden.** Están añadidos en el caso de uso de Instagram, pero son del «Inicio de sesión con Instagram», que WillyPost no usa. Si el panel no deja enviar la revisión mientras estén en la lista, quítalos antes: **Casos de uso → Administrar mensajes y contenido en Instagram → Personalizar → Permisos → Quitar** ⚠️.

---

## Lo que falta, en orden

### 1. Icono de la app
**Configuración de la app → Básica** (*App settings → Basic*) → **Icono de la app** → sube `solicitudes/icono-1024.png` → **Guardar cambios** (abajo del todo).

### 2. Dominios de la app (no se guardó)
En la misma pantalla, campo **Dominios de la app** (*App domains*): escribe `willypost.com` (sin `https://` ni barra) y pulsa **Intro**, para que quede como una «etiqueta» dentro del campo. Si solo lo escribes y guardas sin pulsar Intro, no se guarda. Después **Guardar cambios** y recarga la página para comprobar que sigue ahí.

### 3. Datos de Meta en el servidor de conexión
En el `config.php` del servidor de conexión (fuera de `public_html`; ver `broker/LEEME.md`):

| Variable | Valor |
|---|---|
| `META_APP_ID` | `1642727863583670` |
| `META_APP_SECRET` | **Configuración de la app → Básica → Clave secreta de la app → Mostrar** (no la pegues en ningún otro sitio) |
| `META_CONFIG_ID` | `1739698170463858` |
| `META_IG_CONFIG_ID` | `1266976112293099` |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | **Casos de uso → Acceder a la API de Threads → Personalizar → Configuración** |
| `IG_APP_ID`, `IG_APP_SECRET` | **Vacíos.** Si los rellenas, WillyPost intentará el inicio de sesión de Instagram, que Meta ya no permite a esta app. |

Comprueba que `https://auth.willypost.com/config` muestra `meta` con `config_id` e `ig_config_id`, y `threads`, y que **no** aparece `instagram`.

### 4. Tu cuenta de Threads como probadora
**Roles de la app → Roles → Añadir personas → Probador de Threads** (*Threads Tester*) → tu usuario de Threads. Acepta la invitación en Threads → **Configuración → Cuenta → Permisos de sitios web → Invitaciones** ⚠️. (Facebook e Instagram no lo necesitan: como administradora de la app ya puedes usar todos sus permisos en modo desarrollo.)

### 5. Una llamada correcta por permiso (en los últimos 30 días)
Meta no deja enviar la revisión hasta que cada permiso tenga al menos una llamada correcta. Se consigue usando WillyPost con tus propias cuentas mientras la app está en **modo desarrollo**. Aprovecha y **graba los vídeos a la vez** (paso 6), así lo haces una sola vez.

1. WillyPost actualizado → **Redes** → **Conectar Facebook** → en la ventana de Facebook marca **al menos dos Páginas** (así WillyPost enseña su lista de Páginas, que sale en el vídeo), incluida una del portfolio AtlantisLZT → vuelve a WillyPost, marca una → **Conectar**.
2. **Crear publicación** → **Post** con una foto en esa Página → **Publicar ahora**. Después un **Reel / Vídeo** vertical → **Programar** para dentro de 2 minutos.
3. **Conectar Instagram** → se abre Facebook → marca tu cuenta de Instagram profesional **y** su Página → vuelve a WillyPost. Publica un **Carrusel** (**Publicar ahora**) y programa un **Reel**.
4. **Conectar Threads** → **Permitir** → publica un **Post** de texto con una foto.
5. Espera hasta 24 h y mira en **Revisión de la app** (*App Review*) → **Permisos y funciones** que ningún contador de llamadas esté a cero ⚠️. Si `business_management` sigue a cero, vuelve a conectar Facebook marcando una Página del portfolio AtlantisLZT.

> En modo desarrollo, lo que publiques en **Facebook** solo lo ven las personas con rol en la app. Lo de
> **Instagram y Threads sí es público**: usa un contenido neutro y bórralo a mano cuando termines de grabar
> (borrarlo no quita la llamada del contador).

### 6. Grabar los vídeos
Siguiendo `guiones-video.md` §1: tres grabaciones (Facebook, Instagram, Threads) y de ellas se sacan **8 vídeos**, uno por permiso. 1080p, Facebook/Instagram/Threads en inglés y rótulos en inglés.

### 7. Rellenar y enviar la revisión
1. **Revisión de la app → Solicitudes** (*App Review → Requests*) ⚠️ (en apps nuevas también puede salir como **Casos de uso → Personalizar → Solicitar** junto a cada permiso). Añade los 8 permisos de la tabla de arriba, **ninguno más**.
2. Por cada permiso:
   - **Cómo se usa** (*Tell us how you're using this permission*): el texto de `textos-en.md` §1.2 (cada uno es distinto a propósito).
   - **Vídeo** (*Screencast*): el suyo, de `guiones-video.md` §1.
   - Marca la casilla de que cumples las condiciones.
3. **Instrucciones para el revisor** (*Reviewer instructions / App verification details*): `textos-en.md` §1.3.
4. **Credenciales de prueba** (*Test credentials*): el texto para el revisor dice que van en estos campos. WillyPost no necesita ninguna (la cuenta se crea en el ordenador al instalar); lo que necesita el revisor es una cuenta de Facebook que administre una Página con un Instagram profesional vinculado y su perfil de Threads. ⚠️ Decide cuál pones: **nunca** la contraseña de tu cuenta personal ni la de las cuentas principales de Atlantis, y sin verificación en dos pasos (el revisor no podría entrar).
5. **Tratamiento de datos** (*Data handling questions*): `textos-en.md` §1.4.
6. Si aparece **Verificación de acceso** (*Access verification*, «proveedor de tecnología»): texto de `textos-en.md` §1.4, último bloque.
7. **Enviar para revisión** (*Submit for review*). Plazo habitual: 1–3 semanas. Si rechazan algo, el mensaje dice qué permiso y por qué (casi siempre piden un vídeo más claro): corrige solo eso y reenvía.

### 8. Cuando aprueben: pasar a Live
1. **Publicar** la app (*Publish*) o cambia **Modo de la app: Desarrollo → Activo** (*Live*).
2. Comprueba con una cuenta **sin rol** en la app que «Conectar Facebook», «Conectar Instagram» y «Conectar Threads» funcionan y publican.
3. Cada año Meta pide la **Comprobación del uso de datos** (*Data Use Checkup*): se contesta en 5 minutos con estos mismos textos.
