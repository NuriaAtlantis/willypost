#!/bin/bash
# WillyPost - abre WillyPost en el navegador (y arranca el servicio si estaba parado).
# Lo usan "Abrir WillyPost.command" y la app WillyPost.app.   --silencioso: sin mensajes en pantalla (usa un aviso de macOS si falla).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
SILENT=0; [ "${1:-}" = "--silencioso" ] && SILENT=1

say() { [ "$SILENT" = "1" ] || echo "$1"; }
alert() {
  if [ "$SILENT" = "1" ]; then
    local m="${1//\"/}"; m="${m//\\/}"
    osascript -e "display alert \"WillyPost\" message \"$m\"" >/dev/null 2>&1 || true
  else
    echo "$C_RED  $1$C_RESET"; pause_end
  fi
}

if [ "$DRY" = "1" ]; then
  echo "[DRYRUN] si no responde $WP_HEALTH: launchctl bootstrap/kickstart gui/$(id -u)/$WP_LABEL, esperar y abrir $WP_URL"; exit 0
fi

if ! wp_healthy; then
  say ""; say "  Arrancando WillyPost..."
  if [ ! -f "$WP_PLIST" ]; then
    alert "WillyPost todavía no está instalado. Haz doble clic en \"Instalar WillyPost\"."
    exit 1
  fi
  if agent_loaded; then launchctl kickstart "gui/$(id -u)/$WP_LABEL" >/dev/null 2>&1 || true; else agent_load || start_direct || true; fi
  if ! wait_healthy 40; then
    if port_busy; then
      alert "WillyPost no ha podido arrancar porque otro programa está usando el puerto $WP_PORT. Reinicia el Mac y vuelve a probar."
    else
      alert "WillyPost no ha podido arrancar. Vuelve a ejecutar \"Instalar WillyPost\" para repararlo. Registro: $WP_LOG_DIR/servidor.log"
    fi
    exit 1
  fi
fi
open "$WP_URL"
say "  Listo: $WP_URL"
