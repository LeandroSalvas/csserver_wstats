#!/bin/bash
# watch.sh — gerencia o stack do espectador web (WebRTC), opt-in.
# Um par watch-main/watch-hltv por servidor de servers.list (ver docker-compose.watch.yml,
# gerado por scripts/servers.sh compose).
#
# Uso:
#   watch.sh up             Builda e sobe os serviços do espectador (profile watch)
#   watch.sh down           Derruba os serviços do espectador (não toca o resto)
#   watch.sh build          Builda a imagem do proxy (csserver_wstats-watch-main)
#   watch.sh ps             Status dos containers do espectador
#   watch.sh logs [-f] [svc]    Logs (default: todos os serviços do espectador)
#   watch.sh restart        Reinicia os serviços do espectador
#   watch.sh backup [dest]  Copia valve/valve.zip para backup (default ./backups/)
#   watch.sh restore <zip>  Restaura valve/valve.zip a partir de um backup
#   watch.sh mudo           Verifica uma vez se o relay HLTV está mudo e reinicia
#                           (para cron/teste; ver scripts/watch-mudo.sh)
#
# O stack principal (servers.sh up / docker compose up) NÃO sobe o espectador:
# os serviços usam o profile "watch" e exigem --profile watch explícito.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# docker-compose.duckdns.yml (swag/duckdns) entra na config para que o
# `up --remove-orphans` NÃO os remova como órfãos; o up lista apenas os
# serviços do espectador, então swag/duckdns não são tocados.
WATCH_COMPOSE="-f docker-compose.yml -f docker-compose.servers.yml -f docker-compose.watch.yml"
[ -f "${ROOT}/docker-compose.duckdns.yml" ] && WATCH_COMPOSE+=" -f docker-compose.duckdns.yml"
SERVERS_LIST="${ROOT}/config/servers.list"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

# Emite uma linha por servidor no formato  id|context|cstv
parse_servers() {
  local id name host_port map maxplayers rotate context mode cstv rest
  while IFS=' ' read -r id name host_port map maxplayers rotate context mode cstv rest; do
    [[ -z "$id" || "$id" =~ ^# ]] && continue
    : "${context:=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '')}"
    : "${cstv:=no}"
    printf '%s|%s|%s\n' "$id" "$context" "$cstv"
  done < "${SERVERS_LIST}"
}

env_val() {
  local v
  v="$(grep -E "^$1=" "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  printf '%s' "${v:-$2}"
}

watch_services() {
  local line id cstv
  while read -r line; do
    IFS='|' read -r id _ cstv <<< "$line"
    [ "$cstv" = "yes" ] || continue
    printf 'watch-main-%s watch-hltv-%s ' "$id" "$id"
  done < <(parse_servers)
}

compose_watch() {
  (cd "${ROOT}" && docker compose ${WATCH_COMPOSE} --profile watch "$@")
}

ensure_compose() {
  [ -f "${ROOT}/docker-compose.watch.yml" ] || { info "gerando docker-compose.watch.yml ..."; "${SCRIPT_DIR}/servers.sh" compose >/dev/null || return 1; }
}

cmd_up() {
  [ -f "${ROOT}/valve/valve.zip" ] || { err "Faltando valve/valve.zip (assets do Half-Life). Veja 'watch.sh backup/restore'."; return 1; }
  ensure_compose || return 1

  # O relay usa a imagem cs16_stats:local; se faltar (imagens deletadas), builda.
  if ! docker image inspect cs16_stats:local >/dev/null 2>&1; then
    info "Imagem cs16_stats:local ausente — construindo ..."
    "${SCRIPT_DIR}/servers.sh" build || return 1
  fi

  # Build explícito só do proxy (sem --build no up, para não reconstruir o
  # cs16 e reiniciar o servidor de jogo). O primeiro watch-main carrega o build
  # no compose; os demais reutilizam a imagem csserver_wstats-watch-main.
  compose_watch build watch-main-main
  compose_watch up -d --remove-orphans $(watch_services)
}

cmd_down() {
  # Só derruba o espectador (com `--profile watch`, o down com a config
  # completa ainda removeria TODO o projeto — api/db/cs16/swag/...).
  compose_watch down $(watch_services)
}

cmd_build() {
  ensure_compose || return 1
  compose_watch build watch-main-main
}

cmd_ps() {
  ensure_compose || return 1
  compose_watch ps
}

cmd_status() {
  ensure_compose || return 1
  info "### containers"
  compose_watch ps

  info ""
  info "### health por servidor"
  local line id context cstv watch_hltv_base watch_listen_base
  watch_hltv_base="$(env_val WATCH_HLTV_BASE 27100)"
  watch_listen_base="$(env_val WATCH_LISTEN_BASE 27200)"
  local i=0
  while read -r line; do
    IFS='|' read -r id context cstv <<< "$line"
    if [ "$cstv" = "yes" ]; then
      printf '%-12s relay:%-5s listen:%-5s path:/%s\n' "${id}" "$(( watch_hltv_base + i ))" "$(( watch_listen_base + i ))" "${context}"
      docker inspect --format '  {{.Name}}: {{if .State.Health}}{{.State.Health.Status}}{{else}}sem healthcheck{{end}}' \
        "cs16-watch-hltv-${id}" "cs16-watch-main-${id}" 2>/dev/null
    fi
    i=$(( i + 1 ))
  done < <(parse_servers)

  info ""
  info "### relay HLTV (último crash por servidor)"
  i=0
  while read -r line; do
    IFS='|' read -r id context cstv <<< "$line"
    if [ "$cstv" = "yes" ]; then
      local crash="${ROOT}/live/watch/${id}/last_hltv_crash.txt"
      if [ -f "$crash" ]; then
        info "  ${id}: $(cat "$crash")"
      else
        info "  ${id}: sem registro de crash"
      fi
    fi
    i=$(( i + 1 ))
  done < <(parse_servers)
}

cmd_logs() {
  ensure_compose || return 1
  compose_watch logs "$@"
}

cmd_restart() {
  ensure_compose || return 1
  compose_watch restart $(watch_services)
}

cmd_backup() {
  local dest="${1:-${ROOT}/backups}"
  mkdir -p "$dest"
  [ -f "${ROOT}/valve/valve.zip" ] || { err "Faltando valve/valve.zip."; return 1; }
  local out="${dest}/valve.zip.$(date +%Y%m%d-%H%M%S)"
  cp "${ROOT}/valve/valve.zip" "$out"
  ok "backup em ${out}"
}

cmd_restore() {
  local src="${1:-}"
  [ -n "$src" ] || { err "Uso: watch.sh restore <arquivo.zip>"; return 1; }
  [ -f "$src" ] || { err "Arquivo não encontrado: ${src}"; return 1; }
  mkdir -p "${ROOT}/valve"
  cp "$src" "${ROOT}/valve/valve.zip"
  ok "valve/valve.zip restaurado de ${src} (reinicie com 'watch.sh up' para recarregar)"
}

cmd="${1:-}"
case "${cmd}" in
  up)        shift; cmd_up "$@" ;;
  down)      shift; cmd_down "$@" ;;
  build)     shift; cmd_build "$@" ;;
  ps)        shift; cmd_ps "$@" ;;
  status)    shift; cmd_status "$@" ;;
  logs)      shift; cmd_logs "$@" ;;
  restart)   shift; cmd_restart "$@" ;;
  backup)    shift; cmd_backup "$@" ;;
  restore)   shift; cmd_restore "$@" ;;
  mudo)      shift; exec "${SCRIPT_DIR}/watch-mudo.sh" "$@" ;;
  *)         sed -n '2,16p' "$0" | sed 's/^# //'; exit 1 ;;
esac
