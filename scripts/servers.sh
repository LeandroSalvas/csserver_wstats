#!/bin/bash
# servers.sh — provisiona e gerencia múltiplos servidores CS 1.6.
#
# Uso:
#   servers.sh init          Cria config/servers/<id>/* e live/<id>/* a partir de servers.list
#   servers.sh compose       Gera docker-compose.servers.yml (override)
#   servers.sh config        Valida o compose mergeado
#   servers.sh build         Builda as imagens cs16_stats:local e csserver_wstats-api
#   servers.sh up            init + compose + docker compose up -d --remove-orphans (rebuilda só se a imagem não existir)
#   servers.sh down          docker compose down
#   servers.sh ps            docker compose ps
#   servers.sh status        Resumo dos servidores configurados
#   servers.sh list          Mostra config/servers.list
#   servers.sh prune [ids]   Apaga config/servers/<id> e live/<id> (default: ids fora do servers.list). --metrics remove também os dados do Prometheus/Grafana
#   servers.sh rcon <id> <cmd>   Executa comando RCON no servidor <id>
#
# O servidor primário (primeira linha de servers.list) mantém o id "main" e é o
# único usado por snapshots/rankings e pelo registro de partidas (cs_matches).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVERS_LIST="${ROOT}/config/servers.list"
TEMPLATE_CFG="${ROOT}/config/templates/server.cfg"
COMPOSE_BASE="docker-compose.yml"
OVERRIDE="docker-compose.servers.yml"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

# Ids de servidor viram nomes de diretório/serviço: só a-z0-9, _ e -.
valid_id() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
}

# Contexts viram paths de URL (ex.: /zueira): só a-z0-9 (sem _ e -).
valid_context() {
  [[ "$1" =~ ^[a-z0-9]+$ ]]
}

# Converte um nome em slug de contexto de URL (lowercase, sem _ - . etc).
slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' ''
}

get_rcon_password() {
  local v
  v="$(grep -E '^RCON_PASSWORD=' "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  printf '%s' "${v:-}"
}

# Emite uma linha por servidor no formato  id|name|host_port|map|maxplayers|rotate|context
parse_servers() {
  local id name host_port map maxplayers rotate context rest
  while IFS=' ' read -r id name host_port map maxplayers rotate context rest; do
    [[ -z "$id" || "$id" =~ ^# ]] && continue
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    printf '%s|%s|%s|%s|%s|%s|%s\n' "$id" "$name" "$host_port" "$map" "$maxplayers" "$rotate" "$context"
  done < "${SERVERS_LIST}"
}

# Lê valores do .env (WATCH_* bases de porta do espectador, etc.).
env_val() {
  local v
  v="$(grep -E "^$1=" "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  printf '%s' "${v:-$2}"
}

cmd_init() {
  [ -f "${SERVERS_LIST}" ] || { err "Faltando ${SERVERS_LIST}"; return 1; }
  [ -f "${TEMPLATE_CFG}" ] || { err "Faltando ${TEMPLATE_CFG}"; return 1; }

  local rcon_pass
  rcon_pass="$(get_rcon_password)"
  [ -n "$rcon_pass" ] || { err "RCON_PASSWORD não encontrado no .env"; return 1; }

  local changed=0 index=0
  while read -r line; do
    local id name host_port map maxplayers rotate context
    IFS='|' read -r id name host_port map maxplayers rotate context <<< "$line"
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"

    valid_id "$id" || { err "id inválido em servers.list: '$id' (use apenas a-z0-9, _ e -)."; return 1; }
    valid_context "$context" || { err "context inválido em servers.list para '$id': '$context' (use apenas a-z0-9)."; return 1; }

    # vagas visíveis devem ser par (CS 1.6 aceita no máximo 32) — o compose soma +1 (reserva do HLTV)
    if ! [[ "$maxplayers" =~ ^[0-9]+$ ]] || [ $((maxplayers % 2)) -ne 0 ] || [ "$maxplayers" -lt 2 ] || [ "$maxplayers" -gt 32 ]; then
      err "Slots visíveis inválidos em servers.list para '$id': '$maxplayers' (use par entre 2 e 32)."
      return 1
    fi

    mkdir -p "${ROOT}/config/servers/${id}"
    mkdir -p "${ROOT}/live/${id}"

    local out="${ROOT}/config/servers/${id}/server.cfg"
    if [ ! -f "$out" ]; then
      sed -e "s|__HOSTNAME__|${name}|g" -e "s|__RCON_PASSWORD__|${rcon_pass}|g" \
        -e "s|__SERVER_ID__|${id}|g" -e "s|__RANKBOTS__|0|g" \
        -e "s|__VISIBLE_MAXPLAYERS__|${maxplayers}|g" \
        "${TEMPLATE_CFG}" > "$out"
      ok "gerado ${out}"
      changed=1
    fi

    local f
    for f in users.ini motd.txt; do
      if [ ! -f "${ROOT}/config/servers/${id}/${f}" ]; then
        cp "${ROOT}/config/${f}" "${ROOT}/config/servers/${id}/${f}"
        ok "gerado config/servers/${id}/${f}"
        changed=1
      fi
    done

    # mapcycle.txt: rotate=no força só o mapa escolhido; rotate=yes preserva a
    # lista por servidor (criada pelo assistente) e só cria a padrão se faltar.
    local mc_dst="${ROOT}/config/servers/${id}/mapcycle.txt"
    if [ "$rotate" = "no" ]; then
      local mc_tmp="${mc_dst}.tmp"
      printf '%s\n' "$map" > "$mc_tmp"
      if [ ! -f "$mc_dst" ] || ! cmp -s "$mc_tmp" "$mc_dst"; then
        mv "$mc_tmp" "$mc_dst"
        ok "gerado config/servers/${id}/mapcycle.txt (sem rotação, só ${map})"
        changed=1
      else
        rm -f "$mc_tmp"
      fi
    elif [ ! -f "$mc_dst" ]; then
      cp "${ROOT}/config/mapcycle.txt" "$mc_dst"
      ok "gerado config/servers/${id}/mapcycle.txt"
      changed=1
    fi

    # amxx.cfg: bots nunca são rankeados (rankbots=0 para todos os servidores)
    local amxx_out="${ROOT}/config/servers/${id}/amxx.cfg"
    if [ ! -f "$amxx_out" ]; then
      sed -e "s|__RANKBOTS__|0|g" "${ROOT}/config/amxx.cfg" > "$amxx_out"
      ok "gerado ${amxx_out}"
      changed=1
    fi

    if [ ! -f "${ROOT}/config/servers/${id}/plugins.ini" ]; then
      cp "${ROOT}/cs/plugins/plugins.ini" "${ROOT}/config/servers/${id}/plugins.ini"
      ok "gerado config/servers/${id}/plugins.ini"
      changed=1
    fi

    local sb="${ROOT}/live/${id}/live_scoreboard.json"
    local kf="${ROOT}/live/${id}/live_killfeed.json"
    if [ ! -f "$sb" ]; then
      printf '{"hostname":"%s","map":"%s","round_t":0,"round_ct":0,"map_started_at":0,"last_match":null,"players":[]}\n' \
        "${name}" "${map}" > "$sb"
      ok "gerado ${sb}"
      changed=1
    fi
    if [ ! -f "$kf" ]; then
      printf '[]\n' > "$kf"
      ok "gerado ${kf}"
      changed=1
    fi

    # --- Espectador web (relay HLTV por servidor) ---
    # Portas derivadas do índice na lista: relay WATCH_HLTV_BASE+i,
    # listen WATCH_LISTEN_BASE+i, UDP ICE WATCH_UDP_BASE+(i*size)..+size-1.
    local watch_hltv_base watch_listen_base
    watch_hltv_base="$(env_val WATCH_HLTV_BASE 27100)"
    watch_listen_base="$(env_val WATCH_LISTEN_BASE 27200)"
    local hltv_port=$(( watch_hltv_base + index ))
    local listen_port=$(( watch_listen_base + index ))

    mkdir -p "${ROOT}/config/watch/${id}"
    mkdir -p "${ROOT}/live/watch/${id}"

    local hcfg="${ROOT}/config/watch/${id}/hltv.cfg"
    if [ ! -f "$hcfg" ]; then
      cat > "$hcfg" <<EOF
// HLTV relay config (auto-executed from /home/cs16) — gerado por servers.sh init.
// O módulo proxy precisa ser carregado explicitamente antes dos comandos.
loadmodule proxy

// Limita a taxa de ticks do relay (30/s, mesmo teto do sv_maxupdaterate do
// servidor de jogo): reduz a produção de pacotes netchan para o espectador web.
sys_ticrate 30

connect 127.0.0.1:${host_port}
delay 15
maxclients 128
name "${context}-hltv"
hostname "${context}-hltv"
chatmode 1
signoncommands "spec_autodirector 1"
EOF
      ok "gerado ${hcfg}"
      changed=1
    fi

    local hs="${ROOT}/config/watch/${id}/start-hltv.sh"
    if [ ! -f "$hs" ]; then
      cat > "$hs" <<EOF
#!/bin/bash
# Inicia o relay HLTV do servidor '${id}' (${name}) — gerado por servers.sh init.
# O hltv.cfg (mesmo diretório) é executado automaticamente e contém o connect.
cd /home/cs16

while true; do
  LD_LIBRARY_PATH=/home/cs16 ./hltv -port ${hltv_port} &
  HLTV_PID=\$!
  echo "\$HLTV_PID" > /home/cs16/hltv.pid
  wait "\$HLTV_PID"
  echo "hltv crashed on \$(date)" > /home/cs16/watch_logs/last_hltv_crash.txt
  sleep 3
done
EOF
      chmod +x "$hs"
      ok "gerado ${hs}"
      changed=1
    fi

    index=$(( index + 1 ))
  done < <(parse_servers)

  [ "$changed" -eq 1 ] && info "init concluído (arquivos existentes preservados)." \
    || info "init: nada a fazer (tudo já criado)."
}

cmd_compose() {
  local ids=() names=() ports=() maps=() maxps=() contexts=() line

  while read -r line; do
    local id name host_port map maxplayers rotate context
    IFS='|' read -r id name host_port map maxplayers rotate context <<< "$line"
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    valid_id "$id" || { err "id inválido em servers.list: '$id' (use apenas a-z0-9, _ e -)."; return 1; }
    valid_context "$context" || { err "context inválido em servers.list para '$id': '$context' (use apenas a-z0-9)."; return 1; }
    ids+=("$id"); names+=("$name"); ports+=("$host_port"); maps+=("$map"); maxps+=("$maxplayers"); contexts+=("$context")
  done < <(parse_servers)

  [ "${#ids[@]}" -gt 0 ] || { err "servers.list sem servidores"; return 1; }

  local i j
  for i in "${!ids[@]}"; do
    for j in "${!ids[@]}"; do
      [ "$i" -eq "$j" ] && continue
      if [ "${ids[$i]}" = "${ids[$j]}" ]; then
        err "id duplicado em servers.list: '${ids[$i]}'"; return 1
      fi
      if [ "${ports[$i]}" = "${ports[$j]}" ]; then
        err "porta duplicada em servers.list: ${ports[$i]} (${ids[$i]} e ${ids[$j]})"; return 1
      fi
      if [ "${contexts[$i]}" = "${contexts[$j]}" ]; then
        err "context duplicado em servers.list: '${contexts[$i]}' (${ids[$i]} e ${ids[$j]}) — paths de espectador devem ser únicos"
        return 1
      fi
    done
  done

  if [ "${ids[0]}" != "main" ]; then
    err "O primeiro servidor de servers.list deve ter id \"main\" (base do docker-compose.yml)."
    return 1
  fi

  if [ "${ports[0]}" != "27015" ]; then
    err "O servidor primário \"main\" deve usar host_port 27015 (fixo no docker-compose.yml base; a porta só é publicada pelo override para os demais servidores)."
    return 1
  fi

  local out="${ROOT}/${OVERRIDE}"

  # +maxplayers = vagas visíveis + 1 (slot reservado ao HLTV), com teto 32:
  # o engine CS 1.6 não aceita +maxplayers acima de 32 (33 reverte para 32).
  calc_max() {
    if [ "$(( $1 + 1 ))" -gt 32 ]; then
      printf '32'
    else
      printf '%s' "$(( $1 + 1 ))"
    fi
  }

  {
    echo "# Gerado por scripts/servers.sh compose — não edite manualmente."
    echo "# Consulte config/servers.list para alterar os servidores."
    echo "services:"

    # --- Servidor primário (serviço base cs16) ---
    echo "  cs16:"
    echo "    build: ./cs16"
    echo "    image: cs16_stats:local"
    echo "    environment:"
    echo '      PORT: "27015"'
    echo "      MAP: \"${maps[0]}\""
    echo "      MAXPLAYERS: \"$(calc_max "${maxps[0]}")\""
    echo "      SERVER_ID: \"${ids[0]}\""

    # --- Servidores adicionais ---
    local i
    for i in "${!ids[@]}"; do
      [ "$i" -eq 0 ] && continue
      local svc="cs16${ids[$i]}"
      echo "  ${svc}:"
      echo "    image: cs16_stats:local"
      echo "    restart: always"
      echo "    environment:"
      echo '      PORT: "27015"'
      echo "      MAP: \"${maps[$i]}\""
      echo "      MAXPLAYERS: \"$(calc_max "${maxps[$i]}")\""
      echo "      SERVER_ID: \"${ids[$i]}\""
      echo "    ports:"
      echo "      - \"${ports[$i]}:27015/udp\""
      echo "      - \"${ports[$i]}:27015/tcp\""
      echo "    security_opt:"
      echo "      - seccomp=unconfined"
      echo "    volumes:"
      echo "      - ./config/servers/${ids[$i]}/server.cfg:/home/cs16/cstrike/server.cfg"
      echo "      - ./config/servers/${ids[$i]}/users.ini:/home/cs16/cstrike/addons/amxmodx/configs/users.ini"
      echo "      - ./config/servers/${ids[$i]}/amxx.cfg:/home/cs16/cstrike/addons/amxmodx/configs/amxx.cfg"
      echo "      - ./config/servers/${ids[$i]}/mapcycle.txt:/home/cs16/cstrike/mapcycle.txt"
      echo "      - ./config/servers/${ids[$i]}/motd.txt:/home/cs16/cstrike/motd.txt"
      echo "      - ./config/servers/${ids[$i]}/plugins.ini:/home/cs16/cstrike/addons/amxmodx/configs/plugins.ini"
      echo "      - ./cs/plugins/live_scoreboard.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/live_scoreboard.amxx"
      echo "      - ./cs/plugins/live_killfeed.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/live_killfeed.amxx"
      echo "      - ./cs/plugins/csstatsx_sql.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/csstatsx_sql.amxx"
      echo "      - ./cs/plugins/slots_reserve.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/slots_reserve.amxx"
      echo "      - ./live/${ids[$i]}/live_scoreboard.json:/home/cs16/cstrike/addons/amxmodx/data/live/live_scoreboard.json"
      echo "      - ./live/${ids[$i]}/live_killfeed.json:/home/cs16/cstrike/addons/amxmodx/data/live/live_killfeed.json"
    done

    # --- API: CS_SERVERS + live data dos servidores adicionais ---
    local entries=() svc_host j json=""
    local watch_public_base watch_upstream
    watch_public_base="$(env_val WATCH_PUBLIC_BASE '')"
    watch_upstream="$(env_val WATCH_UPSTREAM_HOST '127.0.0.1')"
    for i in "${!ids[@]}"; do
      if [ "$i" -eq 0 ]; then
        svc_host="cs16"
      else
        svc_host="cs16${ids[$i]}"
      fi
      local spec="null"
      if [ -n "$watch_public_base" ]; then
        spec="\"${watch_public_base%/}/${contexts[$i]}/\""
      fi
      entries+=("{\"id\":\"${ids[$i]}\",\"name\":\"${names[$i]}\",\"host\":\"${svc_host}\",\"port\":27015,\"hostPort\":${ports[$i]},\"liveDir\":\"/live_data/${ids[$i]}\",\"spectatorUrl\":${spec}}")
    done
    for j in "${entries[@]}"; do
      if [ -z "$json" ]; then json="$j"; else json="${json},${j}"; fi
    done

    echo "  api:"
    echo "    environment:"
    echo "      CS_SERVERS: >-"
    echo "        [${json}]"
    echo "    volumes:"
    for i in "${!ids[@]}"; do
      [ "$i" -eq 0 ] && continue
      echo "      - ./live/${ids[$i]}/live_scoreboard.json:/live_data/${ids[$i]}/live_scoreboard.json:ro"
      echo "      - ./live/${ids[$i]}/live_killfeed.json:/live_data/${ids[$i]}/live_killfeed.json:ro"
    done
  } > "$out"

  ok "override gerado: ${OVERRIDE}"
  cat "$out"

  write_watch_compose || return 1
  write_swag_snippet || return 1
}

# Gera docker-compose.watch.yml com um par watch-main/watch-hltv por servidor
# (profiles ["watch"]; iniciado apenas por scripts/watch.sh).
write_watch_compose() {
  [ -f "${ROOT}/valve/valve.zip" ] && local zip_bind="- ./valve/valve.zip:/valve/valve.zip:ro" || local zip_bind=""

  local out="${ROOT}/docker-compose.watch.yml"
  local watch_hltv_base watch_listen_base watch_udp_base watch_udp_size console_cmds
  watch_hltv_base="$(env_val WATCH_HLTV_BASE 27100)"
  watch_listen_base="$(env_val WATCH_LISTEN_BASE 27200)"
  watch_udp_base="$(env_val WATCH_UDP_BASE 27300)"
  watch_udp_size="$(env_val WATCH_UDP_SIZE 64)"
  console_cmds="$(env_val WATCH_CONSOLE_COMMANDS 'spec_autodirector 1')"

  {
    echo "# Gerado por scripts/servers.sh compose — não edite manualmente."
    echo "# Espectador web (opt-in): scripts/watch.sh up|down. Portas por servidor (índice na lista):"
    echo "#   relay HLTV UDP $((watch_hltv_base))+i | watch-main TCP $((watch_listen_base))+i | WebRTC UDP $((watch_udp_base))+(i*${watch_udp_size})..+$((watch_udp_size-1))"
    echo "services:"

    local i svc_idx
    for i in "${!ids[@]}"; do
      local ctx="${contexts[$i]}"
      local hltv_port=$(( watch_hltv_base + i ))
      local listen_port=$(( watch_listen_base + i ))
      local udp_start=$(( watch_udp_base + (i * watch_udp_size) ))
      local udp_end=$(( udp_start + watch_udp_size - 1 ))

      echo "  watch-hltv-${ids[$i]}:"
      echo "    image: cs16_stats:local"
      echo "    container_name: cs16-watch-hltv-${ids[$i]}"
      echo "    restart: unless-stopped"
      echo "    profiles: [\"watch\"]"
      echo "    network_mode: host"
      echo "    environment:"
      echo '      LD_LIBRARY_PATH: "/home/cs16"'
      echo "    entrypoint: [\"/home/cs16/start-hltv.sh\"]"
      echo "    volumes:"
      echo "      - ./config/watch/${ids[$i]}/hltv.cfg:/home/cs16/hltv.cfg:ro"
      echo "      - ./config/watch/${ids[$i]}/start-hltv.sh:/home/cs16/start-hltv.sh:ro"
      echo "      - ./live/watch/${ids[$i]}:/home/cs16/watch_logs"
      echo "    healthcheck:"
      echo '      test: ["CMD", "test", "-f", "/home/cs16/hltv.pid"]'
      echo "      interval: 30s"
      echo "      timeout: 10s"
      echo "      retries: 5"

      echo "  watch-main-${ids[$i]}:"
      if [ "$i" -eq 0 ]; then
        echo "    build: ./watch/webxash3d-proxy"
      fi
      echo "    image: csserver_wstats-watch-main"
      echo "    container_name: cs16-watch-main-${ids[$i]}"
      echo "    restart: unless-stopped"
      echo "    profiles: [\"watch\"]"
      echo "    network_mode: host"
      echo "    environment:"
      echo "      GAME_SERVER: \"127.0.0.1:${hltv_port}\""
      echo "      LISTEN_HOST: \"0.0.0.0\""
      echo "      LISTEN_PORT: \"${listen_port}\""
      echo "      BASE_PATH: \"/${ctx}\""
      echo "      UDP_PORT_RANGE: \"${udp_start}-${udp_end}\""
      echo "      CONSOLE_COMMANDS: \"${console_cmds}\""
      echo "      PACKAGE_ZIP: \"/valve/valve.zip\""
      if [ -n "$zip_bind" ]; then
        echo "    volumes:"
        echo "      ${zip_bind}"
      fi
      echo "    ulimits:"
      echo "      nofile:"
      echo "        soft: 65536"
      echo "        hard: 65536"
      echo "    healthcheck:"
      echo "      test: [\"CMD\", \"wget\", \"-qO-\", \"http://127.0.0.1:${listen_port}/health\"]"
      echo "      interval: 30s"
      echo "      timeout: 10s"
      echo "      retries: 5"
    done
  } > "$out"

  ok "override gerado: docker-compose.watch.yml (${#ids[@]} servidor(es))"
  cat "$out"
}

# Gera um snippet de blocos location para o proxy-conf do swag (stack ~/duckdns,
# fora deste repo) que serve o espectador em WATCH_PUBLIC_BASE/<context>/.
write_swag_snippet() {
  local watch_public_base watch_upstream
  watch_public_base="$(env_val WATCH_PUBLIC_BASE '')"
  watch_upstream="$(env_val WATCH_UPSTREAM_HOST '127.0.0.1')"
  [ -n "$watch_public_base" ] || { err "WATCH_PUBLIC_BASE não definido no .env — sem snippet swag"; return 0; }

  local watch_listen_base
  watch_listen_base="$(env_val WATCH_LISTEN_BASE 27200)"

  local out="${ROOT}/config/watch/swag-locations.conf.example"
  local listen_port i
  {
    echo "# Gerado por scripts/servers.sh compose — não edite manualmente."
    echo "# Exposição do espectador web no swag (stack separada em ~/duckdns):"
    echo "#   público: ${watch_public_base}/<context>/"
    echo "#   upstream: http://${watch_upstream}:<listen_port> (watch-main com network_mode: host)"
    echo "# O swag NÃO deve remover o prefixo (o proxy atende em BASE_PATH);"
    echo "# cada location termina SEM barra no proxy_pass e repassa o Upgrade/WS."
    echo "# Para ativar: copie os blocos abaixo para dentro do server { } do"
    echo "# proxy-confs/zueiracstrike-watch.subdomain.conf e reinicie o swag."
    echo ""
    for i in "${!ids[@]}"; do
      listen_port=$(( watch_listen_base + i ))
      echo "    location /${contexts[$i]}/ {"
      echo "        proxy_pass http://${watch_upstream}:${listen_port};"
      echo "        proxy_http_version 1.1;"
      echo "        proxy_set_header Upgrade \$http_upgrade;"
      echo "        proxy_set_header Connection \"upgrade\";"
      echo "        proxy_set_header Host \$host;"
      echo "        proxy_set_header X-Real-IP \$remote_addr;"
      echo "    }"
      echo ""
    done
  } > "$out"

  ok "snippet swag gerado: config/watch/swag-locations.conf.example"
}

cmd_config() {
  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" config "$@"
}

cmd_build() {
  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" build
}

cmd_up() {
  cmd_init || return 1
  cmd_compose || return 1

  # Sem --build: o BuildKit gera um ID novo a cada build (provenance), o que
  # fazia o compose recriar TODOS os containers CS a cada `up`. Builda apenas
  # na primeira vez, quando alguma imagem ainda não existe.
  local missing=0 img
  for img in cs16_stats:local csserver_wstats-api; do
    docker image inspect "$img" >/dev/null 2>&1 || { err "Imagem ${img} ausente"; missing=1; }
  done
  if [ "$missing" -eq 1 ]; then
    info "Construindo imagens (primeira vez) ..."
    cmd_build || return 1
  fi

  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" up -d --remove-orphans
}

cmd_down() {
  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" down "$@"
}

cmd_ps() {
  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" ps
}

cmd_status() {
  info "=== Servidores configurados (${SERVERS_LIST}) ==="
  printf '%-12s %-22s %-10s %-14s %-6s %-6s %s\n' "ID" "NOME" "HOST_PORT" "MAPA" "ROT" "MAX" "CONTEXT"
  local line
  while read -r line; do
    local id name host_port map maxplayers rotate context
    IFS='|' read -r id name host_port map maxplayers rotate context <<< "$line"
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    printf '%-12s %-22s %-10s %-14s %-6s %-6s %s\n' "${id}" "${name}" "${host_port}" "${map}" "${rotate}" "${maxplayers}" "${context}"
  done < <(parse_servers)
  info ""
  info "=== Containers ==="
  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" ps
  info ""
  info "Dica: scripts/servers.sh rcon <id> <comando> para RCON direto; a página Sistema mostra o status online."
}

cmd_list() {
  cat "${SERVERS_LIST}"
}

# Apaga as séries do Prometheus dos servidores removidos (dados do Grafana).
# Requer a Admin API habilitada (docker-compose.yml) e o prometheus no ar.
prom_delete_series() {
  local ids=("$@") id code
  local base="http://localhost:9090/api/v1/admin/tsdb"
  for id in "${ids[@]}"; do
    code="$(curl -s -o /dev/null -w "%{http_code}" -X POST -g "${base}/delete_series?match[]={server=\"${id}\"}")"
    if [ "$code" = "204" ] || [ "$code" = "200" ]; then
      ok "Prometheus: séries de '${id}' removidas"
    else
      err "Prometheus: falha ao remover séries de '${id}' (http ${code})"
    fi
  done
  curl -s -o /dev/null -X POST "${base}/clean_tombstones"
}

# Apaga config/servers/<id> e live/<id>. Sem ids, usa todos que não estão no servers.list.
# --metrics: também remove os dados do Prometheus/Grafana sem perguntar (usado pelo setup.sh).
cmd_prune() {
  local yes=0 metrics=0 ids=() line

  for arg in "$@"; do
    case "$arg" in
      --yes) yes=1 ;;
      --metrics) metrics=1 ;;
      -*) err "Opção desconhecida: $arg"; return 1 ;;
      *) ids+=("$arg") ;;
    esac
  done

  if [ "${#ids[@]}" -eq 0 ]; then
    local keep=()
    while read -r line; do
      local id
      IFS='|' read -r id _ <<< "$line"
      keep+=("$id")
    done < <(parse_servers)

    local id_dir
    for id_dir in "${ROOT}"/config/servers/* "${ROOT}"/live/*; do
      [ -d "$id_dir" ] || continue
      local id
      id="$(basename "$id_dir")"
      local in_list=0 k
      for k in "${keep[@]}"; do
        [ "$k" = "$id" ] && in_list=1
      done
      [ "$in_list" -eq 1 ] || ids+=("$id")
    done
  fi

  if [ "${#ids[@]}" -eq 0 ]; then
    info "prune: nada a apagar (todos os diretórios estão no servers.list)."
    return 0
  fi

  local id
  for id in "${ids[@]}"; do
    valid_id "$id" || { err "id inválido: '$id' — abortando prune."; return 1; }
  done

  info "Prune vai apagar config/servers e live de: ${ids[*]}"
  if [ "$yes" -ne 1 ]; then
    read -r -p "Continuar? [S/n] " answer
    [[ "$answer" =~ ^(s|S|sim|SIM|y|Y|yes|YES|)$ ]] || { info "prune cancelado."; return 0; }
    read -r -p "Apagar também os dados do Prometheus/Grafana destes servidores? [s/N] " pm_ans
    [[ "$pm_ans" =~ ^(s|S|sim|SIM|y|Y|yes|YES)$ ]] && metrics=1
  fi

  for id in "${ids[@]}"; do
    [ -d "${ROOT}/config/servers/${id}" ] && rm -rf "${ROOT}/config/servers/${id}" && ok "apagado config/servers/${id}"
    [ -d "${ROOT}/live/${id}" ] && rm -rf "${ROOT}/live/${id}" && ok "apagado live/${id}"
  done

  if [ "$metrics" -eq 1 ]; then
    prom_delete_series "${ids[@]}"
  fi
}

cmd_rcon() {
  [ -f "${ROOT}/${OVERRIDE}" ] || cmd_compose >/dev/null

  local id="${1:-}"
  shift 2>/dev/null || true
  local command="$*"

  [ -n "$id" ] || { err "Uso: servers.sh rcon <id> <comando>"; return 1; }
  [ -n "$command" ] || { err "Comando RCON vazio"; return 1; }

  docker compose -f "${COMPOSE_BASE}" -f "${OVERRIDE}" exec -T api node -e '
    const Rcon = require("rcon")
    const [srvId, command] = process.argv.slice(1)
    const list = (() => {
      try {
        const raw = process.env.CS_SERVERS
        const arr = raw ? JSON.parse(raw) : null
        return Array.isArray(arr) && arr.length ? arr : null
      } catch (e) { return null }
    })()
    const srv = (list && list.find((s) => s.id === srvId))
      || (list && list[0])
      || { id: "main", host: process.env.GAMEDIG_HOST || "cs16", port: parseInt(process.env.GAMEDIG_PORT || "27015", 10) }
    const c = new Rcon(srv.host, parseInt(srv.port, 10), process.env.RCON_PASSWORD, { tcp: false, challenge: true })
    let output = ""
    let done = false
    const finish = () => {
      if (done) return
      done = true
      try { c.disconnect() } catch (e) {}
      process.stdout.write(output.trim() ? output : "(sem retorno textual)")
      process.stdout.write("\n")
      process.exit(0)
    }
    c.on("auth", () => c.send(command))
    c.on("response", (str) => { output += str + "\n" })
    c.on("error", (err) => {
      if (done) return
      done = true
      console.error("RCON erro:", err.message)
      process.exit(1)
    })
    c.on("end", finish)
    setTimeout(finish, 4000)
    c.connect()
  ' "$id" "$command"
}

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}"
}

case "${1:-}" in
  init)    cmd_init ;;
  compose) cmd_compose ;;
  config)  cmd_config "${@:2}" ;;
  build)   cmd_build ;;
  up)      cmd_up ;;
  down)    cmd_down "${@:2}" ;;
  ps)      cmd_ps ;;
  status)  cmd_status ;;
  list)    cmd_list ;;
  prune)   cmd_prune "${@:2}" ;;
  rcon)    cmd_rcon "${@:2}" ;;
  -h|--help|help) usage ;;
  *)
    err "Comando desconhecido: ${1:-}"
    usage
    exit 1
    ;;
esac
