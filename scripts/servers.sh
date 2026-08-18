#!/bin/bash
# servers.sh — provisiona e gerencia múltiplos servidores CS 1.6.
#
# Uso:
#   servers.sh init          Cria config/servers/<id>/* e live/<id>/* a partir de servers.list
#   servers.sh compose       Gera docker-compose.servers.yml (override)
#   servers.sh swag-sync     Re-sincroniza os blocos location no proxy-conf vivo do swag
#   servers.sh config        Valida o compose mergeado
#   servers.sh build         Builda as imagens cs16_stats:local e csserver_wstats-api
#   servers.sh up            init + compose + docker compose up -d --no-recreate (rebuilda só se a imagem não existir)
#   servers.sh down          docker compose down
#   servers.sh ps            docker compose ps
#   servers.sh status        Resumo dos servidores configurados
#   servers.sh list          Mostra config/servers.list
#   servers.sh provision <id> [--cstv]   Cria o container do servidor (e opcionalmente os serviços de espectador) SEM recriar nada existente
#   servers.sh unprovision <id>          Remove o container do servidor + serviços de espectador (add/remove pela API usam isso)
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
# Arquivo do espectador (profiles: ["watch"]). Incluído para que o compose
# conheça as services do espectador (provision/unprovision as operam por id);
# sem --profile, nunca são iniciadas por aqui.
WATCH_OVERRIDE="docker-compose.watch.yml"
# Stack TLS/DDNS (swag + duckdns), integrada ao projeto. Incluída para que o
# compose conheça essas services (up/down/ps/provision/unprovision) e nunca as
# trate como órfãs/derrube por engano.
DUCKDNS_OVERRIDE="docker-compose.duckdns.yml"
COMPOSE_FILES=(-f "${COMPOSE_BASE}" -f "${OVERRIDE}")
if [ -f "${ROOT}/${WATCH_OVERRIDE}" ]; then
  COMPOSE_FILES+=(-f "${WATCH_OVERRIDE}")
fi
if [ -f "${ROOT}/${DUCKDNS_OVERRIDE}" ]; then
  COMPOSE_FILES+=(-f "${DUCKDNS_OVERRIDE}")
fi

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

# Emite uma linha por servidor no formato  id|name|host_port|map|maxplayers|rotate|context|mode
parse_servers() {
  local id name host_port map maxplayers rotate context mode rest
  while IFS=' ' read -r id name host_port map maxplayers rotate context mode rest; do
    [[ -z "$id" || "$id" =~ ^# ]] && continue
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    : "${mode:=standard}"
    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "$id" "$name" "$host_port" "$map" "$maxplayers" "$rotate" "$context" "$mode"
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
    local id name host_port map maxplayers rotate context mode
    IFS='|' read -r id name host_port map maxplayers rotate context mode <<< "$line"
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    : "${mode:=standard}"

    valid_id "$id" || { err "id inválido em servers.list: '$id' (use apenas a-z0-9, _ e -)."; return 1; }
    valid_context "$context" || { err "context inválido em servers.list para '$id': '$context' (use apenas a-z0-9)."; return 1; }

    # vagas visíveis devem ser par (máximo 30: o compose soma +1 para o slot escondido
    # do HLTV e o engine CS 1.6 aceita no máximo 32 — 30+1=31 fica sempre abaixo do teto)
    if ! [[ "$maxplayers" =~ ^[0-9]+$ ]] || [ $((maxplayers % 2)) -ne 0 ] || [ "$maxplayers" -lt 2 ] || [ "$maxplayers" -gt 30 ]; then
      err "Slots visíveis inválidos em servers.list para '$id': '$maxplayers' (use par entre 2 e 30)."
      return 1
    fi

    mkdir -p "${ROOT}/config/servers/${id}"
    mkdir -p "${ROOT}/live/${id}"

    local mode_template="${ROOT}/config/templates/modes/${mode}.cfg"
    local src_template="${TEMPLATE_CFG}"
    if [ "$mode" != "standard" ] && [ -f "$mode_template" ]; then
      src_template="$mode_template"
    fi

    # server.cfg — sempre comparar com o template; se diferente, atualizar (com .bak)
    local out="${ROOT}/config/servers/${id}/server.cfg"
    local tmp_out="${out}.tmp"
    sed -e "s|__HOSTNAME__|${name}|g" -e "s|__RCON_PASSWORD__|${rcon_pass}|g" \
      -e "s|__SERVER_ID__|${id}|g" -e "s|__RANKBOTS__|0|g" \
      -e "s|__VISIBLE_MAXPLAYERS__|${maxplayers}|g" \
      "${src_template}" > "$tmp_out"
    if [ ! -f "$out" ]; then
      mv "$tmp_out" "$out"
      ok "gerado ${out} (modo: ${mode})"
      changed=1
    elif ! cmp -s "$tmp_out" "$out"; then
      cp "${out}" "${out}.bak"
      mv "$tmp_out" "$out"
      ok "atualizado ${out} (template mudou, .bak criado)"
      changed=1
    else
      rm -f "$tmp_out"
    fi

    # motd.txt — copia do template do modo; se diferente, atualizar (com .bak)
    local motd_template="${ROOT}/config/templates/motd/${mode}.txt"
    local motd_dst="${ROOT}/config/servers/${id}/motd.txt"
    if [ -f "$motd_template" ]; then
      if [ ! -f "$motd_dst" ]; then
        cp "$motd_template" "$motd_dst"
        ok "gerado config/servers/${id}/motd.txt (modo: ${mode})"
        changed=1
      elif ! cmp -s "$motd_template" "$motd_dst"; then
        cp "${motd_dst}" "${motd_dst}.bak"
        cp "$motd_template" "$motd_dst"
        ok "atualizado config/servers/${id}/motd.txt (template mudou, .bak criado)"
        changed=1
      fi
    fi

    # users.ini — só cria se não existir (não sobrescreve edits manuais)
    if [ ! -f "${ROOT}/config/servers/${id}/users.ini" ]; then
      cp "${ROOT}/config/users.ini" "${ROOT}/config/servers/${id}/users.ini"
      ok "gerado config/servers/${id}/users.ini"
      changed=1
    fi

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

    # plugins.ini — sempre comparar com o template do modo; se diferente, atualizar (com .bak)
    local mode_ini="${ROOT}/config/templates/modes/${mode}.ini"
    local src_ini="${ROOT}/cs16/plugins/plugins.ini"
    if [ "$mode" != "standard" ] && [ -f "$mode_ini" ]; then
      src_ini="$mode_ini"
    fi
    local ini_dst="${ROOT}/config/servers/${id}/plugins.ini"
    if [ ! -f "$ini_dst" ]; then
      cp "${src_ini}" "$ini_dst"
      ok "gerado config/servers/${id}/plugins.ini (modo: ${mode})"
      changed=1
    elif ! cmp -s "$src_ini" "$ini_dst"; then
      cp "${ini_dst}" "${ini_dst}.bak"
      cp "${src_ini}" "$ini_dst"
      ok "atualizado config/servers/${id}/plugins.ini (template mudou, .bak criado)"
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
    local hcfg_new
    hcfg_new="$(mktemp)"
    cat > "$hcfg_new" <<EOF
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
    if [ -f "$hcfg" ] && cmp -s "$hcfg_new" "$hcfg"; then
      rm -f "$hcfg_new"
    else
      [ -f "$hcfg" ] && cp "$hcfg" "${hcfg}.bak"
      mv "$hcfg_new" "$hcfg"
      ok "atualizado ${hcfg}"
      changed=1
    fi

    local hs="${ROOT}/config/watch/${id}/start-hltv.sh"
    local hs_new
    hs_new="$(mktemp)"
    cat > "$hs_new" <<EOF
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
    chmod +x "$hs_new"
    if [ -f "$hs" ] && cmp -s "$hs_new" "$hs"; then
      rm -f "$hs_new"
    else
      [ -f "$hs" ] && cp "$hs" "${hs}.bak"
      mv "$hs_new" "$hs"
      ok "atualizado ${hs}"
      changed=1
    fi

    index=$(( index + 1 ))
  done < <(parse_servers)

  [ "$changed" -eq 1 ] && info "init concluído (arquivos existentes preservados)." \
    || info "init: nada a fazer (tudo já criado)."
}

cmd_compose() {
  local ids=() names=() ports=() maps=() maxps=() contexts=() modes=() line

  while read -r line; do
    local id name host_port map maxplayers rotate context mode
    IFS='|' read -r id name host_port map maxplayers rotate context mode <<< "$line"
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    : "${mode:=standard}"
    ids+=("$id"); names+=("$name"); ports+=("$host_port"); maps+=("$map"); maxps+=("$maxplayers"); contexts+=("$context"); modes+=("$mode")
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

  # +maxplayers = vagas visíveis + 1 (slot escondido reservado ao HLTV). O engine
  # CS 1.6 não aceita +maxplayers acima de 32; com máximo de 30 vagas visíveis
  # (30+1=31) o cap é só uma segurança extra.
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
      echo "      - ./cs16/plugins/live_scoreboard.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/live_scoreboard.amxx"
      echo "      - ./cs16/plugins/live_killfeed.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/live_killfeed.amxx"
      echo "      - ./cs16/plugins/csstatsx_sql.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/csstatsx_sql.amxx"
      echo "      - ./cs16/plugins/slots_reserve.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/slots_reserve.amxx"
      echo "      - ./cs16/plugins/adminslots.amxx:/home/cs16/cstrike/addons/amxmodx/plugins/adminslots.amxx"
      echo "      - ./live/${ids[$i]}/live_scoreboard.json:/home/cs16/cstrike/addons/amxmodx/data/live/live_scoreboard.json"
      echo "      - ./live/${ids[$i]}/live_killfeed.json:/home/cs16/cstrike/addons/amxmodx/data/live/live_killfeed.json"

      # Plugins específicos do modo (mount individual de cada .amxx)
      local mode_dir="${ROOT}/cs16/vendor/mode_plugins/${modes[$i]}"
      if [ "${modes[$i]}" != "standard" ] && [ -d "$mode_dir" ]; then
        local amxx_file
        for amxx_file in "${mode_dir}"/*.amxx; do
          [ -f "$amxx_file" ] || continue
          local base
          base="$(basename "$amxx_file")"
          echo "      - ./cs16/vendor/mode_plugins/${modes[$i]}/${base}:/home/cs16/cstrike/addons/amxmodx/plugins/${base}"
        done
      fi
    done

  } > "$out"

  ok "override gerado: ${OVERRIDE}"
  cat "$out"

  write_watch_compose || return 1
  write_swag_snippet || return 1
  apply_swag_locations || return 1
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

# Gera um snippet de blocos location para o proxy-conf do swag (stack TLS/DDNS
# integrada, docker-compose.duckdns.yml) que serve o espectador em
# WATCH_PUBLIC_BASE/<context>/.
write_swag_snippet() {
  local watch_public_base watch_upstream
  watch_public_base="$(env_val WATCH_PUBLIC_BASE '')"
  watch_upstream="$(env_val WATCH_UPSTREAM_HOST '127.0.0.1')"
  [ -n "$watch_public_base" ] || { err "WATCH_PUBLIC_BASE não definido no .env — sem snippet swag"; return 0; }

  local out="${ROOT}/config/watch/swag-locations.conf.example"
  {
    echo "# Gerado por scripts/servers.sh compose — não edite manualmente."
    echo "# Exposição do espectador web no swag (stack integrada: docker-compose.duckdns.yml):"
    echo "#   público: ${watch_public_base}/<context>/"
    echo "#   upstream: http://${watch_upstream}:<listen_port> (watch-main com network_mode: host)"
    echo "# O swag NÃO deve remover o prefixo (o proxy atende em BASE_PATH);"
    echo "# cada location termina SEM barra no proxy_pass e repassa o Upgrade/WS."
    echo "# Automático: servers.sh compose sincroniza os blocos abaixo no proxy-conf"
    echo "# vivo (zueiracstrike-watch.subdomain.conf, região de marcadores) e reinicia o swag."
    echo "# Para re-sync manual: scripts/servers.sh swag-sync."
    echo ""
    swag_location_blocks
  } > "$out"

  ok "snippet swag gerado: config/watch/swag-locations.conf.example"
}

# Emite os blocos location (4 espaços) a partir dos arrays `ids`/`contexts` do
# escopo da chamada (bash: escopo dinâmico — cmd_compose/apply_swag_locations
# declaram os locais e estes são visíveis aqui).
swag_location_blocks() {
  local watch_upstream watch_listen_base i
  watch_upstream="$(env_val WATCH_UPSTREAM_HOST '127.0.0.1')"
  watch_listen_base="$(env_val WATCH_LISTEN_BASE 27200)"
  for i in "${!ids[@]}"; do
    printf '    location /%s/ {\n        proxy_pass http://%s:%d;\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n    }\n\n' \
      "${contexts[$i]}" "$watch_upstream" "$(( watch_listen_base + i ))"
  done
}

# Sincroniza os blocos location no proxy-conf VIVO do swag a partir de
# servers.list. Chamada no fim do cmd_compose (cobre up, compose, provision e
# unprovision) e via subcomando `swag-sync`. Idempotente: reescreve apenas a
# região entre os marcadores `# BEGIN/END servers.sh swag locations` (na 1ª
# execução, migra os blocos legados). Só reinicia o swag se o arquivo mudou
# E se `nginx -t` validar. No remove, os blocos derivam de servers.list,
# então o location do servidor removido some daqui automaticamente.
apply_swag_locations() {
  local conf
  conf="${SWAG_PROXY_CONF:-}"
  if [ -z "$conf" ] && [ -f "${ROOT}/duckdns/swag/config/nginx/proxy-confs/zueiracstrike-watch.subdomain.conf" ]; then
    conf="${ROOT}/duckdns/swag/config/nginx/proxy-confs/zueiracstrike-watch.subdomain.conf"
  fi
  if [ -z "$conf" ] && [ -f "${HOME}/duckdns/swag/config/nginx/proxy-confs/zueiracstrike-watch.subdomain.conf" ]; then
    conf="${HOME}/duckdns/swag/config/nginx/proxy-confs/zueiracstrike-watch.subdomain.conf"
  fi
  if [ -z "$conf" ] && [ -f "$(dirname "${ROOT}")/duckdns/swag/config/nginx/proxy-confs/zueiracstrike-watch.subdomain.conf" ]; then
    conf="$(dirname "${ROOT}")/duckdns/swag/config/nginx/proxy-confs/zueiracstrike-watch.subdomain.conf"
  fi
  if [ -z "$conf" ] || [ ! -f "$conf" ]; then
    info "swag: proxy-conf vivo não encontrado (SWAG_PROXY_CONF unset e duckdns/swag/config ausente no repo) —"
    info "      sincronização automática ignorada. Rode: SWAG_PROXY_CONF=/caminho/zueiracstrike-watch.subdomain.conf scripts/servers.sh swag-sync"
    return 0
  fi

  local ids=() contexts=() line
  local id name host_port map maxplayers rotate context mode
  while read -r line; do
    IFS='|' read -r id name host_port map maxplayers rotate context mode <<< "$line"
    ids+=("$id")
    contexts+=("$context")
  done < <(parse_servers)
  [ "${#ids[@]}" -gt 0 ] || { err "servers.list vazio — nada a sincronizar no swag"; return 1; }

  # Backup único antes da 1ª modificação (não sobrescreve backups manuais).
  if [ ! -f "${conf}.bak" ]; then
    cp -p "$conf" "${conf}.bak"
    info "swag: backup criado em ${conf}.bak"
  fi

  local blocks tmp before after
  blocks="$(swag_location_blocks)"
  tmp="$(mktemp)"
  before="$(cksum "$conf" | awk '{print $1}')"
  # Dono/modo originais: um sync vindo do container de provisionamento roda como
  # root e o `mv` abaixo recriaria o arquivo como root:root 0600 (mktemp) —
  # restauramos os dois depois para o host continuar lendo/gravando o conf.
  local orig_owner orig_perms
  orig_owner="$(stat -c '%u:%g' "$conf" 2>/dev/null || true)"
  orig_perms="$(stat -c '%a' "$conf" 2>/dev/null || true)"

  # awk: substitui a região de marcadores (se existir) OU migra os blocos
  # legados (1ª execução). Preserva o header, comentários e o `location = /`.
  if awk -v blocks="$blocks" '
    BEGIN { inmarker=0; seentarget=0 }
    /^    # BEGIN servers.sh swag locations/ { inmarker=1; next }
    inmarker && /^    # END servers.sh swag locations/ {
      inmarker=0
      print "    # BEGIN servers.sh swag locations"
      printf "%s\n", blocks
      print "    # END servers.sh swag locations"
      next
    }
    inmarker { next }
    $0 ~ /^    location \// {
      if (!seentarget) {
        print "    # BEGIN servers.sh swag locations"
        printf "%s\n", blocks
        print "    # END servers.sh swag locations"
        seentarget=1
      }
      next
    }
    seentarget && $0 !~ /^}/ { next }
    { print }
  ' "$conf" > "$tmp" && [ -s "$tmp" ]; then
    after="$(cksum "$tmp" | awk '{print $1}')"
    if [ "$before" = "$after" ]; then
      rm -f "$tmp"
      ok "swag: locations já estão em dia (${conf##*/})"
      return 0
    fi
    # Só recria o arquivo quando o conteúdo realmente muda.
    mv "$tmp" "$conf"
    [ -n "$orig_owner" ] && chown "$orig_owner" "$conf" 2>/dev/null
    [ -n "$orig_perms" ] && chmod "$orig_perms" "$conf" 2>/dev/null
  else
    rm -f "$tmp"
    err "swag: falha ao sincronizar ${conf}"
    return 1
  fi

  ok "swag: ${conf##*/} atualizado (${#ids[@]} location(s))"
  local swagc
  swagc="${SWAG_CONTAINER:-swag}"
  if docker ps --format '{{.Names}}' | grep -qx "$swagc"; then
    if docker exec "$swagc" nginx -t >/dev/null 2>&1; then
      docker restart "$swagc" >/dev/null && ok "swag: ${swagc} reiniciado"
    else
      err "swag: nginx -t falhou — config NÃO aplicado. Restaure ${conf}.bak e revise o arquivo."
      return 1
    fi
  else
    info "swag: container '${swagc}' não está em execução — config atualizado, reinicie o swag depois"
  fi
}

cmd_config() {
  docker compose "${COMPOSE_FILES[@]}" config "$@"
}

cmd_build() {
  docker compose "${COMPOSE_FILES[@]}" build
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

  # --no-recreate: NUNCA recria containers existentes. As versões do compose do
  # host (v5.x) e do container de provisionamento (imagem da api) calculam o
  # config-hash de formas diferentes — um `up` completo compararia os labels
  # com outro hash e recriaria a stack inteira (db, web, prometheus, grafana...)
  # a cada add/remove. Com a API lendo config/servers.list em runtime, nada além
  # do servidor alvo precisa mudar de container.
  docker compose "${COMPOSE_FILES[@]}" up -d --no-recreate
}

# provision <id> [--cstv]
# Cria APENAS o container do servidor (e, com --cstv, os serviços de espectador
# watch-hltv/watch-main). Usado pela API em add. Não recria containers existentes.
cmd_provision() {
  local id="${1:-}" cstv=0 arg
  for arg in "${@:2}"; do
    case "$arg" in
      --cstv) cstv=1 ;;
      *) err "Opção desconhecida: $arg"; return 1 ;;
    esac
  done
  [ -n "$id" ] || { err "Uso: servers.sh provision <id> [--cstv]"; return 1; }
  valid_id "$id" || { err "id inválido: '$id'"; return 1; }

  cmd_init || return 1
  cmd_compose || return 1

  local missing=0 img
  for img in cs16_stats:local csserver_wstats-api; do
    docker image inspect "$img" >/dev/null 2>&1 || { err "Imagem ${img} ausente"; missing=1; }
  done
  if [ "$missing" -eq 1 ]; then
    info "Construindo imagens (primeira vez) ..."
    cmd_build || return 1
  fi

  local svc
  [ "$id" = "main" ] && svc="cs16" || svc="cs16${id}"
  docker compose "${COMPOSE_FILES[@]}" up -d --no-recreate "${svc}" || return 1
  ok "servidor ${id} provisionado (${svc})"

  if [ "$cstv" -eq 1 ]; then
    docker compose "${COMPOSE_FILES[@]}" --profile watch up -d --no-recreate "watch-hltv-${id}" "watch-main-${id}" || return 1
    ok "serviços de espectador (CSTV) iniciados para ${id}"
  fi
}

# unprovision <id>
# Derruba/remove o container do servidor + serviços de espectador. Usado pela
# API em remove. O `servers.sh compose` é rodado AO FINAL para regenerar os
# overrides sem o servidor removido (os containers são removidos com o arquivo
# atual, que ainda os conhece).
cmd_unprovision() {
  local id="${1:-}"
  [ -n "$id" ] || { err "Uso: servers.sh unprovision <id>"; return 1; }
  valid_id "$id" || { err "id inválido: '$id'"; return 1; }

  if [ -f "${ROOT}/${WATCH_OVERRIDE}" ]; then
    docker compose "${COMPOSE_FILES[@]}" --profile watch rm -sf "watch-hltv-${id}" "watch-main-${id}" 2>/dev/null || true
    ok "serviços de espectador de ${id} removidos"
  fi

  local svc
  [ "$id" = "main" ] && svc="cs16" || svc="cs16${id}"
  docker compose "${COMPOSE_FILES[@]}" rm -sf "${svc}" 2>/dev/null || true
  ok "container ${svc} removido"

  cmd_compose || return 1
}

cmd_down() {
  docker compose "${COMPOSE_FILES[@]}" down "$@"
}

cmd_ps() {
  docker compose "${COMPOSE_FILES[@]}" ps
}

cmd_status() {
  info "=== Servidores configurados (${SERVERS_LIST}) ==="
  # Larguras dinâmicas por coluna (max entre cabeçalho e valores) para nunca desalinhar.
  local -a s_rows=()
  local -i w_id=2 w_name=4 w_port=9 w_map=4 w_rot=3 w_max=3
  local line
  while read -r line; do
    local id name host_port map maxplayers rotate context mode
    IFS='|' read -r id name host_port map maxplayers rotate context mode <<< "$line"
    : "${rotate:=yes}"
    : "${context:=$(slugify "$name")}"
    : "${mode:=standard}"
    s_rows+=("${id}|${name}|${host_port}|${map}|${rotate}|${maxplayers}|${context}|${mode}")
    ((${#id} > w_id)) && w_id=${#id}
    ((${#name} > w_name)) && w_name=${#name}
    ((${#host_port} > w_port)) && w_port=${#host_port}
    ((${#map} > w_map)) && w_map=${#map}
    ((${#rotate} > w_rot)) && w_rot=${#rotate}
    ((${#maxplayers} > w_max)) && w_max=${#maxplayers}
  done < <(parse_servers)
  printf '%-*s %-*s %-*s %-*s %-*s %-*s %s\n' \
    "$w_id" "ID" "$w_name" "NOME" "$w_port" "HOST_PORT" "$w_map" "MAPA" \
    "$w_rot" "ROT" "$w_max" "MAX" "CONTEXT"
  for line in "${s_rows[@]}"; do
    local id name host_port map rotate maxplayers context
    IFS='|' read -r id name host_port map rotate maxplayers context <<< "$line"
    printf '%-*s %-*s %-*s %-*s %-*s %-*s %s\n' \
      "$w_id" "$id" "$w_name" "$name" "$w_port" "$host_port" "$w_map" "$map" \
      "$w_rot" "$rotate" "$w_max" "$maxplayers" "$context"
  done
  info ""
  info "=== Containers (por tipo de serviço) ==="

  # Agrupa os containers por tipo usando a SERVICE (não o nome do container,
  # que teria falso match, ex.: cs16-api). Grupos em ordem; "Outros" captura
  # qualquer service nova que ainda não tenha grupo próprio.
  local -a g_labels=(
    'Servidores de jogo (CS 1.6)'
    'Aplicação (API & Frontend)'
    'Dados & Cache'
    'Monitoramento'
    'TLS & DDNS'
    'Espectador (WebRTC)'
    'Outros'
  )
  local -a g_re=(
    '^cs16'
    '^(api|web)$'
    '^(db|redis)$'
    '^(prometheus|grafana|nginx-exporter|nginxlog-exporter|node-exporter|cadvisor)$'
    '^(swag|duckdns)$'
    '^watch-'
    '.*'
  )
  local -a g_rows=()

  local svc name st ports rest g
  while IFS='|' read -r svc name st ports; do
    rest="${name}|${st}|${ports}"
    g=0
    while [ "$g" -lt "${#g_labels[@]}" ]; do
      if [[ "$svc" =~ ${g_re[$g]} ]]; then
        g_rows[$g]+="${rest}"$'\n'
        break
      fi
      g=$((g + 1))
    done
  done < <(docker compose "${COMPOSE_FILES[@]}" ps --format '{{.Service}}|{{.Name}}|{{.Status}}|{{.Ports}}' 2>/dev/null)

  # Larguras máximas de NAME/STATUS sobre todos os grupos (um par só, para o
  # alinhamento bater entre os grupos). PORTS é a última coluna, sem largura fixa.
  local max_name=0 max_status=0
  local row name st ports
  g=0
  while [ "$g" -lt "${#g_labels[@]}" ]; do
    [ -n "${g_rows[$g]:-}" ] || { g=$((g + 1)); continue; }
    while IFS='|' read -r name st ports; do
      ((${#name} > max_name)) && max_name=${#name}
      ((${#st} > max_status)) && max_status=${#st}
    done <<< "${g_rows[$g]%$'\n'}"
    g=$((g + 1))
  done

  local any=0
  g=0
  while [ "$g" -lt "${#g_labels[@]}" ]; do
    if [ -n "${g_rows[$g]:-}" ]; then
      [ "$any" -eq 0 ] || info ""
      info "--- ${g_labels[$g]} ---"
      while IFS='|' read -r name st ports; do
        if [ -n "$ports" ]; then
          printf '  %-*s %-*s %s\n' "$max_name" "$name" "$max_status" "$st" "$ports"
        else
          printf '  %-*s %s\n' "$max_name" "$name" "$st"
        fi
      done <<< "${g_rows[$g]%$'\n'}"
      any=1
    fi
    g=$((g + 1))
  done
  [ "$any" -eq 0 ] && info "  (nenhum container no projeto)"

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

  docker compose "${COMPOSE_FILES[@]}" exec -T api node -e '
    const fs = require("fs")
    const path = require("path")
    const Rcon = require("rcon")
    const [srvId, command] = process.argv.slice(1)
    // A API lê config/servers.list em runtime (sem CS_SERVERS no compose).
    const file = path.join(process.env.SERVER_REPO_DIR || "/repo", "config", "servers.list")
    const entries = []
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const parts = line.trim().split(/\s+/)
        if (!parts[0] || parts[0].startsWith("#")) continue
        entries.push({ id: parts[0], host_port: parts[2] || "27015" })
      }
    } catch (e) { /* fallback no primário */ }
    const srv = entries.find((s) => s.id === srvId) || entries[0] || { id: "main", host_port: process.env.GAMEDIG_PORT || "27015" }
    const host = srv.id === "main" ? (process.env.GAMEDIG_HOST || "cs16") : "cs16" + srv.id
    const port = srv.id === "main" ? parseInt(process.env.GAMEDIG_PORT || "27015", 10) : 27015
    const c = new Rcon(host, port, process.env.RCON_PASSWORD, { tcp: false, challenge: true })
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
  sed -n '2,16p' "${BASH_SOURCE[0]}"
}

case "${1:-}" in
  init)    cmd_init ;;
  compose) cmd_compose ;;
  config)  cmd_config "${@:2}" ;;
  swag-sync) apply_swag_locations ;;
  build)   cmd_build ;;
  up)      cmd_up ;;
  provision) cmd_provision "${@:2}" ;;
  unprovision) cmd_unprovision "${@:2}" ;;
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
