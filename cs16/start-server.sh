#!/bin/bash
# Inicia o servidor CS 1.6 com parâmetros vindos de variáveis de ambiente.
#
# Todas as instâncias usam a porta interna 27015 (isolamento pela rede docker);
# o publish no host é definido no docker-compose (ports).
cd /home/cs16

PORT="${PORT:-27015}"
MAP="${MAP:-de_dust2}"
MAXPLAYERS="${MAXPLAYERS:-32}"
SERVER_ID="${SERVER_ID:-main}"

while true; do
  ./hlds_run -console -game cstrike -insecure +port "$PORT" +map "$MAP" +maxplayers "$MAXPLAYERS" +csstats_sql_server "$SERVER_ID" -sv_lan 1 -sv_region 2
  echo "server crashed on $(date)" > last_crash.txt
  sleep 3
done
