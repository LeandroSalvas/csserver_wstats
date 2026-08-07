#!/bin/bash
# watch.sh — gerencia o stack do espectador web (WebRTC), opt-in.
#
# Uso:
#   watch.sh up             Builda e sobe os serviços do espectador (profile watch)
#   watch.sh down           Derruba os serviços do espectador (não toca o resto)
#   watch.sh build          Builda a imagem do proxy (csserver_wstats-watch-main)
#   watch.sh ps             Status dos containers do espectador
#   watch.sh logs [-f] [svc]    Logs (default: watch-main, watch-hltv)
#   watch.sh restart        Reinicia os serviços do espectador
#   watch.sh backup [dest]  Copia valve/valve.zip para backup (default ./backups/)
#   watch.sh restore <zip>  Restaura valve/valve.zip a partir de um backup
#
# O stack principal (servers.sh up / docker compose up) NÃO sobe o espectador:
# os serviços usam o profile "watch" e exigem --profile watch explícito.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WATCH_COMPOSE="-f docker-compose.yml -f docker-compose.servers.yml -f docker-compose.watch.yml"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

compose_watch() {
  (cd "${ROOT}" && docker compose ${WATCH_COMPOSE} --profile watch "$@")
}

require_public_ip() {
  local v
  v="$(grep -E '^WATCH_PUBLIC_IP=' "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  if [ -z "${v:-}" ]; then
    err "WATCH_PUBLIC_IP não definido no .env (IP público para os ICE candidates do WebRTC)."
    return 1
  fi
}

cmd_up() {
  require_public_ip || return 1
  [ -f "${ROOT}/valve/valve.zip" ] || { err "Faltando valve/valve.zip (assets do Half-Life). Veja 'watch.sh backup/restore'."; return 1; }
  compose_watch up -d --build
}

cmd_down() {
  compose_watch down
}

cmd_build() {
  compose_watch build watch-main
}

cmd_ps() {
  compose_watch ps watch-main watch-hltv
}

cmd_status() {
  info "### containers"
  compose_watch ps watch-main watch-hltv
  info ""
  info "### health"
  docker inspect --format '{{.Name}}: {{if .State.Health}}{{.State.Health.Status}}{{else}}sem healthcheck{{end}}' \
    cs16-watch-main cs16-watch-hltv 2>/dev/null
  info ""
  info "### relay HLTV"
  if [ -f "${ROOT}/live/watch/last_hltv_crash.txt" ]; then
    info "último crash do HLTV: $(cat "${ROOT}/live/watch/last_hltv_crash.txt")"
  else
    info "sem registro de crash do HLTV"
  fi
}

cmd_logs() {
  compose_watch logs "$@"
}

cmd_restart() {
  compose_watch restart watch-main watch-hltv
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
  *)         sed -n '2,16p' "$0" | sed 's/^# //'; exit 1 ;;
esac
