#!/bin/bash
# WillyPost - instalador para macOS (lo lanza "Instalar WillyPost.command").
# - No necesita contraseña de administrador.
# - Se puede ejecutar todas las veces que quieras: sirve para instalar, reparar y actualizar.
# - Variables opcionales: DRYRUN=1 (solo muestra lo que haria), WILLYPOST_APP_DIR, WILLYPOST_FORCE=1, WILLYPOST_NO_OPEN=1.

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
trap on_exit_pause EXIT

SRC="$(cd "$HERE/../.." && pwd)"     # carpeta descomprimida
TOTAL=6
VERSION="$(app_version "$SRC")"; VERSION="${VERSION:-1.0.0}"
NODE_DIR="$WP_APP_DIR/runtime/node"
NODE_BIN=""

banner "Instalador para macOS  (versión $VERSION)"
[ "$DRY" = "1" ] || refuse_root

# ------------------------------------------------------------------ 1. Comprobaciones
step 1 $TOTAL "Comprobando tu Mac..."
if [ ! -f "$SRC/server/index.js" ] || [ ! -f "$SRC/package.json" ]; then
  die "No encuentro los archivos de WillyPost junto a este instalador." "Descomprime TODA la carpeta del ZIP (doble clic sobre el ZIP) y vuelve a abrir \"Instalar WillyPost\" desde la carpeta nueva."
fi
if [ "$(host_os)" != "Darwin" ]; then
  die "Este instalador es para macOS." "En Windows usa \"Instalar WillyPost.bat\"."
fi
command -v curl >/dev/null 2>&1 || die "No encuentro 'curl' en tu Mac." "Es una herramienta que viene con macOS; reinicia el Mac y vuelve a intentarlo."
MACOS_MAJOR="$(macos_major)"
if [ -n "$MACOS_MAJOR" ] && [ "$MACOS_MAJOR" -lt 11 ]; then
  die "WillyPost necesita macOS 11 (Big Sur) o superior." "Tu Mac tiene macOS $(sw_vers -productVersion 2>/dev/null). Actualiza macOS desde Ajustes del Sistema > General > Actualización de software."
fi
ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '') ($(host_arch))"
info "WillyPost se instalará en: $WP_APP_DIR"
info "Tus datos (publicaciones, cuentas...) viven aparte, en: $WP_DATA_DIR"
act "Quitar la marca de cuarentena de macOS de la carpeta descargada: xattr -dr com.apple.quarantine \"$SRC\"" \
  bash -c 'xattr -dr com.apple.quarantine "$1" 2>/dev/null || true' _ "$SRC"
[ "$DRY" = "1" ] || ok "Carpeta desbloqueada (sin avisos de Gatekeeper)."

# ------------------------------------------------------------------ 2. Copiar la aplicacion
step 2 $TOTAL "Copiando WillyPost a su carpeta..."
if wp_healthy; then info "WillyPost estaba abierto: lo paro un momento para actualizarlo."; fi
act "Parar el servicio de WillyPost si está en marcha" stop_server
if [ "$DRY" != "1" ]; then
  if wp_healthy; then
    die "WillyPost sigue abierto y no he conseguido pararlo." "Reinicia el Mac y vuelve a ejecutar el instalador."
  fi
  if port_busy; then
    OWNER="$(port_owner)"; [ -n "$OWNER" ] && info "Programa que lo ocupa: $OWNER"
    die "Otro programa está usando el puerto $WP_PORT, que WillyPost necesita." "Cierra ese programa (o reinicia el Mac) y vuelve a ejecutar el instalador."
  fi
fi
if [ -d "$WP_APP_DIR" ] && [ "$(cd "$SRC" && pwd -P)" = "$(cd "$WP_APP_DIR" && pwd -P)" ]; then
  ok "Ya estás ejecutando el instalador desde la carpeta de instalación."
else
  copy_app() {
    # Antes de tocar nada: que se pueda leer la carpeta descomprimida (macOS puede negar el acceso a Descargas/Escritorio)
    { : < "$SRC/package.json"; } 2>/dev/null || return 1
    mkdir -p "$WP_APP_DIR" || return 1
    if ! { command -v rsync >/dev/null 2>&1 && rsync -a --delete --exclude '/runtime' --exclude 'node_modules' --exclude '.git' --exclude '.DS_Store' "$SRC/" "$WP_APP_DIR/"; }; then
      # Respaldo sin rsync (Apple lo esta sustituyendo por openrsync): vaciar todo salvo runtime y node_modules, y copiar con tar
      local e
      for e in "$WP_APP_DIR"/* "$WP_APP_DIR"/.[!.]*; do
        [ -e "$e" ] || continue
        case "$(basename "$e")" in runtime|node_modules) ;; *) rm -rf "$e" || return 1 ;; esac
      done
      ( cd "$SRC" && tar -cf - --exclude './runtime' --exclude 'node_modules' --exclude '.git' --exclude '.DS_Store' . ) | ( cd "$WP_APP_DIR" && tar -xf - ) || return 1
    fi
    [ -f "$WP_APP_DIR/server/index.js" ] || return 1
    xattr -dr com.apple.quarantine "$WP_APP_DIR" 2>/dev/null || true
    chmod +x "$WP_APP_DIR"/*.command 2>/dev/null || true
  }
  act "Copiar $SRC/  ->  $WP_APP_DIR/  (se conservan runtime y node_modules)" copy_app || die "No he podido copiar WillyPost a $WP_APP_DIR." "Si macOS te preguntó si Terminal puede acceder a la carpeta Descargas (o Escritorio/Documentos) y dijiste que no: Ajustes del Sistema > Privacidad y seguridad > Archivos y carpetas > activa Terminal. Después vuelve a ejecutar el instalador."
  [ "$DRY" = "1" ] || ok "Archivos copiados."
fi

# ------------------------------------------------------------------ 3. Node.js
step 3 $TOTAL "Preparando Node.js (el motor de WillyPost)..."
if node_ok "$NODE_DIR/bin/node"; then
  NODE_BIN="$NODE_DIR/bin/node"
  ok "Node portable ya instalado ($("$NODE_BIN" -p 'process.versions.node'))."
elif SYS_NODE="$(find_system_node)"; then
  NODE_BIN="$SYS_NODE"
  ok "Usando el Node que ya tienes instalado ($("$NODE_BIN" -p 'process.versions.node'))."
else
  NODE_MAJOR="$(node_major_for_os)"
  info "No tienes Node 22.13 o superior. Voy a descargar Node $NODE_MAJOR LTS (portable, no instala nada en tu Mac)."
  RES="$(resolve_node_tarball)" || die "No he podido consultar nodejs.org." "Comprueba tu conexión a internet y vuelve a intentarlo. Si estás en una red de empresa o colegio, prueba con otra red (por ejemplo, el móvil como punto de acceso)."
  [ -n "$RES" ] || die "No encuentro una versión de Node para tu Mac en nodejs.org." "Escribe a nuria.olive@gmail.com indicando tu modelo de Mac."
  NODE_FILE="${RES%% *}"; NODE_SHA="${RES##* }"
  NODE_URL="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/${NODE_FILE}"
  info "Descargando $NODE_FILE"
  download_node() {
    local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/willypost-node.XXXXXX")" || return 1
    curl -fL --retry 3 --progress-bar -o "$tmp/$NODE_FILE" "$NODE_URL" || { rm -rf "$tmp"; return 1; }
    local got; got="$(sha256_of "$tmp/$NODE_FILE")"
    if [ "$got" != "$NODE_SHA" ]; then rm -rf "$tmp"; echo "La descarga de Node está corrupta (la huella no coincide)." >&2; return 1; fi
    tar -xzf "$tmp/$NODE_FILE" -C "$tmp" || { rm -rf "$tmp"; return 1; }
    local inner; inner="$(find "$tmp" -maxdepth 1 -type d -name 'node-v*' | head -n 1)"
    [ -n "$inner" ] || { rm -rf "$tmp"; return 1; }
    rm -rf "$NODE_DIR"; mkdir -p "$(dirname "$NODE_DIR")"
    mv "$inner" "$NODE_DIR" || { rm -rf "$tmp"; return 1; }
    rm -rf "$tmp"
  }
  act "Descargar $NODE_URL (unos 45 MB), comprobar su huella SHA-256 ($NODE_SHA) y descomprimir en $NODE_DIR" download_node || die "No he podido descargar o instalar Node." "Comprueba tu conexión a internet y vuelve a ejecutar el instalador."
  NODE_BIN="$NODE_DIR/bin/node"
  if [ "$DRY" != "1" ]; then
    node_ok "$NODE_BIN" || die "Node se ha descomprimido pero no arranca." "Vuelve a ejecutar el instalador."
    ok "Node instalado en $NODE_DIR"
  fi
fi

# ------------------------------------------------------------------ 4. Dependencias (npm)
step 4 $TOTAL "Instalando las piezas de WillyPost (puede tardar un par de minutos)..."
LOCK="$WP_APP_DIR/package-lock.json"; [ -f "$LOCK" ] || LOCK="$WP_APP_DIR/package.json"
[ "$DRY" = "1" ] && [ -f "$SRC/package-lock.json" ] && LOCK="$SRC/package-lock.json"
STAMP="$WP_APP_DIR/runtime/npm-stamp.txt"
NEED_NPM=1
if [ "$DRY" != "1" ] && [ "${WILLYPOST_FORCE:-}" != "1" ] && [ -f "$STAMP" ] && [ -d "$WP_APP_DIR/node_modules" ]; then
  CUR="$(sha256_of "$LOCK")"
  if [ "$(cat "$STAMP" 2>/dev/null)" = "$CUR" ]; then
    if (cd "$WP_APP_DIR" && "$NODE_BIN" --input-type=module -e "await import('express'); await import('sharp');" >/dev/null 2>&1); then NEED_NPM=0; fi
  fi
fi
if [ "$NEED_NPM" = "0" ]; then
  ok "Las piezas ya estaban instaladas y funcionan."
else
  run_npm() {
    export PATH="$(dirname "$NODE_BIN"):$PATH"
    export npm_config_update_notifier=false
    # Cache propia: si ~/.npm quedo a nombre del administrador (por un "sudo npm" antiguo), npm fallaria con EACCES
    export npm_config_cache="$WP_APP_DIR/runtime/npm-cache"
    cd "$WP_APP_DIR" || return 1
    local good=1
    echo "      Descargando e instalando. No cierres esta ventana."
    if [ -f package-lock.json ]; then
      npm ci --omit=dev --include=optional --no-audit --no-fund --loglevel=error && good=0
      [ "$good" = "0" ] || echo "      ! npm ci no ha funcionado; pruebo con npm install..."
    fi
    if [ "$good" != "0" ]; then npm install --omit=dev --include=optional --no-audit --no-fund --loglevel=error && good=0; fi
    [ "$good" = "0" ] || return 1
    # Comprobacion final: que las piezas (sharp trae programas nativos) arrancan en este Mac
    "$NODE_BIN" --input-type=module -e "await import('express'); await import('sharp');" >/dev/null 2>&1 || { echo "      Las piezas se han descargado pero no arrancan en este Mac." >&2; return 1; }
    mkdir -p runtime
    sha256_of "$LOCK" > "$STAMP"
  }
  if [ -f "$WP_APP_DIR/package-lock.json" ] || { [ "$DRY" = "1" ] && [ -f "$SRC/package-lock.json" ]; }; then NPM_TXT="npm ci --omit=dev  (si falla: npm install --omit=dev)"; else NPM_TXT="npm install --omit=dev"; fi
  act "En $WP_APP_DIR ejecutar: $NPM_TXT" run_npm || die "npm no ha podido instalar las piezas." "Casi siempre es la conexión a internet: comprueba que funciona y vuelve a ejecutar el instalador (repite solo lo que faltaba)."
  [ "$DRY" = "1" ] || ok "Piezas instaladas."
fi
write_nodepath() { mkdir -p "$WP_APP_DIR/runtime" && printf '%s\n' "$NODE_BIN" > "$WP_APP_DIR/runtime/node-path.txt"; }
act "Guardar en runtime/node-path.txt el Node que se usará para arrancar" write_nodepath

# ------------------------------------------------------------------ 5. Arranque automatico + icono
step 5 $TOTAL "Preparando el arranque automático y el icono..."
write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$WP_LOG_DIR" || return 1
  rotate_log
  local node_dir extra_env=""; node_dir="$(dirname "$NODE_BIN")"
  # Si se instalo con una carpeta de datos o un puerto distintos, el servicio debe usar los mismos
  [ -n "${WILLYPOST_DATA:-}" ] && extra_env="${extra_env}
    <key>WILLYPOST_DATA</key>
    <string>$(xml_escape "$WILLYPOST_DATA")</string>"
  [ -n "${WILLYPOST_PORT:-}" ] && extra_env="${extra_env}
    <key>WILLYPOST_PORT</key>
    <string>$(xml_escape "$WILLYPOST_PORT")</string>"
  cat > "$WP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${WP_LABEL}</string>
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>com.willyseo.willypost.launcher</string>
  </array>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$WP_APP_DIR")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$WP_LOG_DIR")/servidor.log</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$WP_LOG_DIR")/servidor.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$node_dir"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>${extra_env}
  </dict>
</dict>
</plist>
PLIST
  plutil -lint "$WP_PLIST" >/dev/null 2>&1 || return 1
  chmod 644 "$WP_PLIST"
}
PLIST_OK=1
if ! act "Crear el servicio de arranque automático: $WP_PLIST  (RunAtLoad, se reinicia solo si falla; registro en $WP_LOG_DIR/servidor.log)" write_plist; then
  PLIST_OK=0; rm -f "$WP_PLIST" 2>/dev/null
  warn "No he podido crear el arranque automático (macOS no deja escribir en ~/Library/LaunchAgents)."
  info "WillyPost funcionará, pero después de reiniciar el Mac tendrás que abrirlo tú con el icono WillyPost o con \"Abrir WillyPost\"."
fi

make_app_bundle() {
  local app="$WP_APP_BUNDLE"
  mkdir -p "$HOME/Applications" || return 1
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" || return 1
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>WillyPost</string>
  <key>CFBundleDisplayName</key><string>WillyPost</string>
  <key>CFBundleIdentifier</key><string>com.willyseo.willypost.launcher</string>
  <key>CFBundleExecutable</key><string>WillyPost</string>
  <key>CFBundleIconFile</key><string>WillyPost</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
  cat > "$app/Contents/MacOS/WillyPost" <<LAUNCH
#!/bin/bash
# Abre WillyPost (arranca el servicio si hace falta). Creado por el instalador de WillyPost.
exec /bin/bash "$WP_APP_DIR/scripts/mac/abrir.sh" --silencioso
LAUNCH
  chmod +x "$app/Contents/MacOS/WillyPost"
  # Icono (.icns) a partir del PNG de 1024 px, con las herramientas que trae macOS
  local png="$WP_APP_DIR/scripts/willypost.png" tmp s
  if [ -f "$png" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/willypost-icon.XXXXXX")"; mkdir -p "$tmp/WillyPost.iconset"
    for s in 16 32 128 256 512; do
      sips -z "$s" "$s" "$png" --out "$tmp/WillyPost.iconset/icon_${s}x${s}.png" >/dev/null 2>&1
      sips -z $((s * 2)) $((s * 2)) "$png" --out "$tmp/WillyPost.iconset/icon_${s}x${s}@2x.png" >/dev/null 2>&1
    done
    iconutil -c icns "$tmp/WillyPost.iconset" -o "$app/Contents/Resources/WillyPost.icns" >/dev/null 2>&1 || true
    rm -rf "$tmp"
  fi
  xattr -cr "$app" 2>/dev/null || true
  # Firma "ad hoc" (sin cuenta de desarrollador): hace que macOS trate la app como una app normal
  command -v codesign >/dev/null 2>&1 && codesign --force --sign - "$app" >/dev/null 2>&1
  touch "$app"
  # Que aparezca ya en Spotlight/Launchpad sin esperar a que macOS la descubra
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" >/dev/null 2>&1 || true
  return 0
}
act "Crear la app $WP_APP_BUNDLE con su icono (aparece en Launchpad y Spotlight; arrástrala al Dock si quieres)" make_app_bundle || warn "No he podido crear el icono de WillyPost (no es grave: puedes usar \"Abrir WillyPost\")."
if [ "$DRY" != "1" ]; then
  [ "$PLIST_OK" = "1" ] && ok "Servicio de arranque automático creado (se enciende solo al iniciar sesión)."
  [ -d "$WP_APP_BUNDLE" ] && ok "App \"WillyPost\" creada en ~/Applications (búscala con Spotlight: Cmd + Espacio)."
fi

# ------------------------------------------------------------------ 6. Arrancar
step 6 $TOTAL "Arrancando WillyPost..."
AGENT_OK=0
if [ "$PLIST_OK" = "1" ]; then
  act "Cargar el servicio: launchctl bootstrap gui/$(id -u) $WP_PLIST" agent_load && AGENT_OK=1
fi
if [ "$DRY" = "1" ]; then
  dry "Esperar a que responda $WP_HEALTH y abrir el navegador en $WP_URL"
  echo ""; echo "${C_MAGENTA}  Fin de la prueba (DRYRUN): no se ha cambiado nada.${C_RESET}"; echo ""
  exit 0
fi
if [ "$AGENT_OK" = "0" ]; then
  if [ "$PLIST_OK" = "1" ]; then
    warn "macOS no ha aceptado el arranque automático; arranco WillyPost de otra forma (esta vez no se encenderá solo al reiniciar)."
    info "Suele pasar si se desactivó WillyPost (puede aparecer como \"node\") en Ajustes del Sistema > General > Ítems de inicio (Permitir en segundo plano). Actívalo y vuelve a ejecutar el instalador."
  fi
  start_direct || true
fi
if wait_healthy 60; then
  ok "WillyPost está funcionando en $WP_URL"
  [ "${WILLYPOST_NO_OPEN:-}" = "1" ] || open "$WP_URL" || warn "No he podido abrir el navegador. Escribe $WP_URL en tu navegador."
else
  echo ""
  show_log_tail
  die "WillyPost no ha llegado a arrancar." "Vuelve a ejecutar este instalador. Si sigue igual, el registro completo está en: $WP_LOG_DIR/servidor.log"
fi

echo ""
echo "${C_GREEN}  ==================================================${C_RESET}"
echo "${C_GREEN}   LISTO. WillyPost ya está instalado.${C_RESET}"
echo "${C_GRAY}   - Se ha abierto en tu navegador: $WP_URL${C_RESET}"
echo "${C_GRAY}   - La próxima vez, busca \"WillyPost\" con Spotlight (Cmd + Espacio) o en Launchpad, o haz doble clic en \"Abrir WillyPost\".${C_RESET}"
echo "${C_GRAY}   - Arranca solo cuando enciendes el Mac. Si macOS avisa de un \"elemento en segundo plano\" (puede llamarse \"node\"), déjalo activado.${C_RESET}"
echo "${C_GRAY}   - Para actualizar: descarga el ZIP nuevo y vuelve a ejecutar \"Instalar WillyPost\".${C_RESET}"
echo "${C_GRAY}   - Puedes borrar la carpeta que descomprimiste: ya no hace falta.${C_RESET}"
echo "${C_GREEN}  ==================================================${C_RESET}"
WP_PAUSED=1; pause_end
exit 0
