#!/bin/bash
# push-images.sh — builda e publica as imagens do projeto no Docker Hub.
#
# Repositórios (prefixo $DOCKER_USER do .env):
#   $DOCKER_USER/csserver_wstats-cs16        (jogo + plugins + HLTV)
#   $DOCKER_USER/csserver_wstats-api         (API Node)
#   $DOCKER_USER/csserver_wstats-watch-main  (proxy do espectador web)
#
# Uso:
#   push-images.sh [cs16|api|watch-main]     Só uma imagem
#   push-images.sh                           Todas
#
# Tags: latest + $DOCKER_IMAGE_TAG (default: v<AAAAMMDD>-<HHMM>).
# Requer docker login (sudo docker login). Nada de volumes/valve.zip é enviado:
# as imagens são genéricas (valve.zip e configurações entram via volumes).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

env_val() {
  local v
  v="$(grep -E "^$1=" "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  printf '%s' "${v:-$2}"
}

DOCKER_USER="$(env_val DOCKER_USER '')"
[ -n "$DOCKER_USER" ] || { err "DOCKER_USER não definido no .env"; exit 1; }

TAG="$(env_val DOCKER_IMAGE_TAG "$(date +v%Y%m%d-%H%M)")"

push_image() {
  local name="$1" dir="$2"
  info "--- ${DOCKER_USER}/csserver_wstats-${name} (${TAG}) ---"
  docker build -t "${DOCKER_USER}/csserver_wstats-${name}:${TAG}" \
               -t "${DOCKER_USER}/csserver_wstats-${name}:latest" \
               "${ROOT}/${dir}" || { err "build ${name} falhou"; return 1; }
  docker push "${DOCKER_USER}/csserver_wstats-${name}:${TAG}" || { err "push ${name} (${TAG}) falhou"; return 1; }
  docker push "${DOCKER_USER}/csserver_wstats-${name}:latest" || { err "push ${name} (latest) falhou"; return 1; }
  ok "publicado ${DOCKER_USER}/csserver_wstats-${name}:${TAG} e :latest"
}

want="${1:-all}"
case "$want" in
  all)      push_image cs16 cs16 && push_image api api && push_image watch-main watch/webxash3d-proxy ;;
  cs16)     push_image cs16 cs16 ;;
  api)      push_image api api ;;
  watch-main) push_image watch-main watch/webxash3d-proxy ;;
  *)        err "Imagem desconhecida: $want (use cs16, api, watch-main ou nada para todas)"; exit 1 ;;
esac
