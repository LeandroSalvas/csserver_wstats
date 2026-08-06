#!/bin/bash
# setup.sh — assistente interativo para configurar os servidores CS 1.6.
#
# Pergunta quantos servidores você quer, o nome de cada um, se deseja rotação
# de mapas (e quais mapas entram na rotação) e cuida de gerar config/servers.list,
# criar os arquivos de config/live e subir toda a stack.
#
# Uso:
#   ./scripts/setup.sh          Assiste adicionar/remover servidores e sobe a stack
#   ./scripts/setup.sh --no-up  Só gera servers.list + config/live (não sobe a stack)
#   ./scripts/setup.sh --yes    Modo não-interativo (usa defaults p/ campos em branco)
#   ./scripts/setup.sh -h       Ajuda
#
# O arquivo config/servers.list continua sendo a fonte de verdade: edite à mão
# e rode `./scripts/servers.sh up` se preferir não usar o assistente.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVERS_LIST="${ROOT}/config/servers.list"
SERVERS_SH="${SCRIPT_DIR}/servers.sh"
COMPOSE_BASE="docker-compose.yml"
OVERRIDE="docker-compose.servers.yml"

NO_UP=0
YES_MODE=0
PRUNE_IDS=""

CUR_IDS=() CUR_NAMES=() CUR_PORTS=() CUR_MAPS=() CUR_SLOTS=() CUR_ROTATE=()
NEW_IDS=() NEW_NAMES=() NEW_PORTS=() NEW_MAPS=() NEW_SLOTS=() NEW_ROTATE=()
NEW_CYCLE=()

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

load_current() {
  CUR_IDS=() CUR_NAMES=() CUR_PORTS=() CUR_MAPS=() CUR_SLOTS=() CUR_ROTATE=()
  [ -f "${SERVERS_LIST}" ] || return 0
  local line
  while IFS=' ' read -r id name host_port map maxplayers rotate rest; do
    [[ -z "$id" || "$id" =~ ^# ]] && continue
    CUR_IDS+=("$id") CUR_NAMES+=("$name") CUR_PORTS+=("$host_port")
    CUR_MAPS+=("$map") CUR_SLOTS+=("$maxplayers") CUR_ROTATE+=("${rotate:-yes}")
  done < "${SERVERS_LIST}"
}

slug() {
  printf '%s\n' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'
}

next_free_port() {
  local p=27014 used=" ${NEW_PORTS[*]} "
  while true; do
    p=$((p + 1))
    [[ "$used" == *" $p "* ]] || break
  done
  printf '%s\n' "$p"
}

is_in_array() {
  local needle="$1"; shift
  local v
  for v in "$@"; do [ "$v" = "$needle" ] && return 0; done
  return 1
}

ask() {
  local msg="$1" def="${2:-}" var="$3" _ans
  if [ "$YES_MODE" -eq 1 ]; then
    printf -v "$var" '%s' "$def"
    return 0
  fi
  if [ -n "$def" ]; then
    read -r -p "${msg} [${def}]: " _ans
  else
    read -r -p "${msg}: " _ans
  fi
  printf -v "$var" '%s' "${_ans:-$def}"
}

# Lista os mapas disponíveis na imagem (home/cs16/cstrike/maps/*.bsp).
# Fallback: mapas de config/mapcycle.txt (rotação curada, garantidamente instalados).
get_available_maps() {
  local img maps
  for img in cs16_stats:local leandrosalvas/cs16_stats:latest; do
    if docker image inspect "$img" >/dev/null 2>&1; then
      maps="$(docker run --rm --entrypoint ls "$img" /home/cs16/cstrike/maps/ 2>/dev/null | sed -n 's/\.bsp$//p' | LC_ALL=C sort -u)"
      if [ -n "$maps" ]; then
        printf '%s\n' "$maps"
        return 0
      fi
    fi
  done
  if [ -f "${ROOT}/config/mapcycle.txt" ]; then
    err "Aviso: imagem cs16_stats indisponível; usando os mapas de config/mapcycle.txt."
    sed '/^[[:space:]]*$/d' "${ROOT}/config/mapcycle.txt"
    return 0
  fi
  err "Não foi possível listar mapas (rode 'docker compose up --build' antes)."
  return 1
}

# Pergunta quais mapas entram na rotação. Sucesso: adiciona a lista (uma por linha)
# em NEW_CYCLE na posição correspondente ao servidor #idx.
prompt_map_selection() {
  local idx="$1" avail=() cur=() out=() sel=() ans="" mark n tok i line
  local avail_list
  avail_list="$(get_available_maps)" || return 1
  mapfile -t avail <<< "$avail_list"
  [ "${#avail[@]}" -gt 0 ] || return 1

  cur=()
  while read -r line; do
    [ -z "$line" ] && continue
    cur+=("$line")
  done < "${ROOT}/config/mapcycle.txt"

  info ""
  info "Mapas disponíveis para a rotação do servidor #${idx}:"
  for i in "${!avail[@]}"; do
    mark=""
    is_in_array "${avail[$i]}" "${cur[@]}" && mark=" *"
    printf '   %2d. %s%s\n' "$((i + 1))" "${avail[$i]}" "$mark"
  done
  info "  (* = rotação atual em config/mapcycle.txt)"

  ask "Números dos mapas da rotação (vírgula; Enter = manter os curados)" "" ans
  if [ -z "$ans" ]; then
    out=("${cur[@]}")
  else
    IFS=',' read -r -a sel <<< "$(printf '%s' "$ans" | tr -d ' ')"
    for tok in "${sel[@]}"; do
      [[ "$tok" =~ ^[0-9]+$ ]] || { err "Número inválido: '$tok'"; continue; }
      n=$((tok - 1))
      [ "$n" -lt "${#avail[@]}" ] || { err "Número fora da lista: $tok"; continue; }
      out+=("${avail[$n]}")
    done
  fi
  [ "${#out[@]}" -gt 0 ] || { err "Nenhum mapa selecionado para a rotação."; return 1; }

  NEW_CYCLE+=("$(printf '%s\n' "${out[@]}")")
  info "  rotação: ${out[*]}"
}

prompt_new_server() {
  local idx="$1" name port map slots id rotate rotate_ans is_primary=0
  [ "${#NEW_IDS[@]}" -eq 0 ] && is_primary=1

  while :; do
    if [ "$YES_MODE" -eq 1 ]; then
      name="$( [ "$is_primary" -eq 1 ] && echo Main || echo "Servidor${idx}" )"
    else
      if [ "$is_primary" -eq 1 ]; then
        ask "Nome do servidor #${idx} (primário)" "Main" name
      else
        ask "Nome do servidor #${idx}" "" name
      fi
      [ -n "$name" ] || { err "Nome não pode ser vazio."; continue; }
      [[ "$name" == *" "* ]] && { err "Nome não pode conter espaços (use _ se necessário)."; continue; }
    fi

    if [ "$is_primary" -eq 1 ]; then
      id="main"
    else
      id="$(slug "$name")"
      [ -n "$id" ] || { err "Nome sem caracteres válidos para id."; continue; }
    fi
    if is_in_array "$id" "${NEW_IDS[@]}"; then
      err "Já existe servidor com id '${id}'. Use um nome diferente."
      continue
    fi
    break
  done

  if [ "$YES_MODE" -eq 1 ]; then
    rotate="yes"
  else
    while :; do
      ask "Rotacionar mapas no servidor #${idx}? (n = só o mapa escolhido)" "S" rotate_ans
      case "$rotate_ans" in
        s|S|sim|SIM|y|Y|yes|YES) rotate="yes"; break ;;
        n|N|nao|não|NÃO|no|NO) rotate="no"; break ;;
        *) err "Responda S (sim) ou n (não)." ;;
      esac
    done
  fi

  ask "Porta host do servidor #${idx}" "$(next_free_port)" port
  ask "Mapa inicial do servidor #${idx}" "de_dust2" map
  ask "Slots do servidor #${idx}" "32" slots

  if is_in_array "$port" "${NEW_PORTS[@]}"; then
    err "Aviso: porta ${port} já usada por outro servidor desta lista."
  fi

  NEW_IDS+=("$id") NEW_NAMES+=("$name") NEW_PORTS+=("$port")
  NEW_MAPS+=("$map") NEW_SLOTS+=("$slots") NEW_ROTATE+=("$rotate")
  info "  -> id=${id} nome=${name} porta=${port} mapa=${map} slots=${slots} rotacao=${rotate}"

  if [ "$rotate" = "yes" ]; then
    if [ "$YES_MODE" -eq 1 ]; then
      NEW_CYCLE+=("")
    else
      while ! prompt_map_selection "$idx"; do
        info "Nenhum mapa selecionado. Tente novamente ou pressione Ctrl+C para cancelar."
      done
    fi
  else
    NEW_CYCLE+=("")
  fi
}

build_new_list() {
  local count="$1" total="${#CUR_IDS[@]}"
  NEW_ROTATE=() NEW_CYCLE=()

  # redução: escolhe quais remover
  if [ "$count" -lt "$total" ]; then
    local to_remove=$((total - count)) i default_list="" ans_rm removed_ids=() sel=() tok n
    info ""
    info "Servidores atuais:"
    for i in $(seq 1 "$total"); do
      info "  ${i}. ${CUR_IDS[$((i - 1))]}  ${CUR_NAMES[$((i - 1))]}  porta ${CUR_PORTS[$((i - 1))]}"
    done
    for i in $(seq $((count + 1)) "$total"); do default_list="${default_list}${i},"; done
    default_list="${default_list%,}"

    while [ "${#removed_ids[@]}" -ne "$to_remove" ]; do
      removed_ids=()
      ask "Quais remover? (números separados por vírgula)" "$default_list" ans_rm
      IFS=',' read -r -a sel <<< "$(printf '%s' "${ans_rm}" | tr -d ' ')"
      for tok in "${sel[@]}"; do
        [[ "$tok" =~ ^[0-9]+$ ]] || { err "Número inválido: '$tok'"; continue; }
        n=$((tok - 1))
        [ "$n" -lt "$total" ] || { err "Número fora da lista: $tok"; continue; }
        if [ "$n" -eq 0 ]; then err "Não é possível remover o primário 'main'."; continue; fi
        if ! is_in_array "${CUR_IDS[$n]}" "${removed_ids[@]}"; then
          removed_ids+=("${CUR_IDS[$n]}")
        fi
      done
      [ "${#removed_ids[@]}" -eq "$to_remove" ] || err "Selecione exatamente $to_remove servidor(es)."
    done

    local k nb=() nm=() np=() nma=() ns=() nr=()
    for i in $(seq 0 $((total - 1))); do
      is_in_array "${CUR_IDS[$i]}" "${removed_ids[@]}" && continue
      nb+=("${CUR_IDS[$i]}") nm+=("${CUR_NAMES[$i]}") np+=("${CUR_PORTS[$i]}")
      nma+=("${CUR_MAPS[$i]}") ns+=("${CUR_SLOTS[$i]}") nr+=("${CUR_ROTATE[$i]:-yes}")
    done
    NEW_IDS=("${nb[@]}") NEW_NAMES=("${nm[@]}") NEW_PORTS=("${np[@]}")
    NEW_MAPS=("${nma[@]}") NEW_SLOTS=("${ns[@]}") NEW_ROTATE=("${nr[@]}")
    local kc
    for kc in "${NEW_IDS[@]}"; do NEW_CYCLE+=(""); done

    info ""
    info "Servidores que serão removidos: ${removed_ids[*]}"
    ask "Apagar config/servers e live desses ids? (m=manter, a=apagar)" "m" prune_ans
    case "$prune_ans" in
      a|A|apagar|sim|s) PRUNE_IDS="${removed_ids[*]}" ;;
      *) PRUNE_IDS="" ;;
    esac
    return 0
  fi

  # preserva os atuais na ordem
  local i
  for i in $(seq 0 $((total - 1))); do
    NEW_IDS+=("${CUR_IDS[$i]}") NEW_NAMES+=("${CUR_NAMES[$i]}") NEW_PORTS+=("${CUR_PORTS[$i]}")
    NEW_MAPS+=("${CUR_MAPS[$i]}") NEW_SLOTS+=("${CUR_SLOTS[$i]}") NEW_ROTATE+=("${CUR_ROTATE[$i]:-yes}")
    NEW_CYCLE+=("")
  done

  # adição até chegar no count
  while [ "${#NEW_IDS[@]}" -lt "$count" ]; do
    info ""
    prompt_new_server "$(( ${#NEW_IDS[@]} + 1 ))"
  done
}

write_list() {
  local tmp="${SERVERS_LIST}.tmp"
  {
    echo "# Lista de servidores CS 1.6 gerenciados pelo docker-compose."
    echo "# Formato: id hostname host_port map maxplayers rotate"
    echo "# - A primeira linha é o servidor primário (id \"main\"), usado por snapshots/rankings e partidas."
    echo "# - host_port é a porta publicada no host (mapeada para a porta interna 27015 do container)."
    echo "# - rotate: yes = rotação de mapas (lista em config/servers/<id>/mapcycle.txt); no = só o mapa escolhido."
    echo "# - Edite à mão e rode: scripts/servers.sh up  — ou use scripts/setup.sh (interativo)."
    local i
    for i in "${!NEW_IDS[@]}"; do
      printf '%s %s %s %s %s %s\n' \
        "${NEW_IDS[$i]}" "${NEW_NAMES[$i]}" "${NEW_PORTS[$i]}" "${NEW_MAPS[$i]}" "${NEW_SLOTS[$i]}" "${NEW_ROTATE[$i]:-yes}"
    done
  } > "$tmp"
  mv "$tmp" "${SERVERS_LIST}"
  ok "servers.list atualizado (${#NEW_IDS[@]} servidores)."
}

# Grava o mapcycle.txt dos servidores novos com rotação customizada (escolhida
# no assistente). O init preserva o arquivo se já existir.
write_server_mapcycles() {
  local i cycle n
  for i in "${!NEW_IDS[@]}"; do
    cycle="${NEW_CYCLE[$i]:-}"
    [ -n "$cycle" ] || continue
    mkdir -p "${ROOT}/config/servers/${NEW_IDS[$i]}"
    printf '%s\n' "$cycle" > "${ROOT}/config/servers/${NEW_IDS[$i]}/mapcycle.txt"
    n="$(printf '%s\n' "$cycle" | wc -l)"
    ok "gerado config/servers/${NEW_IDS[$i]}/mapcycle.txt (${n} mapa(s) de rotação)"
  done
}

usage() {
  sed -n '1,15p' "${BASH_SOURCE[0]}"
}

main() {
  load_current
  local total="${#CUR_IDS[@]}"

  info "=== Configuração de servidores CS 1.6 ==="
  if [ "$total" -eq 0 ]; then
    info "Nenhum servidor configurado ainda."
  else
    info "Servidores atuais:"
    local i
    for i in $(seq 1 "$total"); do
      info "  ${i}. ${CUR_IDS[$((i - 1))]}  ${CUR_NAMES[$((i - 1))]}  porta ${CUR_PORTS[$((i - 1))]}  mapa ${CUR_MAPS[$((i - 1))]}  slots ${CUR_SLOTS[$((i - 1))]}  rota ${CUR_ROTATE[$((i - 1))]:-yes}"
    done
  fi

  ask "Quantos servidores você quer no total?" "$total" count
  [[ "$count" =~ ^[0-9]+$ ]] && [ "$count" -ge 1 ] || { err "Informe um número inteiro >= 1."; return 1; }

  build_new_list "$count" || return 1

  info ""
  info "=== Nova configuração ==="
  local i
  for i in "${!NEW_IDS[@]}"; do
    info "  $((i + 1)). ${NEW_IDS[$i]}  ${NEW_NAMES[$i]}  porta ${NEW_PORTS[$i]}  mapa ${NEW_MAPS[$i]}  slots ${NEW_SLOTS[$i]}  rota ${NEW_ROTATE[$i]:-yes}"
  done

  if [ "$YES_MODE" -ne 1 ]; then
    read -r -p "Confirma gerar e aplicar? [S/n] " confirm
    [[ "${confirm:-S}" =~ ^(s|S|sim|SIM|y|Y|yes|YES|)$ ]] || { info "Cancelado."; return 0; }
  fi

  write_list
  write_server_mapcycles
  "${SERVERS_SH}" init || return 1
  "${SERVERS_SH}" compose || return 1

  if [ -n "${PRUNE_IDS}" ]; then
    # shellcheck disable=SC2086
    "${SERVERS_SH}" prune --yes ${PRUNE_IDS}
  fi

  if [ "$NO_UP" -eq 1 ]; then
    info "Configuração gerada (--no-up). Rode ./scripts/servers.sh up para subir a stack."
    return 0
  fi

  local missing=0 img
  for img in cs16_stats:local csserver_wstats-api; do
    docker image inspect "$img" >/dev/null 2>&1 || { err "Imagem ${img} ausente"; missing=1; }
  done
  if [ "$missing" -eq 1 ]; then
    info "Construindo imagens (primeira vez) ..."
    "${SERVERS_SH}" build || return 1
  fi

  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" up -d --remove-orphans
  info ""
  info "Stack no ar. Veja o status com:"
  info "  ./scripts/servers.sh status"
  info "  ./scripts/servers.sh rcon <id> status"
}

for arg in "$@"; do
  case "$arg" in
    --no-up) NO_UP=1 ;;
    --yes) YES_MODE=1 ;;
    -h|--help|help) usage; exit 0 ;;
    *) err "Opção desconhecida: $arg"; usage; exit 1 ;;
  esac
done

main
