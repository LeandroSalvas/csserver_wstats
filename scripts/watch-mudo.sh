#!/bin/bash
# watch-mudo.sh — recupera o relay HLTV quando ele fica "mudo"/degradado
# (processo vivo e conectado ao servidor de jogo, mas sem repassar stream
# utilizável ao espectador). Causa raiz conhecida (PATCHES.md §8), recorrente em
# rotação de mapas. Rode a cada minuto via cron:
#
#   * * * * * /home/salvas/csserver_wstats/scripts/watch-mudo.sh
#
# Verifica TODOS os servidores de servers.list (ou só os ids passados):
#   watch-mudo.sh             todos os servidores
#   watch-mudo.sh main zueira2   apenas os ids citados
#
# Detecção (proxy watch-main-<id>, log "recving N bytes" por pacote UDP):
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
SERVERS_LIST="${ROOT}/config/servers.list"

WINDOW_S="${WINDOW_S:-90}"                       # janela de amostragem do stream
GAME_PKT_MIN="${GAME_PKT_MIN:-45}"               # min. de pacotes de jogo (≠48B) na janela (≈0.5/s)
BRIDGE_LOOKBACK_S="${BRIDGE_LOOKBACK_S:-600}"    # alguém assistiu nos últimos N s?
RESTART_COOLDOWN_S="${RESTART_COOLDOWN_S:-300}"  # evita ações em cascata

now_s() { date +%s; }

# Emite id|context por servidor de servers.list (ou só os ids pedidos).
parse_servers() {
  local want="$*" id name host_port map maxplayers rotate context rest
  while IFS=' ' read -r id name host_port map maxplayers rotate context rest; do
    [[ -z "$id" || "$id" =~ ^# ]] && continue
    : "${context:=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '')}"
    if [ -z "$want" ] || [[ " $want " == *" $id "* ]]; then
      printf '%s|%s\n' "$id" "$context"
    fi
  done < "${SERVERS_LIST}"
}

check_server() {
  local id="$1" context="$2"
  local proxy="cs16-watch-main-${id}"
  local relay="cs16-watch-hltv-${id}"
  local log="${ROOT}/live/watch/${id}/mudo.log"
  local last_action="${ROOT}/live/watch/${id}/.mudo_last_action"
  local count_file="${ROOT}/live/watch/${id}/.mudo_count"
  local hltv_name="${context}-hltv"
  mkdir -p "${ROOT}/live/watch/${id}"

  log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*" >> "$log"; }

  # Containers existem?
  if ! docker inspect "$relay" >/dev/null 2>&1 || ! docker inspect "$proxy" >/dev/null 2>&1; then
    return 0
  fi

  # Cooldown: logo após um kick/restart o relay fica mudo por natureza (reconectando).
  local last_action_v
  last_action_v="$(cat "$last_action" 2>/dev/null || true)"
  if [ -n "$last_action_v" ] && [ $(( $(now_s) - last_action_v )) -lt "$RESTART_COOLDOWN_S" ]; then
    return 0
  fi

  # Alguém está assistindo AGORA? Só faz sentido recuperar mudo se há um
  # espectador conectado. "Abriu nos últimos 10 min" gera falso positivo quando
  # o viewer fecha a aba (bridge aberta+fechada na janela → sem espectador). Net
  # de bridges abertas − fechadas na janela > 0 ⇒ sessão ativa.
  local opened closed
  opened="$(docker logs --since "${BRIDGE_LOOKBACK_S}s" "$proxy" 2>&1 | grep -c "Both channels open, starting bridge" || true)"
  closed="$(docker logs --since "${BRIDGE_LOOKBACK_S}s" "$proxy" 2>&1 | grep -cE "Bridge shut down|WebSocket connection closed" || true)"
  [ "$(( opened - closed ))" -le 0 ] && return 0

  # Pacotes de jogo (≠48B) na janela? Se suficientes, o stream está saudável.
  local game_pkts total count
  game_pkts="$(docker logs --since "${WINDOW_S}s" "$proxy" 2>&1 | grep -oE "recving [0-9]+" | awk '$2 != 48 {n++} END {print n+0}')"
  [ "$game_pkts" -ge "$GAME_PKT_MIN" ] && return 0

  total="$(docker logs --since "${WINDOW_S}s" "$proxy" 2>&1 | grep -c "recving" || true)"
  count=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 ))
  echo "$count" > "$count_file"
  if [ "$count" -ge 3 ]; then
    log "ATENÇÃO: relay ficou mudo ${count} vezes seguidas — se persistir, reiniciar o servidor de jogo (docker compose restart cs16${id})"
  fi

  echo "$(now_s)" > "$last_action"
  log "RELAY MUDO (${game_pkts} pacotes de jogo em ${WINDOW_S}s; total ${total}) — kickando ${hltv_name} no servidor ${id}"
  local kick_out
  kick_out="$("${SCRIPT_DIR}/servers.sh" rcon "${id}" "kick ${hltv_name}" 2>&1 | tr -d '\000')"
  if printf '%s' "$kick_out" | grep -q "was kicked"; then
    log "kick ok: relay reconectando (${hltv_name})"
  else
    log "kick sem efeito — escalando para docker restart ${relay}"
    docker restart "$relay" >> "$log" 2>&1
  fi
}

main() {
  local args="${*:-}"
  if [ -z "$args" ]; then
    local line id context
    while read -r line; do
      IFS='|' read -r id context <<< "$line"
      check_server "$id" "$context"
    done < <(parse_servers)
  else
    local id found line_id context line
    for id in $args; do
      found=0
      while read -r line; do
        IFS='|' read -r line_id context <<< "$line"
        if [ "$line_id" = "$id" ]; then
          check_server "$id" "$context"
          found=1
          break
        fi
      done < <(parse_servers)
      [ "$found" -eq 1 ] || { echo "watch-mudo: servidor não encontrado em servers.list: ${id}" >&2; }
    done
  fi
}

main "$@"
exit 0
