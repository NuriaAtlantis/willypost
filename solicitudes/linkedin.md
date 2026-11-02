# LinkedIn — paso a paso

Resultado: una app **WillyPost** asociada a una **Página de LinkedIn verificada**, con dos productos de
**autoservicio** (no hay revisión, quedan activos al momento):
- **Share on LinkedIn** → permiso `w_member_social` (publicar en el perfil personal),
- **Sign In with LinkedIn using OpenID Connect** → permisos `openid` y `profile` (saber quién es).

Son exactamente los que pide WillyPost (`server/providers/linkedin.js`: `openid profile w_member_social`).
Publicar en Páginas de empresa exigiría otro producto con aprobación de LinkedIn: WillyPost no lo pide.

⚠️ = etiqueta que no hemos podido comprobar en pantalla.

---

## 1. Página de LinkedIn

La app tiene que estar asociada a una Página de empresa de LinkedIn de la que seas administradora.
- Si Diving With Us SL ya tiene Página, usa esa.
- Si no, o si prefieres una para WillyPost: LinkedIn → **Para empresas** → **Crear una página de empresa** → **Empresa** → nombre `WillyPost`, URL `linkedin.com/company/willypost`, web `https://willypost.com/`, sector *Desarrollo de software*, tamaño 0–1, logo `icono-1024.png` → acepta la casilla de que eres representante autorizada → **Crear página**.

## 2. Crear la app

1. https://www.linkedin.com/developers/apps/new
2. Rellena:

| Campo | Qué pones |
|---|---|
| App name | `WillyPost` |
| LinkedIn Page | la Página del paso 1 |
| Privacy policy URL | `https://willypost.com/privacidad.html` |
| App logo | `solicitudes/icono-1024.png` |
| Legal agreement | marca la casilla (*I have read and agree to these terms*) |

3. **Create app**.

## 3. Verificar la app con la Página

1. Pestaña **Settings** → junto a la Página, **Verify** → **Generate URL**.
2. Abre esa dirección con tu cuenta (administradora de la Página) → **Verify**. Si la administra otra persona, mándasela a ella.
3. Vuelve a la app: la Página aparece como **Verified**.

## 4. Productos

Pestaña **Products** → **Request access** en:
- **Share on LinkedIn** → acepta las condiciones.
- **Sign In with LinkedIn using OpenID Connect** → acepta las condiciones.
Los dos pasan a **Added** al momento. En la pestaña **Auth**, sección **OAuth 2.0 scopes**, deben aparecer `openid`, `profile`, `w_member_social` (y quizá `email`, que WillyPost no pide).

## 5. Dirección de retorno, ID y clave

Pestaña **Auth**:
1. **Authorized redirect URLs for your app** → lápiz → **Add redirect URL** → `https://willypost.com/callback.html` → **Update**.
2. **Client ID** → `LINKEDIN_CLIENT_ID`.
3. **Primary Client Secret** → ojo → copia → `LINKEDIN_CLIENT_SECRET` (en el `config.php` del servidor de conexión, `broker/LEEME.md`).

## 6. Probar

En tu WillyPost → **Redes** → **Conectar LinkedIn** → **Permitir** → publica un texto de prueba. No hay
nada que enviar a revisión: en cuanto funcione para ti, funciona para todos los alumnos.

## Límites a tener en cuenta

LinkedIn limita las llamadas por día y por app/miembro (⚠️ las cifras exactas se ven en la pestaña
**Analytics** de la app). Con el uso normal de los alumnos (unas pocas publicaciones al día cada uno) no
debería notarse. La conexión de LinkedIn dura 60 días (WillyPost pide reconectar a los 30).
