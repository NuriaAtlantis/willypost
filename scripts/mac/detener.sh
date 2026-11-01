#!/bin/bash
# WillyPost - para el servicio (y el tunel de medios). Se vuelve a encender al iniciar sesion o con "Abrir WillyPost".
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
echo ""
if [ "$DRY" = "1" ]; then dry "launchctl bootout gui/$(id -u)/$WP_LABEL"; exit 0; fi
if wp_healthy || agent_loaded; then
  stop_server
  echo "${C_GREEN}  WillyPost se ha detenido. Para volver a abrirlo, usa \"Abrir WillyPost\".${C_RESET}"
else
  echo "${C_GRAY}  WillyPost no estaba en marcha.${C_RESET}"
fi
echo ""
