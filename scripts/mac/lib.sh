#!/bin/bash
# WillyPost - funciones comunes de los scripts de macOS (se cargan con "source").
# Interruptor de pruebas: DRYRUN=1 -> solo IMPRIME lo que haria, no cambia nada.
# (Compatible con el bash 3.2 que trae macOS.)

WP_PORT="${WILLYPOST_PORT:-4747}"
WP_URL="http://localhost:${WP_PORT}"
WP_HEALTH="http://127.0.0.1:${WP_PORT}/api/health"
WP_LABEL="com.willyseo.willypost"
WP_MIN_NODE_MAJOR=22
WP_MIN_NODE_MINOR=13

WP_SUPPORT_DIR="${HOME}/Library/Application Support/WillyPost"
WP_DATA_DIR="${WILLYPOST_DATA:-$WP_SUPPORT_DIR}"
WP_APP_DIR="${WILLYPOST_APP_DIR:-$WP_SUPPORT_DIR/app}"
WP_LOG_DIR="${WP_DATA_DIR}/logs"
WP_PLIST="${HOME}/Library/LaunchAgents/${WP_LABEL}.plist"
WP_APP_BUNDLE="${HOME}/Applications/WillyPost.app"

DRY=0
if [ "${DRYRUN:-}" = "1" ] || [ "${DRYRUN:-}" = "true" ]; then DRY=1; fi

# ---------- Mensajes ----------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_GRAY=$'\033[90m'; C_MAGENTA=$'\033[35m'; C_BOLD=$'\033[1m'
else
  C_RESET=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_GRAY=''; C_MAGENTA=''; C_BOLD=''
fi

banner() {
  echo ""
  echo "${C_CYAN}  ==================================================${C_RESET}"
  echo "${C_BOLD}     WillyPost  -  by Willy SEO Academy${C_RESET}"
  [ -n "${1:-}" ] && echo "${C_GRAY}     $1${C_RESET}"
  echo "${C_CYAN}  ==================================================${C_RESET}"
  [ "$DRY" = "1" ] && echo "${C_MAGENTA}  MODO PRUEBA (DRYRUN): no se cambia nada, solo se muestra lo que se haría.${C_RESET}"
  echo ""
}
step()  { echo ""; echo "${C_CYAN}  [$1/$2] $3${C_RESET}"; }
ok()    { echo "${C_GREEN}      OK  $1${C_RESET}"; }
info()  { echo "${C_GRAY}      $1${C_RESET}"; }
warn()  { echo "${C_YELLOW}      ! $1${C_RESET}"; }
dry()   { echo "${C_MAGENTA}      [DRYRUN] $1${C_RESET}"; }
fail()  { echo "${C_RED}      X  $1${C_RESET}"; }
die()   { echo ""; fail "$1"; [ -n "${2:-}" ] && echo "${C_YELLOW}      $2${C_RESET}"; echo "${C_GRAY}      Si no consigues arreglarlo, escribe a nuria.olive@gmail.com contando en qué paso se ha parado.${C_RESET}"; echo ""; pause_end; exit 1; }

# Ejecuta (o, en DRYRUN, describe) una accion:  act "descripcion" comando args...
act() {
  local desc="$1"; shift
  if [ "$DRY" = "1" ]; then dry "$desc"; return 0; fi
  "$@"
}

pause_end() {
  # Deja la ventana de Terminal abierta hasta que la persona lea (solo si es interactivo)
  if [ -t 0 ] && [ "${WILLYPOST_NO_PAUSE:-}" != "1" ]; then
    echo ""
    read -r -p "  Pulsa Intro para cerrar esta ventana. " _ || true
  fi
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

show_log_tail() {
  local f="$WP_LOG_DIR/servidor.log"
  if [ -f "$f" ]; then
    echo "${C_GRAY}      Lo último que ha escrito WillyPost:${C_RESET}"
    tail -n 8 "$f" 2>/dev/null | sed 's/^/        /'
  fi
}

rotate_log() {
  # Si el registro crece demasiado, lo aparta (el servicio no lo hace solo)
  local f="$WP_LOG_DIR/servidor.log"
  if [ -f "$f" ] && [ "$(wc -c < "$f" 2>/dev/null || echo 0)" -gt 5000000 ]; then mv -f "$f" "$f.old" 2>/dev/null || true; fi
}

# ---------- Sistema ----------
host_os() { echo "${WILLYPOST_FAKE_OS:-$(uname -s)}"; }

host_arch() {
  # arm64 | x64 (aunque la Terminal vaya bajo Rosetta, devolvemos la arquitectura real del Mac)
  local m; m="$(uname -m)"
  if [ "$m" = "x86_64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then m="arm64"; fi
  if [ "$m" = "x86_64" ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then m="arm64"; fi
  case "$m" in arm64|aarch64) echo "arm64" ;; *) echo "x64" ;; esac
}

macos_major() {
  # Version principal de macOS (14, 15...). Vacio si no se puede saber.
  local v maj; v="$(sw_vers -productVersion 2>/dev/null)"; maj="${v%%.*}"
  case "$maj" in ''|*[!0-9]*) echo ""; return ;; esac
  echo "$maj"
}

node_major_for_os() {
  # Node 24 pide macOS 13.5 o superior; para Mac mas antiguos (11, 12) usamos Node 22, que funciona desde macOS 11.
  local v maj min; v="$(sw_vers -productVersion 2>/dev/null)"; maj="${v%%.*}"; min="${v#*.}"; min="${min%%.*}"
  case "$maj" in ''|*[!0-9]*) echo 24; return ;; esac
  case "$min" in ''|*[!0-9]*) min=0 ;; esac
  if [ "$maj" -ge 14 ] || { [ "$maj" -eq 13 ] && [ "$min" -ge 5 ]; }; then echo 24; else echo 22; fi
}

app_version() {
  # Lee "version" de package.json sin necesitar node
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1/package.json" 2>/dev/null | head -n 1
}

# ---------- Node.js ----------
node_ok() {
  # 0 si "$1" existe y es Node >= 22.13
  [ -x "$1" ] || return 1
  "$1" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>${WP_MIN_NODE_MAJOR}||(a===${WP_MIN_NODE_MAJOR}&&b>=${WP_MIN_NODE_MINOR})?0:1)" >/dev/null 2>&1
}

find_system_node() {
  # Solo usamos un Node "estable" (instalador oficial o Homebrew). Los gestores de versiones (nvm, fnm, volta...)
  # cambian de carpeta cuando se actualizan y romperian el arranque automatico: en ese caso descargamos el nuestro.
  [ "${WILLYPOST_IGNORE_SYSTEM_NODE:-}" = "1" ] && return 1
  local c
  for c in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$c" ] && [ -x "$(dirname "$c")/npm" ] && node_ok "$c" && { echo "$c"; return 0; }
  done
  return 1
}

# Imprime: <fichero.tar.gz> <sha256>   (ultima version de Node LTS adecuada para este Mac)
resolve_node_tarball() {
  local arch sums major
  arch="$(host_arch)"; major="$(node_major_for_os)"
  sums="$(curl -fsSL --max-time 40 "https://nodejs.org/dist/latest-v${major}.x/SHASUMS256.txt")" || return 1
  printf '%s\n' "$sums" | awk -v suf="darwin-${arch}.tar.gz" '$2 ~ suf"$" { print $2, $1; exit }'
}

# ---------- Servidor ----------
wp_healthy() { curl -fs --noproxy '*' --max-time 2 "$WP_HEALTH" 2>/dev/null | grep -Eq '"ok" *: *true'; }

wait_healthy() {
  local secs="${1:-40}" i=0
  while [ "$i" -lt $((secs * 2)) ]; do
    wp_healthy && return 0
    sleep 0.5; i=$((i + 1))
  done
  return 1
}

port_busy() { lsof -nP -iTCP:"$WP_PORT" -sTCP:LISTEN >/dev/null 2>&1; }

agent_loaded() { launchctl print "gui/$(id -u)/${WP_LABEL}" >/dev/null 2>&1; }

agent_unload() {
  local uid; uid="$(id -u)"
  launchctl bootout "gui/${uid}/${WP_LABEL}" >/dev/null 2>&1 || launchctl unload "$WP_PLIST" >/dev/null 2>&1 || true
}

stop_by_port() {
  # Respaldo: si WillyPost responde pero no lo gestiona launchd (p.ej. arrancado a mano), paramos el proceso "node" de ese puerto.
  local pid name
  wp_healthy || return 0
  for pid in $(lsof -nP -iTCP:"$WP_PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u); do
    name="$(ps -p "$pid" -o comm= 2>/dev/null)"
    case "$name" in *node*) kill "$pid" 2>/dev/null || true ;; esac
  done
  sleep 1
}

stop_server() { agent_unload; stop_by_port; }

agent_load() {
  # Carga (o recarga) el LaunchAgent. Funciona en macOS 11+ y con el metodo antiguo como respaldo.
  local uid i; uid="$(id -u)"
  agent_unload
  i=0; while agent_loaded && [ "$i" -lt 10 ]; do sleep 0.5; i=$((i + 1)); done    # bootout tarda un instante
  launchctl enable "gui/${uid}/${WP_LABEL}" >/dev/null 2>&1 || true
  i=0
  while [ "$i" -lt 3 ]; do
    launchctl bootstrap "gui/${uid}" "$WP_PLIST" >/dev/null 2>&1 && return 0
    sleep 1; i=$((i + 1))
  done
  launchctl load -w "$WP_PLIST" >/dev/null 2>&1 && return 0
  return 1
}

start_direct() {
  # Respaldo si launchd no acepta el servicio: arranca el servidor "a mano" en segundo plano (no sobrevive a un reinicio).
  local node_bin; node_bin="$(head -n 1 "$WP_APP_DIR/runtime/node-path.txt" 2>/dev/null)"
  [ -n "$node_bin" ] && [ -x "$node_bin" ] || return 1
  mkdir -p "$WP_LOG_DIR" || return 1
  ( cd "$WP_APP_DIR" && PATH="$(dirname "$node_bin"):$PATH" nohup "$node_bin" --disable-warning=ExperimentalWarning server/index.js >> "$WP_LOG_DIR/servidor.log" 2>&1 < /dev/null & )
}
