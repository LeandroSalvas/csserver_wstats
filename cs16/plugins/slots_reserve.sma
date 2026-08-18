#include <amxmodx>

#define PLUGIN  "Slots Reserve HLTV"
#define VERSION "1.0"
#define AUTHOR  "OpenAI"

// Reserva 1 slot para o HLTV: o maxplayers real é (vagas visíveis + 1).
// Players humanos que não sejam HLTV são expulsos quando a sala (excluindo o
// slot reservado) já está cheia, com a mensagem em slots_reserve_msg.
// Bots contam como ocupantes de vaga (por isso o piso pb_minbots = 2 reduz em
// 2 a capacidade de humanos de uma sala).

new g_pEnabled
new g_pMessage

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    g_pEnabled = register_cvar("slots_reserve_hltv", "1")
    g_pMessage = register_cvar("slots_reserve_msg", "Slot reservado para o HLTV.")
}

public client_putinserver(id)
{
    if (!get_pcvar_num(g_pEnabled))
        return PLUGIN_CONTINUE

    if (is_user_hltv(id))
        return PLUGIN_CONTINUE

    // Sala cheia = já há (maxplayers - 1) ocupantes não-HLTV (humanos + bots).
    new reserved = get_maxplayers() - 1
    new total = 0

    for (new i = 1; i <= get_maxplayers(); i++)
    {
        if (i != id && is_user_connected(i) && !is_user_hltv(i))
            total++
    }

    if (total >= reserved)
    {
        new msg[64]
        get_pcvar_string(g_pMessage, msg, charsmax(msg))
        server_cmd("kick #%d %s", get_user_userid(id), msg)
    }

    return PLUGIN_CONTINUE
}
