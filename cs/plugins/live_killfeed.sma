#include <amxmodx>

#define PLUGIN  "Live Kill Feed"
#define VERSION "0.1"
#define AUTHOR  "OpenAI"

#define OUTPUT_FILE "addons/amxmodx/data/live/live_killfeed.json"
#define MAX_KILLS 5

new g_killer[MAX_KILLS][64]
new g_victim[MAX_KILLS][64]
new g_weapon[MAX_KILLS][32]
new g_headshot[MAX_KILLS]
new g_count = 0
new g_lastMap[64]

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    register_event("DeathMsg", "event_death", "a")
    register_logevent("event_round_restart", 2, "1=Game_C", "1=Game_w")
    register_logevent("event_round_restart", 2, "1&Restart_Round_")

    get_mapname(g_lastMap, charsmax(g_lastMap))
    write_killfeed_file()
}

public plugin_cfg()
{
    check_map_change()
}

public event_death()
{
    new killer = read_data(1)
    new victim = read_data(2)
    new headshot = read_data(3)

    new weapon[32]
    read_data(4, weapon, charsmax(weapon))

    new killerName[64], victimName[64]

    if (killer > 0 && is_user_connected(killer))
    {
        get_user_name(killer, killerName, charsmax(killerName))
    }
    else
    {
        copy(killerName, charsmax(killerName), "World")
    }

    if (victim > 0 && is_user_connected(victim))
    {
        get_user_name(victim, victimName, charsmax(victimName))
    }
    else
    {
        copy(victimName, charsmax(victimName), "Unknown")
    }

    add_kill(killerName, victimName, weapon, headshot)
    write_killfeed_file()
}

public event_round_restart()
{
    clear_killfeed()
    write_killfeed_file()
}

add_kill(const killer[], const victim[], const weapon[], headshot)
{
    new i

    if (g_count < MAX_KILLS)
    {
        for (i = g_count; i > 0; i--)
        {
            copy(g_killer[i], charsmax(g_killer[]), g_killer[i - 1])
            copy(g_victim[i], charsmax(g_victim[]), g_victim[i - 1])
            copy(g_weapon[i], charsmax(g_weapon[]), g_weapon[i - 1])
            g_headshot[i] = g_headshot[i - 1]
        }

        copy(g_killer[0], charsmax(g_killer[]), killer)
        copy(g_victim[0], charsmax(g_victim[]), victim)
        copy(g_weapon[0], charsmax(g_weapon[]), weapon)
        g_headshot[0] = headshot

        g_count++
    }
    else
    {
        for (i = MAX_KILLS - 1; i > 0; i--)
        {
            copy(g_killer[i], charsmax(g_killer[]), g_killer[i - 1])
            copy(g_victim[i], charsmax(g_victim[]), g_victim[i - 1])
            copy(g_weapon[i], charsmax(g_weapon[]), g_weapon[i - 1])
            g_headshot[i] = g_headshot[i - 1]
        }

        copy(g_killer[0], charsmax(g_killer[]), killer)
        copy(g_victim[0], charsmax(g_victim[]), victim)
        copy(g_weapon[0], charsmax(g_weapon[]), weapon)
        g_headshot[0] = headshot
    }
}

clear_killfeed()
{
    new i

    for (i = 0; i < MAX_KILLS; i++)
    {
        g_killer[i][0] = 0
        g_victim[i][0] = 0
        g_weapon[i][0] = 0
        g_headshot[i] = 0
    }

    g_count = 0
}

check_map_change()
{
    new currentMap[64]
    get_mapname(currentMap, charsmax(currentMap))

    if (!equal(currentMap, g_lastMap))
    {
        copy(g_lastMap, charsmax(g_lastMap), currentMap)
        clear_killfeed()
        write_killfeed_file()
    }
}

write_killfeed_file()
{
    new fp = fopen(OUTPUT_FILE, "wt")

    if (!fp)
    {
        return
    }

    fprintf(fp, "[")

    for (new i = 0; i < g_count; i++)
    {
        if (i > 0)
        {
            fprintf(fp, ",")
        }

        fprintf(fp, "{")
        fprintf(fp, "^"killer^":^"%s^",", g_killer[i])
        fprintf(fp, "^"victim^":^"%s^",", g_victim[i])
        fprintf(fp, "^"weapon^":^"%s^",", g_weapon[i])
        fprintf(fp, "^"headshot^":%s", g_headshot[i] ? "true" : "false")
        fprintf(fp, "}")
    }

    fprintf(fp, "]")
    fclose(fp)
}
