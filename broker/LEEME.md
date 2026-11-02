# Servidor central de WillyPost en Hostinger

Guía paso a paso para Nuria. No hace falta saber programar.

## Qué vas a montar

- **willypost.com**: la web de WillyPost. Sigue en GitHub (se actualiza sola). Hostinger solo la «apunta».
- **auth.willypost.com**: el servidor central. Guarda las claves secretas de las apps de cada red.
  Así los alumnos pulsan «Conectar» y listo, sin crear apps ni copiar claves.
- **media.willypost.com**: le pasa a TikTok las fotos de los alumnos desde un dominio verificado.

Las dos últimas son dos carpetas con un archivo PHP cada una. No guardan nada de los alumnos.

Tiempo total: unos 45 minutos (más la espera del DNS, que puede tardar unas horas).

---

## Paso 1 · Comprar el dominio

1. Entra en **hPanel** (hpanel.hostinger.com) con tu cuenta de Hostinger.
2. Arriba, pulsa **Dominios** y después **Obtener un nuevo dominio** (o **Buscar dominio**).
3. Escribe `willypost.com` y pulsa **Buscar**.
4. Añádelo al carrito y paga.
5. Espera el email de Hostinger de «dominio registrado». Confirma el email de verificación si te lo piden
   (si no lo confirmas en 15 días, el dominio se suspende).

## Paso 2 · Añadir willypost.com a tu hosting

Hace falta para poder crear los subdominios `auth` y `media`.

1. En hPanel, pulsa **Sitios web**.
2. Pulsa **Añadir sitio web** (o **+ Agregar sitio web**).
3. Elige la opción de **sitio vacío** (puede llamarse «Sitio web PHP/HTML vacío» o «Saltar, crear un sitio vacío»).
   No elijas WordPress ni el creador de webs.
4. Elige el dominio `willypost.com` y termina.

> Si no ves estos botones: en **Sitios web**, busca cualquier botón con un **+** o «Crear o migrar un sitio web».

## Paso 3 · Crear los subdominios auth y media

1. En **Sitios web**, junto a `willypost.com`, pulsa **Panel** (o **Administrar**).
2. En el menú de la izquierda: **Dominios** → **Subdominios**.
3. Escribe `auth` y pulsa **Crear**.
   - Si te deja elegir carpeta, deja la que propone: `public_html/auth`.
4. Repite con `media` (carpeta `public_html/media`).

Al terminar verás los dos en la lista: `auth.willypost.com` y `media.willypost.com`.

## Paso 4 · DNS: la web va a GitHub, auth y media se quedan en Hostinger

1. En hPanel: **Dominios** → `willypost.com` → **DNS / Nameservers** (o **Zona DNS** / **Registros DNS**).
2. **Borra** los registros que apuntan la raíz a Hostinger:
   - el registro **A** con nombre `@`
   - el registro **AAAA** con nombre `@`, si hay uno
   - el registro **CNAME** con nombre `www`, si hay uno
3. **Añade** estos cuatro registros **A** (uno por uno, botón **Añadir registro**):

   | Tipo | Nombre | Apunta a | TTL |
   |---|---|---|---|
   | A | `@` | `185.199.108.153` | el que venga |
   | A | `@` | `185.199.109.153` | el que venga |
   | A | `@` | `185.199.110.153` | el que venga |
   | A | `@` | `185.199.111.153` | el que venga |

4. **Añade** este registro **CNAME**:

   | Tipo | Nombre | Apunta a |
   |---|---|---|
   | CNAME | `www` | `nuriaatlantis.github.io` |

5. **Comprueba** `auth` y `media` (muy importante):
   - Tienen que ser registros de tipo **A** con la **IP de tu hosting**.
   - Si son de tipo **CNAME** apuntando a `willypost.com`, bórralos y créalos de tipo **A**.
     Si no, irían a GitHub y no funcionarían.
   - La IP de tu hosting la ves en **Sitios web** → **Panel** de willypost.com → **Detalles del plan**
     o **Información del sitio** («Dirección IP del sitio web»). También es la que tenía el registro A `@` que borraste.

6. En GitHub (esto lo puede hacer Claude por ti): en el repositorio de WillyPost, **Settings** → **Pages** →
   **Custom domain**: `willypost.com` → **Save**. Cuando salga el visto verde, marca **Enforce HTTPS**.

> El DNS tarda en propagarse: de unos minutos a 24 horas. Sigue con los pasos y prueba al final.

> **TikTok** te pedirá más adelante verificar el dominio con un registro **TXT**. Se añade en esta misma pantalla:
> Tipo `TXT`, Nombre `@`, y el valor que te dé TikTok. No toques los demás registros.

## Paso 5 · Certificado SSL (el candado)

1. En el **Panel** de willypost.com: **Seguridad** → **SSL**.
2. Si `auth.willypost.com` o `media.willypost.com` no aparecen como **Activo**, pulsa **Instalar SSL** y elígelos.
3. Si da error, es que el DNS aún no ha llegado. Espera una hora y repite.

## Paso 6 · Versión de PHP

1. En el **Panel** de willypost.com: **Avanzado** → **Configuración de PHP** (o **Configuración PHP**).
2. Elige **PHP 8.2** o superior y pulsa **Guardar** (o **Actualizar**).

## Paso 7 · Subir las dos carpetas

Necesitas la carpeta `broker/hostinger/` de WillyPost (descarga el repositorio de GitHub en ZIP y descomprímelo,
o pídeselo a Claude).

1. En el **Panel** de willypost.com: **Archivos** → **Administrador de archivos**.
2. Entra en `public_html` → `auth`.
3. Pulsa el botón de **Subir** (icono de flecha hacia arriba) → **Archivos**.
4. Sube los **dos** archivos de `broker/hostinger/auth/`:
   - `index.php`
   - `.htaccess` (empieza por punto; en tu ordenador puede estar oculto: en el Explorador de Windows,
     **Vista** → **Mostrar** → **Elementos ocultos**)
5. Vuelve a `public_html` → `media` y sube los dos archivos de `broker/hostinger/media/`
   (`index.php` y `.htaccess`).
6. Si dentro de `auth` o `media` había un archivo `default.php` o `index.html` de Hostinger, **bórralo**.

## Paso 8 · El archivo de claves (fuera de public_html)

Las claves secretas **nunca** van dentro de `public_html`. Van una carpeta más arriba.

1. En el **Administrador de archivos**, sube un nivel desde `public_html`
   (pulsa `willypost.com` en la ruta de arriba, o la flecha de **subir nivel**).
   Debes ver la carpeta `public_html` dentro. Esa es la carpeta correcta.
2. Pulsa **Nuevo archivo** y llámalo exactamente: `willypost-config.php`
3. Ábrelo y pega todo el contenido de `broker/hostinger/config.example.php`.
4. Pulsa **Guardar**. De momento todas las claves están vacías (`''`): no pasa nada.

Debe quedar así:

```
domains/willypost.com/
├── willypost-config.php      ← las claves (aquí)
└── public_html/
    ├── auth/   index.php  .htaccess
    └── media/  index.php  .htaccess
```

> Si tu Administrador de archivos no te deja subir más arriba de `public_html`, no lo pongas dentro.
> Pide ayuda a Claude: hay otra ubicación posible (la carpeta personal de la cuenta, `/home/<usuario>/willypost-config.php`).

## Paso 9 · Comprobar que funciona

1. Abre en el navegador: **https://auth.willypost.com/health**
2. Tienes que ver: `{"ok":true,"networks":[]}`
   - `networks` vacío es normal mientras no haya claves.
3. Abre **https://auth.willypost.com/config**. Verás `"networks":{}`.
4. Pídele a Claude que pase la prueba completa:
   `node broker/hostinger/smoke-test.mjs https://auth.willypost.com https://media.willypost.com`
   Debe terminar en **TODO BIEN**.

## Paso 10 · Añadir cada clave cuando llegue

Cada red aprueba su app en un momento distinto. Cuando una te dé su ID y su secreto:

1. **Administrador de archivos** → sube un nivel desde `public_html` → abre `willypost-config.php` (**Editar**).
2. Pega cada valor **entre las comillas** de su línea. Ejemplo:
   `'TIKTOK_CLIENT_KEY'    => 'aw1b2c3d4e5f',`
3. **Guardar**.
4. Abre **https://auth.willypost.com/health**: la red nueva tiene que aparecer en `networks`.

| Red | Líneas que rellenar | Dónde está el dato |
|---|---|---|
| Facebook (meta) | `META_APP_ID`, `META_APP_SECRET`, y `META_CONFIG_ID` si lo hay | developers.facebook.com → tu app → Configuración de la app → Básica |
| Instagram | `IG_APP_ID`, `IG_APP_SECRET` | misma app de Meta → Instagram → «ID de la app de Instagram» y su clave secreta |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET` | misma app de Meta → Threads → ID y clave secreta de Threads |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | developers.tiktok.com → tu app → Client key y Client secret |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | linkedin.com/developers → tu app → Auth |
| Google (YouTube y Perfil de Empresa) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | console.cloud.google.com → Credenciales → cliente de tipo **App de escritorio** |

Una red solo aparece cuando tiene **las dos** líneas (ID y secreto) rellenas.

## Reglas de oro

- El archivo `willypost-config.php` **no se sube nunca a GitHub** ni se manda por email, WhatsApp o chat.
- Nunca dentro de `public_html`.
- Si crees que un secreto se ha filtrado: genera uno nuevo en la web de esa red y cámbialo en el archivo.

## Si algo falla

| Lo que ves | Qué pasa | Qué hacer |
|---|---|---|
| Error de certificado / «no seguro» | SSL aún sin instalar | Paso 5. Si el DNS es reciente, espera unas horas |
| Página de Hostinger por defecto o «403» | Falta `index.php`, o sobra `default.php` | Paso 7 |
| «404» en `/health` | Falta el `.htaccess` (archivo oculto) | Paso 7, punto 4 |
| «500» o página en blanco | Versión de PHP antigua | Paso 6 |
| `networks` vacío con claves puestas | El archivo de claves no está donde toca o tiene otro nombre | Paso 8: nombre exacto y una carpeta por encima de `public_html` |
| La web willypost.com no abre | DNS aún propagándose o falta el dominio en GitHub | Paso 4, puntos 3, 4 y 6 |

---

## Alternativa: Cloudflare Workers

La misma pieza existe para Cloudflare, gratis: `broker/worker.js` (versión de referencia, con pruebas automáticas)
y `broker/wrangler.toml`. Cumple exactamente lo mismo que la versión de Hostinger.
Si algún día se quiere cambiar, Claude puede publicarla con `npx wrangler deploy` desde la carpeta `broker/`
y poner los secretos con `npx wrangler secret put NOMBRE` (la lista está en `wrangler.toml`).
En ese caso las claves irían en Cloudflare y no en `willypost-config.php`.
