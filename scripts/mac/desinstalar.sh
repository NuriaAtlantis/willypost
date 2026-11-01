#!/bin/bash
# WillyPost - desinstalador para macOS (lo lanza "Desinstalar WillyPost.command").
# Quita el arranque automatico, la app y la carpeta de la aplicacion. Tus datos solo se borran si lo confirmas.
# DRYRUN=1 -> solo muestra lo que haria.   WILLYPOST_YES=1 -> responde "si" a la primera pregunta.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"

SRC="$(cd "$HERE/../.." && pwd -P)"   # carpeta desde la que se ejecuta (antes de borrar nada)
banner "Desinstalador para macOS"
echo "  Voy a quitar WillyPost de este Mac:"
echo "${C_GRAY}    - el arranque automático (LaunchAgent)${C_RESET}"
echo "${C_GRAY}    - la app WillyPost de ~/Applications${C_RESET}"
echo "${C_GRAY}    - la aplicación (en $WP_APP_DIR)${C_RESET}"
echo "${C_GRAY}  Tus publicaciones y cuentas conectadas NO se tocan, salvo que lo pidas después.${C_RESET}"
echo ""
if [ "${WILLYPOST_YES:-}" != "1" ] && [ "$DRY" != "1" ]; then
  read -r -p "  ¿Quieres desinstalar WillyPost? (escribe S para continuar) " A || A=""
  case "$A" in s|S|si|SI|Si|sI|sí|SÍ|Sí|sÍ|y|Y|yes|YES|Yes) ;; *) echo "${C_GREEN}  Vale, no he cambiado nada.${C_RESET}"; pause_end; exit 0 ;; esac
fi

step 1 4 "Parando WillyPost..."
act "launchctl bootout gui/$(id -u)/$WP_LABEL" stop_server
[ "$DRY" = "1" ] || ok "Detenido."

step 2 4 "Quitando el arranque automático y el icono..."
act "Borrar $WP_PLIST" rm -f "$WP_PLIST"
act "Borrar $WP_APP_BUNDLE" rm -rf "$WP_APP_BUNDLE"
[ "$DRY" = "1" ] || ok "Arranque automático e icono eliminados."

step 3 4 "Tus datos"
info "Están en: $WP_DATA_DIR"
info "Ahí viven tus publicaciones, tus cuentas conectadas y tus claves de desarrollador."
DELETE_DATA=0
if [ -d "$WP_DATA_DIR" ]; then
  if [ "${WILLYPOST_DELETE_DATA:-}" = "1" ]; then DELETE_DATA=1
  elif [ "${WILLYPOST_YES:-}" != "1" ] && [ "$DRY" != "1" ]; then
    echo ""
    echo "${C_YELLOW}  ¿Quieres BORRAR también tus datos? No se puede deshacer.${C_RESET}"
    echo "${C_YELLOW}  Si vas a reinstalar WillyPost más adelante, es mejor conservarlos.${C_RESET}"
    read -r -p "  Escribe BORRAR para eliminarlos, o pulsa Intro para conservarlos: " B || B=""
    [ "$B" = "BORRAR" ] && DELETE_DATA=1
  fi
else
  info "No hay datos guardados."
fi

step 4 4 "Quitando la aplicación..."
# Seguridad: solo borramos rutas que terminen exactamente como esperamos
case "$WP_APP_DIR" in
  */WillyPost/app) act "Borrar la carpeta de la aplicación $WP_APP_DIR" rm -rf "$WP_APP_DIR"; [ "$DRY" = "1" ] || ok "Aplicación eliminada." ;;
  *) warn "No borro $WP_APP_DIR porque no parece la carpeta de instalación de WillyPost." ;;
esac
if [ "$DELETE_DATA" = "1" ]; then
  case "$WP_DATA_DIR" in
    */WillyPost|*/.willypost) act "Borrar la carpeta de datos $WP_DATA_DIR" rm -rf "$WP_DATA_DIR"; [ "$DRY" = "1" ] || ok "Datos eliminados." ;;
    *) warn "No borro $WP_DATA_DIR porque no parece la carpeta de datos de WillyPost." ;;
  esac
elif [ -d "$WP_DATA_DIR" ]; then
  ok "Datos conservados. Si algún día quieres borrarlos, elimina esa carpeta."
fi
if [ "$SRC" != "$WP_APP_DIR" ]; then
  info "La carpeta que descomprimiste ($SRC) puedes borrarla tú cuando quieras."
fi

echo ""
echo "${C_GREEN}  ==================================================${C_RESET}"
echo "${C_GREEN}   WillyPost se ha desinstalado. ¡Gracias por probarlo!${C_RESET}"
echo "${C_GRAY}   Recuerda quitar también el permiso en cada red social si lo conectaste:${C_RESET}"
echo "${C_GRAY}   https://nuriaatlantis.github.io/willypost/borrar-datos.html${C_RESET}"
echo "${C_GREEN}  ==================================================${C_RESET}"
pause_end
