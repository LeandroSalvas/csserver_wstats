#!/bin/bash
# watch-mudo.sh — recupera o relay HLTV quando ele fica "mudo"/degradado
# (processo vivo e conectado ao servidor de jogo, mas sem repassar stream
# utilizável ao espectador). Causa raiz conhecida (PATCHES.md §8), recorrente em
# rotação de mapas. Rode a cada minuto via cron:
#
#   * * * * * /home/salvas/csserver_wstats/scripts/watch-mudo.sh
#
# Detecção (proxy watch-main, log "recving N bytes" por pacote UDP):
#   - Saudável: pacotes de jogo (tamanho != 48) a ~10-20/s.
#   - Mudo/degradado: só keepalives de 48 bytes (ou silêncio total, ou um
#     gotejar de ~0.3-0.5/s). O keepalive do HLTV é exatamente 48 bytes a cada
#     ~2s e reseta o teardown de idle do proxy, então nem "HLTV upstream
#     stalled" nem a taxa total separam mudo de saudável — a contagem de
#     pacotes != 48 separa (margem enorme: 16/s vs 0.5/s).
#
# Só age se alguém esteve assistindo recentemente (bridge WebRTC aberta nos
# últimos 10 min). Recuperação: kick do HLTV via RCON (a menos disruptiva — o
# relay reconecta sozinho em ~20s e o handshake netchan novo volta a fluir).
# Docker restart NÃO resolve (comprovado: o relay reiniciou e continuou mudo).
# Se o kick falhar (relay sem conexão de jogo / RCON indisponível), escala para
# restart do container. Falso positivo é inofensivo (blip de ~20s).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

WINDOW_S="${WINDOW_S:-90}"                       # janela de amostragem do stream
GAME_PKT_MIN="${GAME_PKT_MIN:-45}"               # min. de pacotes de jogo (≠48B) na janela (≈0.5/s)
BRIDGE_LOOKBACK_S="${BRIDGE_LOOKBACK_S:-600}"    # alguém assistiu nos últimos N s?
RESTART_COOLDOWN_S="${RESTART_COOLDOWN_S:-300}"  # evita ações em cascata
SERVERS_ID="${SERVERS_ID:-main}"                 # servidor primário (host 27015)
PROXY="cs16-watch-main"
RELAY="cs16-watch-hltv"
LOG="${ROOT}/live/watch/mudo.log"
LAST_ACTION="${ROOT}/live/watch/.mudo_last_action"
COUNT_FILE="${ROOT}/live/watch/.mudo_count"

now_s() { date +%s; }

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >> "$LOG"; }

# Containers existem?
if ! docker inspect "$RELAY" >/dev/null 2>&1 || ! docker inspect "$PROXY" >/dev/null 2>&1; then
  exit 0
fi

# Cooldown: logo após um kick/restart o relay fica mudo por natureza (reconectando).
last_action="$(cat "$LAST_ACTION" 2>/dev/null || true)"
if [ -n "$last_action" ] && [ $(( $(now_s) - last_action )) -lt "$RESTART_COOLDOWN_S" ]; then
  exit 0
fi

# Alguém assistiu recentemente? Sem bridge WebRTC aberta não há o que recuperar.
bridges="$(docker logs --since "${BRIDGE_LOOKBACK_S}s" "$PROXY" 2>&1 | grep -c "Both channels open, starting bridge" || true)"
[ "$bridges" -eq 0 ] && exit 0

# Pacotes de jogo (≠48B) na janela? Se suficientes, o stream está saudável.
game_pkts="$(docker logs --since "${WINDOW_S}s" "$PROXY" 2>&1 | grep -oE "recving [0-9]+" | awk '$2 != 48 {n++} END {print n+0}')"
[ "$game_pkts" -ge "$GAME_PKT_MIN" ] && exit 0

total="$(docker logs --since "${WINDOW_S}s" "$PROXY" 2>&1 | grep -c "recving" || true)"
count=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$COUNT_FILE"
if [ "$count" -ge 3 ]; then
  log "ATENÇÃO: relay ficou mudo ${count} vezes seguidas — se persistir, reiniciar o servidor de jogo (docker compose restart cs16)"
fi

echo "$(now_s)" > "$LAST_ACTION"
log "RELAY MUDO (${game_pkts} pacotes de jogo em ${WINDOW_S}s; total ${total}) — kickando ZueiraHLTV no servidor ${SERVERS_ID}"
kick_out="$("${SCRIPT_DIR}/servers.sh" rcon "${SERVERS_ID}" "kick ZueiraHLTV" 2>&1 | tr -d '\000')"
if printf '%s' "$kick_out" | grep -q "was kicked"; then
  log "kick ok: relay reconectando (ZueiraHLTV)"
else
  log "kick sem efeito — escalando para docker restart ${RELAY}"
  docker restart "$RELAY" >> "$LOG" 2>&1
fi
exit 0
