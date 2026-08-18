FROM leandrosalvas/cs16_stats
COPY start-server.sh /home/cs16/start-server.sh
RUN chmod +x /home/cs16/start-server.sh
# ZBot (bot nativo do ReGameDLL — substitui PodBOT)
COPY vendor/regamedll/cstrike/BotProfile.db /home/cs16/cstrike/BotProfile.db
COPY vendor/regamedll/cstrike/BotChatter.db /home/cs16/cstrike/BotChatter.db
COPY vendor/sound/radio/bot/ /home/cs16/cstrike/sound/radio/bot/

# ============================================================
# Stack UAC (produção) — substitui dproto por ReHLDS +
# ReGameDLL_CS + Metamod-R + ReUnion + AMXX 1.10 + UAC.
# Binários em vendor/ (gitignored), pinados por versão.
# ============================================================

# ReHLDS 3.15.0.896 — engine (inclui hltv/proxy version-lockados)
COPY vendor/rehlds/core.so /home/cs16/core.so
COPY vendor/rehlds/demoplayer.so /home/cs16/demoplayer.so
COPY vendor/rehlds/engine_i486.so /home/cs16/engine_i486.so
COPY vendor/rehlds/filesystem_stdio.so /home/cs16/filesystem_stdio.so
COPY vendor/rehlds/hlds_linux /home/cs16/hlds_linux
COPY vendor/rehlds/hltv /home/cs16/hltv
COPY vendor/rehlds/proxy.so /home/cs16/proxy.so
COPY vendor/rehlds/valve/dlls/director.so /home/cs16/valve/dlls/director.so

# ReGameDLL_CS 5.30.0.814 — game dll + cfgs + delta.lst
COPY vendor/regamedll/cstrike/dlls/cs.so /home/cs16/cstrike/dlls/cs.so
COPY vendor/regamedll/cstrike/game.cfg /home/cs16/cstrike/game.cfg
COPY vendor/regamedll/cstrike/game_init.cfg /home/cs16/cstrike/game_init.cfg
COPY vendor/regamedll/cstrike/delta.lst /home/cs16/cstrike/delta.lst

# Metamod-R 1.3.0.149 (liblist.gam já aponta para addons/metamod/dlls/metamod.so)
COPY vendor/metamod/metamod.so /home/cs16/cstrike/addons/metamod/dlls/metamod.so
COPY vendor/metamod/plugins.ini /home/cs16/cstrike/addons/metamod/plugins.ini

# ReUnion 0.2.0.25 — auth não-Steam (substitui dproto)
COPY vendor/reunion/reunion_mm_i386.so /home/cs16/cstrike/addons/reunion/reunion_mm_i386.so
COPY vendor/reunion/reunion.cfg /home/cs16/cstrike/addons/reunion/reunion.cfg
RUN rm -rf /home/cs16/cstrike/addons/dproto

# AMXX 1.10.0-git5479 (substitui 1.8.2)
COPY vendor/amxmodx/ /home/cs16/cstrike/addons/amxmodx/
COPY vendor/modules.ini /home/cs16/cstrike/addons/amxmodx/configs/modules.ini

# UAC v1.6 — ReChecker/WHBlocker (metamod) + plugins amxx + configs
COPY vendor/uac/amxmodx/plugins/ByM_UltimateAntiCheat.amxx /home/cs16/cstrike/addons/amxmodx/plugins/ByM_UltimateAntiCheat.amxx
COPY vendor/uac/amxmodx/plugins/ReCheckerLogger.amxx /home/cs16/cstrike/addons/amxmodx/plugins/ReCheckerLogger.amxx
COPY vendor/uac/amxmodx/configs/UltimateAntiCheat /home/cs16/cstrike/addons/amxmodx/configs/UltimateAntiCheat
COPY vendor/uac/amxmodx/data/lang/UltimateAntiCheat.txt /home/cs16/cstrike/addons/amxmodx/data/lang/UltimateAntiCheat.txt
COPY vendor/uac/rechecker /home/cs16/cstrike/addons/rechecker
COPY vendor/uac/whblocker_newest /home/cs16/cstrike/addons/whblocker_newest

# ============================================================
# Game Modes — plugins AMXX + configs + lang + sounds
# ============================================================

# Todos os plugins modos (ZP, CSDM, regg, surf) + base
COPY plugins/ /home/cs16/cstrike/addons/amxmodx/plugins/

# regg sounds (GunGame)
COPY vendor/sound/regg/ /home/cs16/cstrike/sound/regg/

# ZP resources (player models + view models + sounds + sprites)
COPY vendor/models/player/ /home/cs16/cstrike/models/player/
COPY vendor/models/zombie_plague/ /home/cs16/cstrike/models/zombie_plague/
COPY vendor/sound/zombie_plague/ /home/cs16/cstrike/sound/zombie_plague/
COPY vendor/sound/warcraft3/ /home/cs16/cstrike/sound/warcraft3/
COPY vendor/sprites/flame.spr /home/cs16/cstrike/sprites/flame.spr

# dirs de log do UAC e permissões de escrita para o processo do servidor
RUN mkdir -p /home/cs16/cstrike/addons/amxmodx/logs/ReChecker_Logs \
             /home/cs16/cstrike/addons/rechecker/logs \
             /home/cs16/cstrike/addons/whblocker_newest/logs \
  && chmod -R a+rwX /home/cs16/cstrike/addons/amxmodx \
                    /home/cs16/cstrike/addons/reunion \
                    /home/cs16/cstrike/addons/rechecker \
                    /home/cs16/cstrike/addons/whblocker_newest \
  && chmod +x /home/cs16/hlds_linux /home/cs16/hltv \
              /home/cs16/engine_i486.so /home/cs16/filesystem_stdio.so \
              /home/cs16/core.so /home/cs16/proxy.so /home/cs16/demoplayer.so \
              /home/cs16/cstrike/dlls/cs.so

ENTRYPOINT ["/home/cs16/start-server.sh"]
