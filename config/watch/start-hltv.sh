#!/bin/bash
# Inicia o relay HLTV entre o servidor CS 1.6 e o espectador no browser.
# O hltv.cfg (mesmo diretório) é executado automaticamente e contém o connect.
cd /home/cs16

while true; do
  LD_LIBRARY_PATH=/home/cs16 ./hltv -port 27020 &
  HLTV_PID=$!
  echo "$HLTV_PID" > /home/cs16/hltv.pid
  wait "$HLTV_PID"
  echo "hltv crashed on $(date)" > /home/cs16/watch_logs/last_hltv_crash.txt
  sleep 3
done
