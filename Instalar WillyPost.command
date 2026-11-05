#!/bin/bash
# WillyPost - doble clic para instalar (macOS). Solo lanza scripts/mac/instalar.sh
# La primera vez macOS puede bloquearlo porque viene de internet (Gatekeeper). Opciones:
#   - macOS 14 o anterior: clic derecho sobre este archivo > Abrir > Abrir.
#   - macOS 15 o posterior: cierra el aviso (sin "Trasladar a la papelera"), ve a Ajustes del Sistema > Privacidad y seguridad y pulsa "Abrir igualmente".
#   - Siempre funciona: abre la Terminal, escribe  bash  (con un espacio), arrastra este archivo a la ventana y pulsa Intro.
DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
SCRIPT="$DIR/scripts/mac/instalar.sh"
if [ -z "$DIR" ] || ! { : < "$SCRIPT"; } 2>/dev/null; then
  echo ""
  echo "  No encuentro (o macOS no me deja leer) los archivos de WillyPost que van junto a este archivo."
  echo "  - Descomprime el ZIP entero y abre este archivo desde DENTRO de la carpeta descomprimida."
  echo "  - Si macOS preguntó si Terminal puede acceder a Descargas, Escritorio o Documentos y dijiste que no:"
  echo "    Ajustes del Sistema > Privacidad y seguridad > Archivos y carpetas > Terminal, actívalo y vuelve a probar."
  echo ""
  read -r -p "  Pulsa Intro para cerrar esta ventana. " _ || true
  exit 1
fi
cd "$DIR" || exit 1
exec /bin/bash "$SCRIPT" "$@"
