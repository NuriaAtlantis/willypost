# WillyPost

**Programa tus redes en un rato, no en toda la semana.**

WillyPost es un programador de redes sociales **gratuito** que se instala en tu propio ordenador (Windows o Mac). Lo regala la [Willy SEO Academy](https://willyseo.net) a sus alumnos.

- **Calendario visual**: ves el mes entero y arrastras las publicaciones para cambiarlas de día.
- **8 redes en un solo sitio**: Facebook (Páginas), Instagram, Threads, TikTok, YouTube Shorts, Google Business Profile, LinkedIn y Bluesky.
- **Posts, carruseles, Reels y stories**, con un texto adaptado a cada red y vista previa.
- **Cola de publicaciones**: eliges tus horas y WillyPost busca el siguiente hueco libre.
- **Claude te monta campañas**: conecta Claude Desktop o Claude Code y pídele “una campaña de Black Friday de 2 semanas”. Llega a tu calendario como borrador para que la apruebes.
- **Modo manual**: si una red no deja publicar automáticamente, a su hora te avisa y te deja el texto y los archivos listos.
- **Tus datos son solo tuyos**: todo se guarda en tu ordenador. Nada pasa por servidores de la Academia.

> **Web con las guías paso a paso:** <https://nuriaatlantis.github.io/willypost/>

---

## Descargar e instalar (3 pasos)

No hace falta saber de informática. El instalador **no pide contraseña de administrador** y tarda unos 2 minutos. Necesitas conexión a internet.

### Paso 1. Descarga el ZIP

Pulsa aquí para descargarlo: **[Descargar WillyPost (ZIP)](https://github.com/NuriaAtlantis/willypost/archive/refs/heads/main.zip)**.
(Otra opción: en la [página principal del proyecto](https://github.com/NuriaAtlantis/willypost), botón verde **Code** → **Download ZIP**.)

### Windows 10 u 11

1. **Descomprime el ZIP**: clic derecho sobre el archivo → **Extraer todo…** → **Extraer**.
   - **Importante:** no hagas doble clic dentro del ZIP sin descomprimirlo. Si lo haces, el instalador dirá “No encuentro los archivos”: cierra la ventana y descomprime primero.
   - Se abre una carpeta nueva. Si dentro ves solo otra carpeta con el mismo nombre, entra en ella hasta ver los archivos **Instalar WillyPost** y **README**.
2. Haz **doble clic en `Instalar WillyPost`** (el que tiene el icono de engranajes y **no** termina en `.command`).
   - Si Windows muestra *“Windows protegió su PC”*: pulsa **Más información** y luego **Ejecutar de todas formas**.
   - Si muestra *“Advertencia de seguridad de Abrir archivo”*: pulsa **Ejecutar**.
   - Es normal: Windows avisa de todos los programas que no vienen de su tienda.
   - Si tu antivirus lo bloquea, permite el archivo (WillyPost solo copia archivos a tu usuario y descarga Node.js de nodejs.org).
3. **Espera** a ver una ventana negra con los pasos (del 1 al 6). Al terminar dice **LISTO** y se abre **WillyPost en tu navegador** (<http://localhost:4747>). Cierra la ventana negra pulsando una tecla.

Te deja un icono **WillyPost** en el Escritorio y en el menú Inicio, y arranca solo al iniciar sesión (en segundo plano, sin ventanas).

### Mac (macOS 11 o superior)

1. **Descomprime el ZIP**: doble clic sobre el archivo (en Descargas). Se crea una carpeta nueva; ábrela.
2. Haz **doble clic en `Instalar WillyPost.command`** (el que termina en `.command`).
3. **La primera vez, macOS bloqueará el archivo** porque viene de internet (es el aviso de seguridad *Gatekeeper*; es normal). Verás una ventana que dice que “no se puede abrir” o que “Apple no ha podido comprobar que no contenga software malicioso”. Según tu macOS:
   - **macOS 14 (Sonoma) o anterior:** pulsa **Cancelar**, haz **clic derecho** (o Control + clic) sobre el archivo → **Abrir** → **Abrir**.
   - **macOS 15 (Sequoia) o posterior:** pulsa **Listo**. Abre **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el final, pulsa **Abrir igualmente** junto al aviso de `Instalar WillyPost.command`, escribe la contraseña de tu Mac (o usa Touch ID) y pulsa **Abrir**.
   - **Plan B (funciona siempre, en cualquier macOS):** abre la app **Terminal** (⌘ + Espacio, escribe “Terminal” e Intro), escribe `bash` seguido de **un espacio**, **arrastra** el archivo `Instalar WillyPost.command` dentro de la ventana de la Terminal y pulsa **Intro**.
   - Si macOS pregunta si la Terminal puede acceder a la carpeta **Descargas**, pulsa **Permitir** (si dijiste que no, actívalo en Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas → Terminal).
4. **Espera** unos 2 minutos: la Terminal te va contando los pasos. Al terminar dice **LISTO** y se abre **WillyPost en tu navegador** (<http://localhost:4747>).

Te crea la app **WillyPost** (búscala en Launchpad o con ⌘ + Espacio) y arranca sola al encender el Mac. Si macOS avisa de un “elemento en segundo plano”, pulsa **Permitir**.

Si al abrir el instalador dice *“permiso denegado”*, usa el **Plan B** de arriba (es lo más fácil).

> El instalador copia WillyPost a una carpeta propia (`%LOCALAPPDATA%\WillyPost\app` en Windows, `~/Library/Application Support/WillyPost/app` en Mac), así que **cuando termine puedes borrar la carpeta que descomprimiste y el ZIP**.

### Si algo falla

| Qué ves | Qué hacer |
|---|---|
| “No encuentro los archivos de instalación” | No has descomprimido el ZIP. Clic derecho → Extraer todo, y abre el instalador desde la carpeta nueva. |
| Falla la descarga de Node o de las piezas | Es la conexión a internet. Comprueba que navegas bien y vuelve a hacer doble clic en **Instalar WillyPost**: continúa donde se quedó. En una red de empresa o colegio, prueba con otra red (p. ej. el móvil como punto de acceso). |
| “Otro programa está usando el puerto 4747” | Reinicia el ordenador y vuelve a ejecutar el instalador. |
| El texto rojo habla de “scripts” o “directivas” (Windows) | Tu ordenador (de empresa o colegio) bloquea instaladores. Prueba en otro ordenador o escribe a hola@willyseo.net. |
| El navegador dice “No se puede acceder” | Abre el icono **WillyPost** del Escritorio (Windows) o de Launchpad (Mac). Si sigue igual, vuelve a ejecutar el instalador (repara la instalación). |

Cualquier error deja un registro en `%APPDATA%\WillyPost\logs\servidor.log` (Windows) o `~/Library/Application Support/WillyPost/logs/servidor.log` (Mac). Si te atascas, escribe a hola@willyseo.net y adjunta lo que pone la ventana.

---

## Tus primeros pasos

1. **Crea tu cuenta.** Email y contraseña, solo en tu ordenador. Guarda el **código de recuperación** que te muestra: sirve para restablecer la contraseña.
2. **Conecta tu primera red** en **Redes**. Cada red te pide crear tu propio “carné” de desarrollador (gratis, una vez); las [guías](https://nuriaatlantis.github.io/willypost/guias/index.html) te llevan de la mano. Para probar, la más rápida es **Bluesky** (3 minutos).
3. **Programa tu primera publicación** con **+ Crear publicación**.

| Guía | Tiempo |
|---|---|
| [Bluesky](https://nuriaatlantis.github.io/willypost/guias/bluesky.html) | 3 min |
| [LinkedIn](https://nuriaatlantis.github.io/willypost/guias/linkedin.html) | 15 min |
| [Facebook](https://nuriaatlantis.github.io/willypost/guias/facebook.html) | 25 min |
| [Instagram](https://nuriaatlantis.github.io/willypost/guias/instagram.html) | 25 min |
| [Threads](https://nuriaatlantis.github.io/willypost/guias/threads.html) | 20 min |
| [YouTube Shorts](https://nuriaatlantis.github.io/willypost/guias/youtube.html) | 15 min |
| [TikTok](https://nuriaatlantis.github.io/willypost/guias/tiktok.html) | 30 min + revisión de TikTok |
| [Google Business Profile](https://nuriaatlantis.github.io/willypost/guias/gbp.html) | 15 min + aprobación de Google |
| [Claude](https://nuriaatlantis.github.io/willypost/guias/claude.html) | 10 min |

Ojo: **cada 30 días hay que reconectar cada red** (un clic en Redes → Reconectar). Desde el día 25, WillyPost te avisa.

## Conecta Claude

Dentro de WillyPost, abre **Claude** y pulsa **Conectar con Claude Desktop** (o copia el comando para Claude Code). Después, reinicia Claude y pídele, por ejemplo:

> *“Hazme una campaña de Black Friday de 2 semanas para Instagram y TikTok.”*

Por defecto, lo que crea Claude llega como **borrador “Propuesto por Claude”**: tú lo apruebas. Más detalles en la [guía de Claude](https://nuriaatlantis.github.io/willypost/guias/claude.html).

---

## Actualizar

1. Descarga el **ZIP nuevo** y descomprímelo.
2. Vuelve a hacer doble clic en **Instalar WillyPost** (en Mac, igual que la primera vez; si macOS vuelve a avisar, repite el Plan B).

Es seguro: **tus datos se conservan** porque viven aparte, en `%APPDATA%\WillyPost` (Windows) o `~/Library/Application Support/WillyPost` (Mac). Ejecutar el instalador otra vez también sirve para **reparar** una instalación que no arranca.

## Desinstalar

- **Windows:** haz doble clic en **`Desinstalar WillyPost`** (también está en el menú Inicio → WillyPost).
- **Mac:** abre la Terminal, escribe `bash ~/Library/Application\ Support/WillyPost/app/scripts/mac/desinstalar.sh` y pulsa Intro (o abre `Desinstalar WillyPost.command` de la carpeta que descomprimiste, igual que el instalador).

Quita los iconos, el arranque automático y la aplicación. **Antes de borrar tus datos (publicaciones, cuentas conectadas…) te pregunta**, y tienes que escribir `BORRAR` para confirmarlo. Para quitar también los permisos en cada red social, mira [Borrar mis datos](https://nuriaatlantis.github.io/willypost/borrar-datos.html).

## Preguntas frecuentes

**¿Es de verdad gratis?** Sí. Sin cuotas, sin límite de redes, licencia MIT.

**¿Tiene que estar el ordenador encendido?** Sí: WillyPost vive en tu ordenador y publica a la hora programada si está encendido. Si estaba apagado, al arrancar te pregunta qué hacer con lo que se quedó atrás (publicar ahora, reprogramar u omitir).

**¿Por qué tengo que crear mi propio “carné” en cada red?** Porque así tus claves son solo tuyas y no dependes de nadie. Es gratis y se hace una vez por red. Las guías van paso a paso.

**¿Por qué TikTok no publica en abierto?** TikTok exige una auditoría a las apps antes de permitirles publicar en público. Con WillyPost, el vídeo llega a tu bandeja de TikTok y solo tienes que pulsar *Publicar* en la app.

**¿Se abre en el navegador? ¿Es una web?** Se abre en tu navegador, pero funciona **en tu ordenador** (`http://localhost:4747`); no hay ninguna web de WillyPost con tus datos.

**No se abre / el navegador dice “No se puede acceder”.** Haz doble clic en el icono **WillyPost** del Escritorio (o en Launchpad, en Mac). Si sigue igual, vuelve a ejecutar **Instalar WillyPost**: repara la instalación. Los registros están en `%APPDATA%\WillyPost\logs` (Windows) o `~/Library/Application Support/WillyPost/logs` (Mac).

**¿Cómo lo paro?** Casi nunca hace falta: está pensado para estar siempre encendido, en segundo plano. Si quieres pararlo: en Windows, menú Inicio → WillyPost → **Detener WillyPost**; en Mac, abre la Terminal y escribe `bash ~/Library/Application\ Support/WillyPost/app/scripts/mac/detener.sh`. Al abrir el icono de WillyPost se vuelve a arrancar.

**¿Y en Linux?** No hay instalador oficial. Con Node 22.13 o superior: `npm ci --omit=dev` y `npm start`.

**Me he atascado.** Pregunta en la comunidad de la Academia o escribe a hola@willyseo.net.

---

## Para desarrolladores

```bash
npm ci            # dependencias
npm start         # arranca en http://localhost:4747
npm run dev       # con recarga
npm run build:web # recompila la interfaz (web/dist se sube al repo)
npm run mcp       # servidor MCP (stdio) para Claude
```

- Node.js ≥ 22.13 (usa `node:sqlite`). Ejecuta siempre con `node --disable-warning=ExperimentalWarning server/index.js`.
- Estructura y contrato entre módulos: [`SPEC.md`](SPEC.md).
- `scripts/`: instaladores (`windows/*.ps1`, `mac/*.sh`) y `make-icons.mjs` (regenera los iconos con `sharp`).
- `docs/`: web de documentación para **GitHub Pages** (Settings → Pages → *Deploy from a branch* → `main` / `/docs`). La URL del repositorio, la dirección de retorno OAuth y el email de contacto se cambian **solo en `docs/config.js`** (y `RELAY_URL` en `server/config.js` si cambia el dominio de Pages).
- Variables de los instaladores (para pruebas): `DRYRUN=1` (solo muestra lo que haría), `WILLYPOST_APP_DIR`, `WILLYPOST_FORCE=1`, `WILLYPOST_NO_OPEN=1`.
- **Antes de publicar** el repositorio (y cada vez que cambies los scripts), haz `git add` de los archivos modificados y da permiso de ejecución a los scripts de Mac (git no lo guarda por `.gitattributes`):

  ```bash
  git update-index --chmod=+x "Instalar WillyPost.command" "Abrir WillyPost.command" "Desinstalar WillyPost.command"
  git update-index --chmod=+x scripts/mac/*.sh
  ```

  `.gitattributes` se encarga de que `.bat`/`.vbs`/`.ps1` lleguen con CRLF y `.command`/`.sh` con LF.

## Licencia

[MIT](LICENSE) © Willy SEO Academy.

---

*Hecho con cariño por la Willy SEO Academy.*
