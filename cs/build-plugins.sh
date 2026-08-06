#!/bin/bash
# Compila os plugins AMX Mod X (.sma) deste repo usando o compilador
# presente na imagem do servidor CS. Gera os .amxx em cs/plugins/.
#
# Uso: ./cs/build-plugins.sh
# Depois: docker compose up -d cs16  (os .amxx são montados no container)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/plugins"

IMAGE="${CS16_IMAGE:-leandrosalvas/cs16_stats}"

cd "$PLUGIN_DIR"

for sma in *.sma; do
  [ -e "$sma" ] || continue
  name="${sma%.sma}"
  echo "Compilando $sma -> $name.amxx ..."
  docker run --rm \
    -v "$PLUGIN_DIR":/src \
    --entrypoint sh \
    "$IMAGE" -c \
      "cd /home/cs16/cstrike/addons/amxmodx/scripting && cp /src/$sma ./$sma && ./amxxpc ./$sma -o/tmp/$name.amxx && cp /tmp/$name.amxx /src/$name.amxx && rm -f ./$sma"
done

echo "OK. Plugins gerados em $PLUGIN_DIR:"
ls -la "$PLUGIN_DIR"/*.amxx
