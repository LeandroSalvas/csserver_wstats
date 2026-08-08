#!/bin/bash
# watch-mudo.sh — recupera o relay HLTV quando ele fica "mudo" (processo vivo e
# conectado ao servidor de jogo, mas sem repassar dados ao espectador). Causa
# raiz conhecida (PATCHES.md §8), recorrente em rotação de mapas. Rode a cada
# minuto via cron:
#
#   * * * * * /home/salvas/csserver_wstats/scripts/watch-mudo.sh
#
# Detecção: o proxy (watch-main) derruba a bridge quando o upstream fica mudo —
# "HLTV upstream stalled: no UDP data, tearing down bridge" (IDLE_TIMEOUT=25s no
# bridge.rs). Isso só acontece com um browser conectado (a bridge existe por
# cliente WebRTC). Exigimos ainda que NÃO haja "recving" recente (se o stream
# voltou sozinho, não age).
#
# Recuperação: kick do HLTV no servidor de jogo via RCON (a menos disruptiva —
# o relay reconecta sozinho em ~20s). Docker restart NÃO resolve (comprovado:
# o relay reiniciou e continuou mudo); o kick força o handshake netchan novo.
# Se o kick falhar (relay sem conexão de jogo / RCON indisponível), escala para
# restart do container.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STALE_S="${STALE_S:-90}"                        # janela do evento "upstream stalled"
FRESH_S="${FRESH_S:-30}"                        # stream deve estar parado nos últimos FRESH_S
RESTART_COOLDOWN_S="${RESTART_COOLDOWN_S:-300}" # evita ações em cascata
SERVERS_ID="${SERVERS_ID:-main}"                # servidor primário (host 27015)
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

# 1) A bridge foi derrubada por upstream parado (mudo) nos últimos STALE_S?
stalled="$(docker logs --since "${STALE_S}s" "$PROXY" 2>&1 | grep -c "HLTV upstream stalled" || true)"
[ "$stalled" -eq 0 ] && exit 0

# 2) E o stream continua parado agora? Se voltou, não age.
fresh="$(docker logs --since "${FRESH_S}s" "$PROXY" 2>&1 | grep -c "recving" || true)"
[ "$fresh" -gt 0 ] && exit 0

count=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$COUNT_FILE"
if [ "$count" -ge 3 ]; then
  log "ATENÇÃO: relay ficou mudo ${count} vezes seguidas — se persistir, reiniciar o servidor de jogo (docker compose restart cs16)"
fi

echo "$(now_s)" > "$LAST_ACTION"
log "RELAY MUDO (${stalled}x 'HLTV upstream stalled' em ${STALE_S}s) — kickando ZueiraHLTV no servidor ${SERVERS_ID}"
kick_out="$("${SCRIPT_DIR}/servers.sh" rcon "${SERVERS_ID}" "kick ZueiraHLTV" 2>&1 | tr -d '\000')"
if printf '%s' "$kick_out" | grep -q "was kicked"; then
  log "kick ok: relay reconectando (ZueiraHLTV)"
else
  log "kick sem efeito — escalando para docker restart ${RELAY}"
  docker restart "$RELAY" >> "$LOG" 2>&1
fi
exit 0
