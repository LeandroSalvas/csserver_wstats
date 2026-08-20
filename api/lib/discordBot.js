// Bot Discord: gerencia a stack via comandos de texto no canal (prefixo '!').
// Roda no processo da API e chama os módulos internos diretamente (sem HTTP).
// Permissão: somente membros com role em DISCORD_ALLOWED_ROLE_IDS ou ID em
// DISCORD_ALLOWED_USER_IDS (separados por vírgula). Sem token/permissão o bot
// é desabilitado sem crash (mesmo padrão do webhook).

const { Client, GatewayIntentBits } = require('discord.js')
const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')

const {
  getProvider,
  stackHealthState,
  runRconCommand,
  findServer,
  queryServer,
  withTimeout,
  sendAlert,
  db,
  serverRepoDir,
  stackServiceLabel,
  NOT_BOT
} = require('./core')

const execFileAsync = promisify(execFile)
const STACK_PROJECT = process.env.STACK_PROJECT || 'csserver_wstats'

const PREFIX = '!'
const MAX_REPLY = 1900

function splitList(val) {
  return String(val || '').split(',').map((s) => s.trim()).filter(Boolean)
}

let client = null

function hasPermission(msg) {
  const allowedUsers = splitList(process.env.DISCORD_ALLOWED_USER_IDS)
  if (allowedUsers.includes(msg.author.id)) return true
  if (!msg.guild) return false
  const allowedRoles = splitList(process.env.DISCORD_ALLOWED_ROLE_IDS)
  if (!allowedRoles.length || !msg.member) return false
  return allowedRoles.some((roleId) => msg.member.roles.cache.has(roleId))
}

function sendReplies(msg, text) {
  const parts = []
  let current = ''
  for (const line of String(text).split('\n')) {
    if (current.length + line.length + 1 > MAX_REPLY) {
      parts.push(current)
      current = line
    } else {
      current += (current ? '\n' : '') + line
    }
  }
  if (current) parts.push(current)
  if (!parts.length) parts.push('(sem resposta)')
  msg.reply(parts[0])
  for (const part of parts.slice(1)) {
    msg.channel.send(part)
  }
}

async function listServers() {
  const provider = getProvider()
  const servers = await provider.list()
  const lines = []
  for (const s of servers) {
    const label = `${s.id} (${s.name})`
    if (s.containerState === 'running') {
      let map = '-'
      let players = '-'
      const cfg = findServer(s.id)
      if (cfg) {
        try {
          const state = await withTimeout(queryServer(cfg), 4000)
          map = state.map || '-'
          players = Array.isArray(state.players) ? `${state.players.length}/${state.maxplayers ?? '?'}` : '-'
        } catch (err) {
          // sem resposta do GameDig: mantém dados estáticos
        }
      }
      lines.push(`🟢 **${label}** — rodando | mapa ${map} | jogadores ${players}`)
    } else {
      lines.push(`🔴 **${label}** — parado`)
    }
  }
  return `**Servidores**\n${lines.join('\n')}`
}

async function stackStatus() {
  const keys = Object.keys(stackHealthState)
  if (!keys.length) return '**Stack**\nNenhum serviço rastreado ainda.'
  const up = keys.filter((k) => stackHealthState[k] === true).sort()
  const down = keys.filter((k) => stackHealthState[k] !== true).sort()
  const lines = []
  if (down.length) lines.push(`🔴 ${down.map((k) => stackServiceLabel(k)).join(', ')}`)
  lines.push(`🟢 ${up.map((k) => stackServiceLabel(k)).join(', ')}`)
  return `**Stack (${up.length}/${keys.length} no ar)**\n${lines.join('\n')}`
}

async function runServerCommand(action, id, msg) {
  const provider = getProvider()
  const servers = await provider.list()
  const known = servers.find((s) => s.id === id)
  if (!known) return `Servidor \`${id}\` não encontrado.`
  const label = known.name || id
  const verb = { start: 'iniciado', stop: 'parado', restart: 'reiniciado' }[action]
  try {
    const result = await provider[action](id)
    await sendAlert(`🤖 Discord: **${action}** do servidor **${label}** (por ${msg.author.username})`)
    return `✅ Servidor **${label}** ${verb}${result && result.detail ? ` — ${result.detail}` : ''}.`
  } catch (err) {
    return `❌ Falha ao ${action} **${label}**: ${err.message || err}`
  }
}

const RCON_WHITELIST = /^(status|map|changelevel|mp_|sv_|amx_cfg|amx_reloadadmins|say|difficulty|sv_gravity|sv_maxspeed|sv_airaccelerate|mp_buytime|mp_freezetime|mp_roundtime|mp_timelimit|mp_maxrounds|mp_winlimit|mp_fraglimit|restart|quit)$/i

function isRconAllowed(command) {
  return RCON_WHITELIST.test(command.trim().split(/\s+/)[0])
}

async function rconCommand(id, command, msg) {
  const rconPassword = process.env.RCON_PASSWORD
  if (!rconPassword) return 'RCON não configurado (RCON_PASSWORD).'
  const servers = await getProvider().list()
  const known = servers.find((s) => s.id === id)
  if (!known) return `Servidor \`${id}\` não encontrado.`
  if (!isRconAllowed(command)) return `❌ Comando não permitido via bot: \`${command.split(/\s+/)[0]}\``
  try {
    const output = await runRconCommand(rconPassword, command, id)
    await sendAlert(`🤖 Discord: RCON \`${command}\` em **${known.name || id}** (por ${msg.author.username})`)
    return `**RCON \`${command}\` em ${known.name || id}:**\n${output || '(sem retorno)'}`
  } catch (err) {
    return `❌ Falha no RCON: ${err.message || err}`
  }
}

// --- Helpers ---

function truncate(text, max = MAX_REPLY) {
  const s = String(text)
  if (s.length <= max) return s
  return s.slice(0, max) + '\n… (truncado)'
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(sec % 60)}s`
}

async function dockerExec(args, timeout = 30000) {
  const { stdout } = await execFileAsync('docker', args, { timeout, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

// Resolve id de servidor / serviço da stack / nome de container → nome do container.
async function resolveContainer(target) {
  if (!target) return null
  const out = await dockerExec([
    'ps', '-a',
    '--filter', `label=com.docker.compose.project=${STACK_PROJECT}`,
    '--format', '{{.Label "com.docker.compose.service"}}|{{.Names}}'
  ])
  const byService = {}
  const names = new Set()
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [service, name] = line.split('|')
    if (!name) continue
    byService[service] = name
    names.add(name)
    if (service) names.add(service)
  }
  if (names.has(target)) return target
  const servers = await getProvider().list()
  const srv = servers.find((s) => s.id === target)
  if (srv) {
    const svc = srv.id === 'main' ? 'cs16' : `cs16${srv.id}`
    if (byService[svc]) return byService[svc]
  }
  if (byService[`watch-main-${target}`]) return byService[`watch-main-${target}`]
  if (byService[`watch-hltv-${target}`]) return byService[`watch-hltv-${target}`]
  return null
}

// --- Comandos ---

async function listMaps() {
  try {
    const maps = await getProvider().availableMaps()
    if (!maps.length) return 'Nenhum mapa disponível.'
    return `**Mapas disponíveis (${maps.length})**\n${truncate(maps.join(' '), MAX_REPLY)}`
  } catch (err) {
    return `❌ Falha ao listar mapas: ${err.message || err}`
  }
}

async function changeLevel(id, map, msg) {
  const rconPassword = process.env.RCON_PASSWORD
  if (!rconPassword) return 'RCON não configurado (RCON_PASSWORD).'
  const servers = await getProvider().list()
  const known = servers.find((s) => s.id === id)
  if (!known) return `Servidor \`${id}\` não encontrado.`
  if (!/^[a-z0-9_]+$/.test(map)) return `Mapa inválido: \`${map}\`.`
  try {
    const output = await runRconCommand(rconPassword, `changelevel ${map}`, id)
    await sendAlert(`🤖 Discord: changelevel \`${map}\` em **${known.name || id}** (por ${msg.author.username})`)
    return `✅ Changelevel para **${map}** em **${known.name || id}**.${output ? `\n${output}` : ''}`
  } catch (err) {
    return `❌ Falha no changelevel: ${err.message || err}`
  }
}

function formatPlayer(p) {
  const kills = Number(p.kills || 0)
  const deaths = Number(p.deaths || 0)
  const hs = Number(p.hs || 0)
  const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills > 0 ? '∞' : '0.00'
  const hsPct = kills > 0 ? ((hs / kills) * 100).toFixed(1) : '0.0'
  const hours = (Number(p.connection_time || 0) / 3600).toFixed(1)
  return [
    `**${p.name || p.steamid}**`,
    `SteamID: ${p.steamid}`,
    `Skill: ${Number(p.skill || 0).toFixed(1)} | K: ${kills} | D: ${deaths} | KD: ${kd}`,
    `HS: ${hs} (${hsPct}%) | Assists: ${Number(p.assists || 0)} | TKs: ${Number(p.tks || 0)}`,
    `Tempo: ${hours}h | Connects: ${Number(p.connects || 0)}`,
    `Última vez: ${p.last_join ? new Date(p.last_join).toLocaleDateString('pt-BR') : '-'} | Servidores: ${p.server_name || '-'}`
  ].join('\n')
}

async function playerStats(query) {
  const q = String(query || '').trim()
  if (!q) return 'Informe um nome ou steamid.'
  if (q.length > 64) return 'Busca muito longa (máx 64).'

  if (/^STEAM_[0-9]:[0-9]:[0-9]+$/i.test(q) || /^\[U:1:[0-9]+\]$/.test(q)) {
    const [rows] = await db.query(
      `SELECT steamid, MAX(name) AS name, MAX(skill) AS skill, SUM(kills) AS kills,
              SUM(deaths) AS deaths, SUM(hs) AS hs, SUM(tks) AS tks, SUM(assists) AS assists,
              SUM(connection_time) AS connection_time, SUM(connects) AS connects,
              MIN(first_join) AS first_join, MAX(last_join) AS last_join,
              GROUP_CONCAT(DISTINCT server_name ORDER BY server_name) AS server_name
       FROM csstats WHERE steamid = ? AND ${NOT_BOT} GROUP BY steamid`,
      [q]
    )
    const p = rows[0]
    if (!p) return `Jogador \`${q}\` não encontrado.`
    return formatPlayer(p)
  }

  const [rows] = await db.query(
    `SELECT steamid, MAX(name) AS name, SUM(kills) AS kills, SUM(deaths) AS deaths,
            SUM(hs) AS hs, MAX(skill) AS skill
     FROM csstats WHERE (name LIKE ? OR steamid LIKE ?) AND ${NOT_BOT}
     GROUP BY steamid ORDER BY kills DESC LIMIT 10`,
    [`%${q}%`, `%${q}%`]
  )
  if (!rows.length) return `Nenhum jogador encontrado para \`${q}\`.`
  if (rows.length === 1) return formatPlayer(rows[0])
  const lines = rows.map((r, i) => `${i + 1}. **${r.name || r.steamid}** — ${r.kills} kills | skill ${r.skill ?? '-'}`)
  return `**Candidatos para "${q}"**\n${lines.join('\n')}\nUse \`!player <steamid>\` para stats completos.`
}

async function containerLogs(target, n) {
  const name = await resolveContainer(target)
  if (!name) {
    return `Container \`${target}\` não encontrado. Tente um id de servidor (ex.: zueira2), serviço (api, web, db) ou nome do container.`
  }
  const lines = Number.isFinite(n) && n > 0 ? Math.min(200, Math.floor(n)) : 30
  try {
    const out = await dockerExec(['logs', '--tail', String(lines), '--timestamps', name], 15000)
    return `**Logs ${name} (últimas ${lines} linhas):**\n${truncate(out, MAX_REPLY)}`
  } catch (err) {
    return `❌ Falha ao ler logs de ${name}: ${err.stderr || err.message}`
  }
}

async function dockerStats() {
  try {
    const names = await dockerExec([
      'ps',
      '--filter', `label=com.docker.compose.project=${STACK_PROJECT}`,
      '--format', '{{.Names}}'
    ])
    const list = names.split('\n').filter(Boolean)
    if (!list.length) return 'Nenhum container do projeto em execução.'
    const out = await dockerExec([
      'stats', '--no-stream',
      '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}',
      ...list
    ], 30000)
    const lines = out.split('\n').filter(Boolean).map((line) => {
      const [name, cpu, mem, memPct] = line.split('|')
      return `${name.replace(/^\//, '')} — CPU ${cpu} | Mem ${mem} (${memPct})`
    })
    return `**docker stats**\n${truncate(lines.join('\n'), MAX_REPLY)}`
  } catch (err) {
    return `❌ Falha no docker stats: ${err.stderr || err.message}`
  }
}

async function watchStatus(id) {
  const servers = await getProvider().list()
  const targets = id ? servers.filter((s) => s.id === id) : servers
  if (!targets.length) return `Servidor \`${id}\` não encontrado.`
  const out = []
  for (const s of targets) {
    const lines = [`**${s.id}** (${s.name})`]
    for (const kind of ['hltv', 'main']) {
      const name = `cs16-watch-${kind}-${s.id}`
      try {
        const info = await dockerExec([
          'inspect', '--format',
          '{{if .State.Health}}{{.State.Health.Status}}{{else}}sem healthcheck{{end}}',
          name
        ])
        lines.push(`  ${kind}: ${info.trim() || '?'}`)
      } catch (err) {
        lines.push(`  ${kind}: ausente`)
      }
    }
    const dir = path.join(serverRepoDir, 'live', 'watch', s.id)
    try {
      const crash = fs.readFileSync(path.join(dir, 'last_hltv_crash.txt'), 'utf8').trim()
      if (crash) lines.push(`  último crash: ${crash}`)
    } catch (err) {}
    try {
      const mudoCount = fs.readFileSync(path.join(dir, '.mudo_count'), 'utf8').trim()
      if (mudoCount && mudoCount !== '0') lines.push(`  episódios de mudo: ${mudoCount}`)
    } catch (err) {}
    out.push(lines.join('\n'))
  }
  return `**Espectadores**\n${out.join('\n\n')}`
}

function uptimeInfo() {
  const keys = Object.keys(stackHealthState)
  const up = keys.filter((k) => stackHealthState[k] === true).length
  const version = require('../package.json').version
  return `**Uptime da API:** ${formatUptime(process.uptime())}\n**Versão:** ${version}\n**Stack:** ${up}/${keys.length} serviços no ar`
}

const HELP = '**Comandos**\n' +
  '`!status` — servidores + stack\n' +
  '`!servidores` — lista os servidores de jogo\n' +
  '`!stack` — estado dos serviços da stack\n' +
  '`!start <id>` / `!stop <id>` / `!restart <id>` — controle de servidor\n' +
  '`!rcon <id> <comando>` — RCON no servidor\n' +
  '`!changelevel <id> <mapa>` — troca o mapa do servidor\n' +
  '`!mapas` — mapas disponíveis\n' +
  '`!player <nome ou steamid>` — stats do jogador\n' +
  '`!logs <id|serviço> [n]` — últimas linhas de log de um container\n' +
  '`!ps` — CPU/memória dos containers\n' +
  '`!watch [id]` — saúde dos espectadores\n' +
  '`!uptime` — uptime/versão da API\n' +
  '`!ajuda` — esta mensagem'

async function handleMessage(msg) {
  if (msg.author.bot) return
  const content = msg.content.trim()
  if (!content.startsWith(PREFIX)) return

  if (!hasPermission(msg)) {
    return msg.reply('Você não tem permissão para controlar a stack pelo bot.')
  }

  const parts = content.slice(PREFIX.length).trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()

  try {
    if (cmd === 'ajuda' || cmd === 'help') return sendReplies(msg, HELP)
    if (cmd === 'status') {
      const [servers, stack] = await Promise.all([listServers(), stackStatus()])
      return sendReplies(msg, `${servers}\n\n${stack}`)
    }
    if (cmd === 'servidores') return sendReplies(msg, await listServers())
    if (cmd === 'stack') return sendReplies(msg, await stackStatus())
    if (cmd === 'start' || cmd === 'stop' || cmd === 'restart') {
      const id = parts[1]
      if (!id) return msg.reply(`Uso: \`!${cmd} <id>\``)
      return msg.reply(await runServerCommand(cmd, id, msg))
    }
    if (cmd === 'rcon') {
      const id = parts[1]
      const rest = content.slice(PREFIX.length + cmd.length).trim()
      const command = rest.replace(id, '').trim()
      if (!id || !command) return msg.reply('Uso: `!rcon <id> <comando>`')
      return msg.reply(await rconCommand(id, command, msg))
    }
    if (cmd === 'mapas') return sendReplies(msg, await listMaps())
    if (cmd === 'changelevel') {
      const id = parts[1]
      const map = parts[2]
      if (!id || !map) return msg.reply('Uso: `!changelevel <id> <mapa>`')
      return msg.reply(await changeLevel(id, map, msg))
    }
    if (cmd === 'player') {
      const q = content.slice(PREFIX.length + cmd.length).trim()
      if (!q) return msg.reply('Uso: `!player <nome ou steamid>`')
      return sendReplies(msg, await playerStats(q))
    }
    if (cmd === 'logs') {
      const target = parts[1]
      const n = parseInt(parts[2], 10)
      if (!target) return msg.reply('Uso: `!logs <id|serviço> [n]`')
      return sendReplies(msg, await containerLogs(target, n))
    }
    if (cmd === 'ps') return sendReplies(msg, await dockerStats())
    if (cmd === 'watch') return sendReplies(msg, await watchStatus(parts[1]))
    if (cmd === 'uptime') return msg.reply(uptimeInfo())
    return msg.reply(`Comando desconhecido.\n${HELP}`)
  } catch (err) {
    console.error('discordBot: erro no comando:', err.message)
    return msg.reply('❌ Erro interno ao processar comando.')
  }
}

async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.log('discordBot: DISCORD_BOT_TOKEN não configurado; bot desabilitado')
    return null
  }
  const allowedUsers = splitList(process.env.DISCORD_ALLOWED_USER_IDS)
  const allowedRoles = splitList(process.env.DISCORD_ALLOWED_ROLE_IDS)
  if (!allowedUsers.length && !allowedRoles.length) {
    console.log('discordBot: nenhuma permissão configurada (DISCORD_ALLOWED_USER_IDS/ROLE_IDS); bot desabilitado')
    return null
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  client.on('messageCreate', handleMessage)
  client.on('error', (err) => console.error('discordBot error:', err.message))

  try {
    await client.login(token)
    console.log('discordBot: conectado ao Discord')
  } catch (err) {
    console.error('discordBot: falha no login:', err.message)
    client = null
  }
  return client
}

function destroyDiscordBot() {
  if (client) {
    try { client.destroy() } catch (err) { console.error('discordBot: erro no destroy:', err.message) }
    client = null
  }
}

module.exports = { startDiscordBot, destroyDiscordBot }
