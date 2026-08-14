// Bot Discord: gerencia a stack via comandos de texto no canal (prefixo '!').
// Roda no processo da API e chama os módulos internos diretamente (sem HTTP).
// Permissão: somente membros com role em DISCORD_ALLOWED_ROLE_IDS ou ID em
// DISCORD_ALLOWED_USER_IDS (separados por vírgula). Sem token/permissão o bot
// é desabilitado sem crash (mesmo padrão do webhook).

const { Client, GatewayIntentBits } = require('discord.js')

const {
  getProvider,
  stackHealthState,
  runRconCommand,
  findServer,
  queryServer,
  withTimeout,
  sendAlert
} = require('./core')

const PREFIX = '!'
const MAX_REPLY = 1900

const STACK_SERVICE_NAMES = {
  api: 'API (Node.js)',
  db: 'Banco (MariaDB)',
  redis: 'Cache (Redis)',
  web: 'Frontend (Nginx)',
  prometheus: 'Prometheus',
  grafana: 'Grafana',
  'node-exporter': 'Node Exporter (host)',
  cadvisor: 'cAdvisor',
  'nginx-exporter': 'Nginx Exporter',
  'nginxlog-exporter': 'Nginxlog Exporter',
  swag: 'Swag (TLS/proxy)',
  duckdns: 'DuckDNS'
}

function stackLabel(service) {
  if (STACK_SERVICE_NAMES[service]) return STACK_SERVICE_NAMES[service]
  if (/^watch-main-/.test(service)) return `Espectador ${service.replace(/^watch-main-/, '')}`
  if (/^watch-hltv-/.test(service)) return `HLTV ${service.replace(/^watch-hltv-/, '')}`
  return service
}

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
  const up = keys.filter((k) => stackHealthState[k] === 'up').sort()
  const down = keys.filter((k) => stackHealthState[k] !== 'up').sort()
  const lines = []
  if (down.length) lines.push(`🔴 ${down.map((k) => stackLabel(k)).join(', ')}`)
  lines.push(`🟢 ${up.map((k) => stackLabel(k)).join(', ')}`)
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

async function rconCommand(id, command, msg) {
  const rconPassword = process.env.RCON_PASSWORD
  if (!rconPassword) return 'RCON não configurado (RCON_PASSWORD).'
  const servers = await getProvider().list()
  const known = servers.find((s) => s.id === id)
  if (!known) return `Servidor \`${id}\` não encontrado.`
  try {
    const output = await runRconCommand(rconPassword, command, id)
    await sendAlert(`🤖 Discord: RCON \`${command}\` em **${known.name || id}** (por ${msg.author.username})`)
    return `**RCON \`${command}\` em ${known.name || id}:**\n${output || '(sem retorno)'}`
  } catch (err) {
    return `❌ Falha no RCON: ${err.message || err}`
  }
}

const HELP = '**Comandos**\n' +
  '`!status` — servidores + stack\n' +
  '`!servidores` — lista os servidores de jogo\n' +
  '`!stack` — estado dos serviços da stack\n' +
  '`!start <id>` / `!stop <id>` / `!restart <id>` — controle de servidor\n' +
  '`!rcon <id> <comando>` — RCON no servidor\n' +
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
    return msg.reply(`Comando desconhecido.\n${HELP}`)
  } catch (err) {
    console.error('discordBot: erro no comando:', err.message)
    return msg.reply(`❌ Erro interno: ${err.message}`)
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
