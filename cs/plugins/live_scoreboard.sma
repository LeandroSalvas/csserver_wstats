#include <amxmodx>
#include <cstrike>

#define PLUGIN  "Live Scoreboard"
#define VERSION "0.3"
#define AUTHOR  "OpenAI"

#define TASK_LIVE_UPDATE 92001
#define OUTPUT_FILE "addons/amxmodx/data/live/live_scoreboard.json"

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

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    register_event("SendAudio", "event_round_end", "a", "2=%!MRAD_terwin")
    register_event("SendAudio", "event_round_end", "a", "2=%!MRAD_ctwin")

    set_task(2.0, "task_write_live_file", TASK_LIVE_UPDATE, "", 0, "b")

    get_mapname(g_map, charsmax(g_map))
    g_startedAt = get_systime()

    recover_previous_match()
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

// Como a troca de mapa recarrega o plugin, recupera o placar da partida
// anterior gravado no arquivo para emitir o last_match.
recover_previous_match()
{
    new buf[1024]
    new txtlen

    if (!read_file(OUTPUT_FILE, 0, buf, charsmax(buf), txtlen))
    {
        return
    }

    new prevMap[64]
    if (!json_get_string(buf, "map", prevMap, charsmax(prevMap)))
    {
        return
    }

    if (equal(prevMap, g_map))
    {
        return
    }

    new prevT, prevCT, prevStarted
    json_get_int(buf, "round_t", prevT)
    json_get_int(buf, "round_ct", prevCT)
    json_get_int(buf, "map_started_at", prevStarted)

    if (prevT + prevCT <= 0)
    {
        return
    }

    g_hasLastMatch = true
    g_lastMatchStarted = prevStarted
    g_lastMatchEnded = get_systime()
    g_lastMatchT = prevT
    g_lastMatchCT = prevCT
    copy(g_lastMatchMap, charsmax(g_lastMatchMap), prevMap)
}

json_get_string(src[], key[], output[], len)
{
    new needle[64]
    format(needle, charsmax(needle), "^"%s^":^"", key)

    new start = strfind(src, needle)

    if (start == -1)
    {
        return false
    }

    start += strlen(needle)
    new end = start

    while (src[end] && src[end] != '"')
    {
        end++
    }

    if (end - start >= len)
    {
        end = start + len - 1
    }

    copy(output, end - start, src[start])
    return true
}

json_get_int(src[], key[], &value)
{
    new needle[64]
    format(needle, charsmax(needle), "^"%s^":", key)

    new start = strfind(src, needle)

    if (start == -1)
    {
        return false
    }

    start += strlen(needle)
    value = 0

    while (src[start] >= '0' && src[start] <= '9')
    {
        value = value * 10 + (src[start] - '0')
        start++
    }

    return true
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
        }

        copy(g_map, charsmax(g_map), mapname)
        g_tRounds = 0
        g_ctRounds = 0
        g_startedAt = get_systime()
    }

    write_live_file()
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
        fprintf(fp, "^"ended_at^":%d", g_lastMatchEnded)
        fprintf(fp, "}")
    }
    else
    {
        fprintf(fp, "null")
    }

    fprintf(fp, ",^"players^":[")

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

    fprintf(fp, "]}")
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
