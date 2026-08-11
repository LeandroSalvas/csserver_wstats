#include <amxmodx>
#include <cstrike>

#define PLUGIN  "Live Scoreboard"
#define VERSION "0.4"
#define AUTHOR  "OpenAI"

#define TASK_LIVE_UPDATE 92001
#define OUTPUT_FILE "addons/amxmodx/data/live/live_scoreboard.json"
#define STATE_FILE  "addons/amxmodx/data/live/match_state.dat"

#define MAX_MATCH_PLAYERS 33

new g_map[64]
new g_tRounds
new g_ctRounds
new g_startedAt
new bool:g_hasLastMatch = false
new g_lastMatchStarted
new g_lastMatchEnded
new g_lastMatchT
new g_lastMatchCT
new g_lastMatchMap[64]

// Stats da partida em andamento, por id de jogador (usado também para
// reconstruir a partida anterior após a troca de mapa via STATE_FILE).
new g_matchKills[33]
new g_matchHs[33]
new g_matchDeaths[33]
new g_matchSeen[33]
new g_matchName[33][32]
new g_matchSteam[33][32]
new g_matchTeam[33][16]

// Snapshot dos jogadores da partida anterior (last_match.players).
new g_lmCount
new g_lmName[MAX_MATCH_PLAYERS][32]
new g_lmSteam[MAX_MATCH_PLAYERS][32]
new g_lmTeam[MAX_MATCH_PLAYERS][16]
new g_lmKills[MAX_MATCH_PLAYERS]
new g_lmHs[MAX_MATCH_PLAYERS]
new g_lmDeaths[MAX_MATCH_PLAYERS]

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    register_event("SendAudio", "event_round_end", "a", "2=%!MRAD_terwin")
    register_event("SendAudio", "event_round_end", "a", "2=%!MRAD_ctwin")

    new deathMsgId = get_user_msgid("DeathMsg")
    if (deathMsgId != -1)
    {
        register_message(deathMsgId, "message_death_msg")
    }

    set_task(2.0, "task_write_live_file", TASK_LIVE_UPDATE, "", 0, "b")

    get_mapname(g_map, charsmax(g_map))
    g_startedAt = get_systime()

    recover_match_state()
}

public event_round_end()
{
    new sound[32]
    read_data(2, sound, charsmax(sound))

    if (g_hasLastMatch)
    {
        g_hasLastMatch = false
        g_lastMatchStarted = 0
        g_lastMatchEnded = 0
    }

    if (equali(sound, "%!MRAD_terwin"))
    {
        g_tRounds++
    }
    else if (equali(sound, "%!MRAD_ctwin"))
    {
        g_ctRounds++
    }
}

// DeathMsg do CS 1.6: args 1=vítima, 2=killer, 3=headshot (0/1).
public message_death_msg()
{
    new victim = get_msg_arg_int(1)
    new killer = get_msg_arg_int(2)
    new hs = get_msg_arg_int(3)
    new maxPlayers = get_maxplayers()

    if (killer > 0 && killer <= maxPlayers && killer != victim)
    {
        if (is_user_connected(killer) && !is_user_hltv(killer))
        {
            mark_seen(killer)

            // Team kill não conta como frag no placar do CS.
            if (cs_get_user_team(killer) != cs_get_user_team(victim))
            {
                g_matchKills[killer]++
                if (hs)
                {
                    g_matchHs[killer]++
                }
            }
        }
    }

    if (victim > 0 && victim <= maxPlayers)
    {
        if (is_user_connected(victim) && !is_user_hltv(victim))
        {
            mark_seen(victim)
            g_matchDeaths[victim]++
        }
    }
}

mark_seen(id)
{
    if (g_matchSeen[id])
    {
        return
    }

    g_matchSeen[id] = 1
    get_user_name(id, g_matchName[id], 31)
    get_user_authid(id, g_matchSteam[id], 31)
    sanitize_string(g_matchName[id])

    new team[16]
    team_to_string(cs_get_user_team(id), team, charsmax(team))
    copy(g_matchTeam[id], 15, team)
}

// Remove caracteres que quebram o JSON / o state file.
// (Use literais numéricos: o compilador AMXX 1.8.1 quebra com '\\').
sanitize_string(str[])
{
    new len = strlen(str)

    for (new i = 0; i < len; i++)
    {
        if (str[i] == 34 || str[i] == 92 || str[i] == 124 || str[i] == '^n' || str[i] == '^r')
        {
            str[i] = ' '
        }
    }
}

// A troca de mapa recarrega o plugin, então a partida anterior é reconstruída
// a partir do match_state.dat gravado pelo tick anterior (mapa/placar/início +
// jogadores). Só é emitida se a partida anterior foi em outro mapa.
recover_match_state()
{
    new fp = fopen(STATE_FILE, "rt")

    if (!fp)
    {
        return
    }

    new line[192]
    new prevMap[64]
    new prevT = 0
    new prevCT = 0
    new prevStarted = 0
    new bool:foundMap = false
    new count = 0

    g_lmCount = 0

    while (fgets(fp, line, charsmax(line)))
    {
        if (equali(line, "map=", 4))
        {
            copy(prevMap, charsmax(prevMap), line[4])
            strip_newline(prevMap)
            foundMap = true
        }
        else if (equali(line, "round_t=", 8))
        {
            prevT = str_to_num(line[8])
        }
        else if (equali(line, "round_ct=", 9))
        {
            prevCT = str_to_num(line[9])
        }
        else if (equali(line, "started_at=", 11))
        {
            prevStarted = str_to_num(line[11])
        }
        else if (equali(line, "p=", 2))
        {
            parse_player_line(line[2], count)
            count++
        }
    }

    fclose(fp)

    new mapname[64]
    get_mapname(mapname, charsmax(mapname))

    if (!foundMap || equal(prevMap, mapname) || prevT + prevCT <= 0)
    {
        g_lmCount = 0
        return
    }

    g_hasLastMatch = true
    g_lastMatchStarted = prevStarted
    g_lastMatchEnded = get_systime()
    g_lastMatchT = prevT
    g_lastMatchCT = prevCT
    copy(g_lastMatchMap, charsmax(g_lastMatchMap), prevMap)
}

strip_newline(str[])
{
    new len = strlen(str)

    for (new i = len - 1; i >= 0; i--)
    {
        if (str[i] == '^n' || str[i] == '^r' || str[i] == ' ')
        {
            str[i] = '^0'
        }
        else
        {
            break
        }
    }
}

// linha "name|steamid|team|kills|deaths|hs"
parse_player_line(const src[], slot)
{
    if (slot >= MAX_MATCH_PLAYERS)
    {
        return
    }

    new buf[192]
    copy(buf, charsmax(buf), src)

    new sep[3] = "|"
    new pos = 0
    new field = 0
    new len = strlen(buf)

    for (new i = 0; i <= len; i++)
    {
        if (buf[i] == '|' || buf[i] == '^n' || buf[i] == '^r' || buf[i] == '^0')
        {
            buf[i] = '^0'

            switch (field)
            {
                case 0:
                {
                    copy(g_lmName[slot], 31, buf[pos])
                    g_lmCount++
                }
                case 1:
                {
                    copy(g_lmSteam[slot], 31, buf[pos])
                }
                case 2:
                {
                    copy(g_lmTeam[slot], 15, buf[pos])
                }
                case 3:
                {
                    g_lmKills[slot] = str_to_num(buf[pos])
                }
                case 4:
                {
                    g_lmDeaths[slot] = str_to_num(buf[pos])
                }
                case 5:
                {
                    g_lmHs[slot] = str_to_num(buf[pos])
                }
            }

            field++
            pos = i + 1
        }
    }
}

public task_write_live_file()
{
    new mapname[64]
    get_mapname(mapname, charsmax(mapname))

    if (!equal(mapname, g_map))
    {
        if (g_tRounds + g_ctRounds > 0)
        {
            g_hasLastMatch = true
            g_lastMatchStarted = g_startedAt
            g_lastMatchEnded = get_systime()
            g_lastMatchT = g_tRounds
            g_lastMatchCT = g_ctRounds
            copy(g_lastMatchMap, charsmax(g_lastMatchMap), g_map)
            snapshot_working_players()
        }

        copy(g_map, charsmax(g_map), mapname)
        g_tRounds = 0
        g_ctRounds = 0
        g_startedAt = get_systime()
    }

    write_live_file()
    write_match_state()
}

// Copia as stats da partida em andamento para o snapshot da partida anterior.
snapshot_working_players()
{
    g_lmCount = 0
    new maxPlayers = get_maxplayers()

    for (new id = 1; id <= maxPlayers; id++)
    {
        if (!g_matchSeen[id])
        {
            continue
        }

        if (g_lmCount >= MAX_MATCH_PLAYERS)
        {
            break
        }

        new team[16]

        if (is_user_connected(id))
        {
            team_to_string(cs_get_user_team(id), team, charsmax(team))
        }
        else
        {
            copy(team, charsmax(team), g_matchTeam[id])
        }

        copy(g_lmName[g_lmCount], 31, g_matchName[id])
        copy(g_lmSteam[g_lmCount], 31, g_matchSteam[id])
        copy(g_lmTeam[g_lmCount], 15, team)
        g_lmKills[g_lmCount] = g_matchKills[id]
        g_lmDeaths[g_lmCount] = g_matchDeaths[id]
        g_lmHs[g_lmCount] = g_matchHs[id]
        g_lmCount++
    }
}

write_live_file()
{
    new fp = fopen(OUTPUT_FILE, "wt")

    if (!fp)
    {
        return
    }

    new hostname[128], mapname[64]
    get_cvar_string("hostname", hostname, charsmax(hostname))
    get_mapname(mapname, charsmax(mapname))

    fprintf(fp, "{")
    fprintf(fp, "^"hostname^":^"%s^",", hostname)
    fprintf(fp, "^"map^":^"%s^",", mapname)
    fprintf(fp, "^"round_t^":%d,", g_tRounds)
    fprintf(fp, "^"round_ct^":%d,", g_ctRounds)
    fprintf(fp, "^"map_started_at^":%d,", g_startedAt)
    fprintf(fp, "^"last_match^":")

    if (g_hasLastMatch)
    {
        fprintf(fp, "{")
        fprintf(fp, "^"map^":^"%s^",", g_lastMatchMap)
        fprintf(fp, "^"round_t^":%d,", g_lastMatchT)
        fprintf(fp, "^"round_ct^":%d,", g_lastMatchCT)
        fprintf(fp, "^"started_at^":%d,", g_lastMatchStarted)
        fprintf(fp, "^"ended_at^":%d,", g_lastMatchEnded)
        fprintf(fp, "^"players^":[")
        write_last_match_players(fp)
        fprintf(fp, "]")
        fprintf(fp, "}")
    }
    else
    {
        fprintf(fp, "null")
    }

    fprintf(fp, ",^"players^":[")
    write_current_players(fp)
    fprintf(fp, "]}")
    fclose(fp)
}

write_last_match_players(fp)
{
    for (new i = 0; i < g_lmCount; i++)
    {
        if (i)
        {
            fprintf(fp, ",")
        }

        fprintf(fp, "{^"name^":^"%s^",^"steamid^":^"%s^",^"team^":^"%s^",^"kills^":%d,^"deaths^":%d,^"hs^":%d}",
            g_lmName[i], g_lmSteam[i], g_lmTeam[i], g_lmKills[i], g_lmDeaths[i], g_lmHs[i])
    }
}

write_current_players(fp)
{
    new maxPlayers = get_maxplayers()
    new first = 1

    for (new id = 1; id <= maxPlayers; id++)
    {
        if (!is_user_connected(id))
            continue

        if (is_user_hltv(id))
            continue

        new name[64], steamid[35], teamStr[16]
        new score, deaths, alive

        get_user_name(id, name, charsmax(name))
        get_user_authid(id, steamid, charsmax(steamid))
        sanitize_string(name)

        score = get_user_frags(id)
        deaths = cs_get_user_deaths(id)
        alive = is_user_alive(id)

        team_to_string(cs_get_user_team(id), teamStr, charsmax(teamStr))

        if (!first)
        {
            fprintf(fp, ",")
        }
        first = 0

        fprintf(fp, "{")
        fprintf(fp, "^"id^":%d,", id)
        fprintf(fp, "^"name^":^"%s^",", name)
        fprintf(fp, "^"steamid^":^"%s^",", steamid)
        fprintf(fp, "^"team^":^"%s^",", teamStr)
        fprintf(fp, "^"alive^":%s,", alive ? "true" : "false")
        fprintf(fp, "^"score^":%d,", score)
        fprintf(fp, "^"deaths^":%d", deaths)
        fprintf(fp, "}")
    }
}

// State file simples (um campo por linha) para reconstrução pós troca de mapa:
//   map=<mapa>
//   round_t=N / round_ct=N / started_at=N
//   p=<name>|<steamid>|<team>|<kills>|<deaths>|<hs>
write_match_state()
{
    new fp = fopen(STATE_FILE, "wt")

    if (!fp)
    {
        return
    }

    new mapname[64]
    get_mapname(mapname, charsmax(mapname))

    fprintf(fp, "map=%s^n", mapname)
    fprintf(fp, "round_t=%d^n", g_tRounds)
    fprintf(fp, "round_ct=%d^n", g_ctRounds)
    fprintf(fp, "started_at=%d^n", g_startedAt)

    new maxPlayers = get_maxplayers()

    for (new id = 1; id <= maxPlayers; id++)
    {
        if (!g_matchSeen[id])
        {
            continue
        }

        if (is_user_connected(id))
        {
            mark_seen(id)
        }

        if (g_matchName[id][0] == '^0')
        {
            continue
        }

        new team[16]

        if (is_user_connected(id))
        {
            team_to_string(cs_get_user_team(id), team, charsmax(team))
        }
        else
        {
            copy(team, charsmax(team), g_matchTeam[id])
        }

        fprintf(fp, "p=%s|%s|%s|%d|%d|%d^n",
            g_matchName[id], g_matchSteam[id], team,
            g_matchKills[id], g_matchDeaths[id], g_matchHs[id])
    }

    fclose(fp)
}

team_to_string(CsTeams:team, output[], len)
{
    switch (team)
    {
        case CS_TEAM_T:
            copy(output, len, "T")

        case CS_TEAM_CT:
            copy(output, len, "CT")

        case CS_TEAM_SPECTATOR:
            copy(output, len, "SPEC")

        default:
            copy(output, len, "UNASSIGNED")
    }
}
