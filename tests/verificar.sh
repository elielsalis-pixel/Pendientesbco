#!/bin/sh
# Corre todas las verificaciones de Pendientes BCO.
# Uso: sh tests/verificar.sh   (hace falta Node 20 o más nuevo; no instala nada)
# Todos los datos de prueba son inventados.
set -e
cd "$(dirname "$0")/.."
export TZ=America/Argentina/Buenos_Aires

echo "1) Sintaxis del service worker"
node --check sw.js

echo "2) Pruebas de la app"
node --test tests/*.test.js
