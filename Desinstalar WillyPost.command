#!/bin/bash
# WillyPost - doble clic para desinstalar (macOS). Solo lanza scripts/mac/desinstalar.sh
# La primera vez macOS puede avisar de que no puede comprobar el archivo (Gatekeeper). Opciones:
#   - clic derecho sobre este archivo > Abrir > Abrir;  o bien Ajustes del Sistema > Privacidad y seguridad > "Abrir igualmente".
#   - Siempre funciona: abre la Terminal, escribe  bash  (con un espacio), arrastra este archivo a la ventana y pulsa Intro.
cd "$(dirname "$0")" || exit 1
exec /bin/bash "scripts/mac/desinstalar.sh" "$@"
