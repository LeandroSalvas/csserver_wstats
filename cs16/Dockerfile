FROM leandrosalvas/cs16_stats
COPY start-server.sh /home/cs16/start-server.sh
RUN chmod +x /home/cs16/start-server.sh
# piso de bots (HLTV não remove o último bot ao conectar); arquivo em CRLF
RUN sed -i 's/^pb_minbots 0\r$/pb_minbots 2/' /home/cs16/cstrike/addons/podbot/podbot.cfg
ENTRYPOINT ["/home/cs16/start-server.sh"]
