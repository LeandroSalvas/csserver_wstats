#!/bin/bash
# Inicia o relay HLTV do servidor 'gungame' (GunGame) — gerado por servers.sh init.
# O hltv.cfg (mesmo diretório) é executado automaticamente e contém o connect.
cd /home/cs16

while true; do
  LD_LIBRARY_PATH=/home/cs16 ./hltv -port 27101 &
  HLTV_PID=$!
  echo "$HLTV_PID" > /home/cs16/hltv.pid
  wait "$HLTV_PID"
  echo "hltv crashed on $(date)" > /home/cs16/watch_logs/last_hltv_crash.txt
  sleep 3
done
