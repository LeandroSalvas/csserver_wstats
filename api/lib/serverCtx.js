// Estado e serviços dos servidores: configurações, GameDig, snapshots,
// coletor de estatísticas do banco, alertas e comandos RCON.

const { GameDig } = require('gamedig')
const Rcon = require('rcon')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const {
  LIVE_DATA_DIR,
  NOT_BOT,
  NOT_BOT_WHERE,
  GAMEDIG_HOST,
  GAMEDIG_PORT,
  SNAPSHOT_STALE_MS,
  alertWebhookUrl,
  serverRepoDir,
  watchPublicBase
} = require('./config')
const { db } = require('./db')
const {
  playersRegisteredGauge,
  accuracyGauge,
  skillAvgGauge,
  skillMaxGauge,
  connectionTimeGauge,
  statsTotalGauge,
  activePlayersGauge,
  killsGauge,
  snapshotsByMapGauge,
  serverOnlineGauge,
  mapTimeGauge,
  playersOnlineGauge,
  roundTGauge,
  roundCTGauge,
  serverInfoGauge,
  maxPlayersGauge,
  pruneServerMetrics
} = require('./metrics')
const { readLiveFile, withTimeout } = require('./helpers')

// --- Config de servidores em tempo de execução ---
// Fonte de verdade: config/servers.list (mesmo formato do scripts/servers.sh:
// id name host_port map maxplayers rotate context; 1ª linha = main). A lista é
// recarregada por poll (startConfigWatch), então add/remove de servidor NÃO
// exige recriar o container da api — o serviço api fica estático no compose e
// o provisionamento não recria mais nada em cascata.

function slugifyContext(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseServersList(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const parts = String(line).trim().split(/\s+/)
    if (!parts[0] || parts[0].startsWith('#')) continue
    const [id, name, host_port, map, maxplayers, rotate = 'yes', context = slugifyContext(name)] = parts
    if (!id || !name) continue
    out.push({ id, name, host_port, map, maxplayers, rotate, context })
  }
  return out
}

function buildConfigs(entries) {
  return entries.map((s, i) => {
    const hostPort = parseInt(s.host_port, 10) || 27015
    const host = i === 0 ? 'cs16' : `cs16${s.id}`
    const spectatorUrl = watchPublicBase
      ? `${watchPublicBase.replace(/\/+$/, '')}/${s.context}/`
      : undefined
    return {
      id: s.id,
      name: s.name,
      host,
      port: 27015,
      hostPort,
      liveDir: path.join(serverRepoDir, 'live', s.id),
      spectatorUrl,
      map: s.map,
      maxplayers: parseInt(s.maxplayers, 10) || undefined,
      rotate: s.rotate,
      context: s.context
    }
  })
}

function defaultPrimaryServer() {
  return { id: 'main', name: GAMEDIG_HOST, host: GAMEDIG_HOST, port: GAMEDIG_PORT, hostPort: GAMEDIG_PORT, liveDir: LIVE_DATA_DIR }
}

// Carrega a lista de servidores: prioridade para config/servers.list (montada
// no container em SERVER_REPO_DIR); se o arquivo não existir (dev sem repo),
// usa o fallback histórico process.env.CS_SERVERS.
function loadServerConfigs() {
  try {
    const text = fs.readFileSync(path.join(serverRepoDir, 'config', 'servers.list'), 'utf8')
    const entries = parseServersList(text)
    if (entries.length) return buildConfigs(entries)
  } catch (err) {
    /* cai no fallback abaixo */
  }
  const raw = process.env.CS_SERVERS
  if (raw) {
    try {
      const list = JSON.parse(raw)
      if (Array.isArray(list) && list.length) {
        return list.map((s) => ({
          ...s,
          port: parseInt(s.port, 10) || 27015,
          hostPort: s.hostPort != null ? parseInt(s.hostPort, 10) : (parseInt(s.port, 10) || 27015)
        }))
      }
    } catch (err) {
      console.error('CS_SERVERS inválido:', err.message)
    }
  }
  return null
}

let serverConfigs = loadServerConfigs()

const primaryServer = serverConfigs && serverConfigs.length
  ? serverConfigs[0]
  : defaultPrimaryServer()

// Lista atual (refresca a cada chamada) com fallback no servidor primário.
// live.js/outros módulos NÃO podem importar `serverConfigs` destruturado —
// CommonJS copia o valor no require e ficaria obsoleto após um reload.
function getServerList() {
  return serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]
}

// Poll de 5s sobre config/servers.list. Mantém a última lista boa se o arquivo
// sumir/ler vazio no meio do caminho (escrita em andamento).
function startConfigWatch() {
  const file = path.join(serverRepoDir, 'config', 'servers.list')
  setInterval(() => {
    const next = loadServerConfigs()
    if (next && next.length) {
      const changed = JSON.stringify(next) !== JSON.stringify(serverConfigs)
      serverConfigs = next
      if (changed) {
        console.log(`serverCtx: config de servidores atualizada (${next.length})`)
        // Remove séries de métricas de servidores que saíram da lista — sem
        // isso o /metrics continua exportando os valores antigos para sempre.
        try { pruneServerMetrics(next.map((s) => s.id)) } catch (err) {
          console.error('serverCtx: falha ao podar métricas:', err.message)
        }
      }
    }
  }, 5000).unref()
}

// Filtro opcional ?server= para queries por servidor.
// Retorna null quando não informado, { invalid } quando o id não é configurado,
// ou { server, where, params } para usar em queries (cláusulas AND).
// Observação: quando casa por host, usa o id resolvido (server_name no banco é o id).
function getServerFilter(req) {
  const raw = String(req.query.server || '').trim()
  if (!raw) return null

  if (serverConfigs && serverConfigs.length) {
    const found = serverConfigs.find((s) => s.id === raw || s.host === raw)
    if (!found) return { invalid: raw }
    return { server: found.id, where: ' AND server_name = ?', params: [found.id] }
  }

  return { server: raw, where: ' AND server_name = ?', params: [raw] }
}

// Retorna o servidor configurado por id OU host, ou null se não existir.
function findServer(id) {
  if (!id) return null
  if (serverConfigs) return serverConfigs.find((s) => s.id === id || s.host === id) || null
  return null
}

function resolveServer(id) {
  if (!id) return primaryServer
  const found = findServer(id)
  return found || primaryServer
}

function resolveLiveDir(id) {
  const srv = resolveServer(id)
  return srv.liveDir || LIVE_DATA_DIR
}

function queryServer(srv) {
  return GameDig.query({
    type: 'counterstrike16',
    host: srv.host,
    port: parseInt(srv.port, 10)
  }).then((state) => {
    // O HLTV conecta como um player normal (não é flagado como bot pelo
    // protocolo) e entraria em state.players, inflando a contagem de ocupados.
    // Os relays usam nome "<context>-hltv" (config/watch/<id>/hltv.cfg), então
    // filtrar pelo sufixo cobre todos os servidores.
    if (Array.isArray(state.players)) {
      state.players = state.players.filter((p) => !/^.*-hltv$/i.test(String(p.name || '')))
    }
    return state
  })
}

async function getServerMap(srv) {
  try {
    const state = await queryServer(srv)
    return state.map
  } catch (err) {
    console.error('Erro ao obter mapa:', srv.id, err.message)
    return 'unknown'
  }
}

const lastState = {}
const lastMapByServer = {}
let snapshotInProgress = false
const lastServerInfo = {}

async function saveSnapshotBatch(players, map, server) {
  if (!players.length) return

  const values = players.map(p => [p.steamid, p.name, map, p.kills, p.deaths, p.hs, p.skill, server])
  const placeholders = values.map(() => '(?,?,?,?,?,?,?,?)').join(',')
  const flatValues = values.flat()

  await db.query(
    `INSERT INTO csstats_snapshots (steamid,name,map,kills,deaths,hs,skill,server_name) VALUES ${placeholders}`,
    flatValues
  )
  console.log(`snapshot salvo: ${players.length} jogadores (${server}/${map})`)
}

function pruneLastState() {
  const now = Date.now()
  for (const [key, entry] of Object.entries(lastState)) {
    if (!entry._lastUpdated || (now - entry._lastUpdated) > SNAPSHOT_STALE_MS) {
      delete lastState[key]
    }
  }
}

function snapshotKey(srv, steamid) {
  return `${srv.id}:${steamid}`
}

async function snapshot() {
  if (snapshotInProgress) return

  snapshotInProgress = true

  try {

    const servers = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]

    for (const srv of servers) {

      const map = await getServerMap(srv)

      if (!map || map === 'unknown' || map === '') {
        lastMapByServer[srv.id] = map
        pruneLastState()
        continue
      }

      const [players] = await db.query(`
        SELECT steamid, name, kills, deaths, hs, skill
        FROM csstats
        WHERE server_name = ? AND ${NOT_BOT}
      `, [srv.id])

      if (lastMapByServer[srv.id] !== map) {

        console.log('Mapa mudou:', srv.id, map)

        const activePlayers = players.filter((p) => lastState[snapshotKey(srv, p.steamid)])
        await saveSnapshotBatch(activePlayers, map, srv.id)

        for (const p of activePlayers) {
          p._lastUpdated = Date.now()
          lastState[snapshotKey(srv, p.steamid)] = p
        }

        lastMapByServer[srv.id] = map
        pruneLastState()
        continue
      }

      const changedPlayers = []
      for (const p of players) {

        const key = snapshotKey(srv, p.steamid)
        const prev = lastState[key]

        if (!prev) {

          p._lastUpdated = Date.now()
          lastState[key] = p

          if (p.kills > 0 || p.deaths > 0 || p.hs > 0) {
            changedPlayers.push(p)
          }

          continue

        }

        const changed =
          p.kills !== prev.kills ||
          p.deaths !== prev.deaths ||
          p.hs !== prev.hs ||
          p.skill !== prev.skill

        if (changed) {

          changedPlayers.push(p)
          p._lastUpdated = Date.now()
          lastState[key] = p

        }

      }

      if (changedPlayers.length) {
        await saveSnapshotBatch(changedPlayers, map, srv.id)
      }

      pruneLastState()
    }

  } catch (err) {
    console.error('Erro no snapshot:', err)
  } finally {
    snapshotInProgress = false
  }

}

let dbStatsInProgress = false

// Agregados do banco por servidor, expostos como métricas Prometheus.
async function collectDbStats() {
  if (dbStatsInProgress) return
  dbStatsInProgress = true

  const servers = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]

  try {
    for (const srv of servers) {
      const [[agg]] = await db.query(`
        SELECT
          COUNT(*) AS players_registered,
          COALESCE(SUM(kills), 0) AS kills,
          COALESCE(SUM(deaths), 0) AS deaths,
          COALESCE(SUM(hs), 0) AS hs,
          COALESCE(SUM(tks), 0) AS tks,
          COALESCE(SUM(assists), 0) AS assists,
          COALESCE(SUM(dmg), 0) AS dmg,
          COALESCE(SUM(bombplants), 0) AS bombplants,
          COALESCE(SUM(bombdefused), 0) AS bombdefused,
          COALESCE(SUM(bombexplosions), 0) AS bombexplosions,
          COALESCE(SUM(connects), 0) AS connects,
          COALESCE(SUM(shots), 0) AS shots,
          COALESCE(SUM(hits), 0) AS hits,
          COALESCE(AVG(skill), 0) AS skill_avg,
          COALESCE(MAX(skill), 0) AS skill_max,
          COALESCE(SUM(connection_time), 0) AS connection_time
        FROM csstats
        WHERE server_name = ? AND ${NOT_BOT}
      `, [srv.id])

      playersRegisteredGauge.set({ server: srv.id }, agg.players_registered)
      accuracyGauge.set({ server: srv.id }, agg.shots > 0 ? (agg.hits / agg.shots) * 100 : 0)
      skillAvgGauge.set({ server: srv.id }, Number(agg.skill_avg))
      skillMaxGauge.set({ server: srv.id }, agg.skill_max)
      connectionTimeGauge.set({ server: srv.id }, Number(agg.connection_time))

      const statsMap = {
        kills: agg.kills,
        deaths: agg.deaths,
        hs: agg.hs,
        tks: agg.tks,
        assists: agg.assists,
        dmg: agg.dmg,
        bombplants: agg.bombplants,
        bombdefused: agg.bombdefused,
        bombexplosions: agg.bombexplosions,
        connects: agg.connects
      }
      for (const [stat, value] of Object.entries(statsMap)) {
        statsTotalGauge.set({ server: srv.id, stat }, Number(value))
      }

      const [[{ active7d }]] = await db.query(`
        SELECT COUNT(DISTINCT steamid) AS active7d
        FROM csstats_snapshots
        WHERE server_name = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ${NOT_BOT}
      `, [srv.id])
      const [[{ active30d }]] = await db.query(`
        SELECT COUNT(DISTINCT steamid) AS active30d
        FROM csstats_snapshots
        WHERE server_name = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND ${NOT_BOT}
      `, [srv.id])
      activePlayersGauge.set({ server: srv.id, period: '7d' }, active7d)
      activePlayersGauge.set({ server: srv.id, period: '30d' }, active30d)

      const [[{ kills7d }]] = await db.query(`
        WITH baseline AS (
          SELECT s.steamid, s.server_name, s.kills, s.created_at
          FROM csstats_snapshots s
          JOIN (
            SELECT steamid, server_name, MAX(created_at) AS max_created
            FROM csstats_snapshots
            WHERE server_name = ? AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) AND ${NOT_BOT}
            GROUP BY steamid, server_name
          ) b ON b.steamid = s.steamid AND b.server_name = s.server_name AND b.max_created = s.created_at
        ),
        windowed AS (
          SELECT steamid, server_name, kills, created_at
          FROM csstats_snapshots
          WHERE server_name = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ${NOT_BOT}
        ),
        combined AS (
          SELECT steamid, kills, created_at FROM windowed
          UNION ALL
          SELECT steamid, kills, created_at FROM baseline
        ),
        ordered AS (
          SELECT kills, created_at,
            LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills
          FROM combined
        )
        SELECT COALESCE(SUM(GREATEST(kills - COALESCE(prev_kills, 0), 0)), 0) AS kills7d
        FROM ordered
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `, [srv.id, srv.id])
      const [[{ kills30d }]] = await db.query(`
        WITH baseline AS (
          SELECT s.steamid, s.server_name, s.kills, s.created_at
          FROM csstats_snapshots s
          JOIN (
            SELECT steamid, server_name, MAX(created_at) AS max_created
            FROM csstats_snapshots
            WHERE server_name = ? AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY) AND ${NOT_BOT}
            GROUP BY steamid, server_name
          ) b ON b.steamid = s.steamid AND b.server_name = s.server_name AND b.max_created = s.created_at
        ),
        windowed AS (
          SELECT steamid, server_name, kills, created_at
          FROM csstats_snapshots
          WHERE server_name = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND ${NOT_BOT}
        ),
        combined AS (
          SELECT steamid, kills, created_at FROM windowed
          UNION ALL
          SELECT steamid, kills, created_at FROM baseline
        ),
        ordered AS (
          SELECT kills, created_at,
            LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills
          FROM combined
        )
        SELECT COALESCE(SUM(GREATEST(kills - COALESCE(prev_kills, 0), 0)), 0) AS kills30d
        FROM ordered
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `, [srv.id, srv.id])
      killsGauge.set({ server: srv.id, period: '7d' }, Number(kills7d))
      killsGauge.set({ server: srv.id, period: '30d' }, Number(kills30d))

      const [mapRows] = await db.query(`
        SELECT map, COUNT(*) AS snapshots
        FROM csstats_snapshots
        WHERE server_name = ? AND map IS NOT NULL AND map <> '' AND map <> 'unknown' AND ${NOT_BOT}
        GROUP BY map
      `, [srv.id])
      for (const row of mapRows) {
        snapshotsByMapGauge.set({ server: srv.id, map: row.map }, row.snapshots)
      }
    }
  } catch (err) {
    console.error('Erro no coletor de estatísticas do banco:', err)
  } finally {
    dbStatsInProgress = false
  }
}

function runRconCommand(password, command, serverId) {
  const srv = resolveServer(serverId)
  return new Promise((resolve, reject) => {
    const client = new Rcon(srv.host, parseInt(srv.port, 10), password, {
      tcp: false,
      challenge: true
    })

    let output = ''
    let settled = false
    let responseTimer = null

    const finishOk = (text) => {
      if (settled) return
      settled = true
      if (responseTimer) clearTimeout(responseTimer)
      try { client.disconnect() } catch (e) { console.error('RCON disconnect error:', e.message) }
      resolve(text && text.trim() ? text.trim() : 'Comando enviado com sucesso, sem retorno textual.')
    }

    const finishErr = (err) => {
      if (settled) return
      settled = true
      if (responseTimer) clearTimeout(responseTimer)
      try { client.disconnect() } catch (e) { console.error('RCON disconnect error:', e.message) }
      reject(err)
    }

    client.on('auth', () => {
      client.send(command)
    })

    client.on('response', (str) => {
      output += str + '\n'

      if (responseTimer) clearTimeout(responseTimer)
      responseTimer = setTimeout(() => finishOk(output), 300)
    })

    client.on('error', (err) => {
      finishErr(err)
    })

    client.on('end', () => {
      if (!settled) finishOk(output)
    })

    try {
      client.connect()
    } catch (err) {
      finishErr(err)
    }

    setTimeout(() => {
      if (!settled) finishOk(output)
    }, 5000)
  })
}

// ALERTAS DE SERVIDOR
// sendAlert/pushAlertEvent/alertEvents vivem em ./alerts (compartilhado com o
// fluxo de admins e o checker da stack).
const { alertEvents, pushAlertEvent, sendAlert } = require('./alerts')
let serverAlertState = {}

async function checkServerAlerts() {
  const servers = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]

  for (const srv of servers) {
    const prev = serverAlertState[srv.id]
    try {
      const state = await queryServer(srv)
      const online = true

      updateLiveServerGauges(srv, state)

      if (prev === undefined) {
        serverAlertState[srv.id] = online
        continue
      }

      if (online !== serverAlertState[srv.id]) {
        serverAlertState[srv.id] = online
        pushAlertEvent(srv.id, 'online')
        await sendAlert(`🟢 Servidor ${srv.name || srv.host} online — mapa ${state.map}, ${state.players.length}/${state.maxplayers} jogadores`)
      }
    } catch (err) {
      serverOnlineGauge.set({ server: srv.id }, 0)
      mapTimeGauge.set({ server: srv.id }, 0)
      playersOnlineGauge.set({ server: srv.id }, 0)
      roundTGauge.set({ server: srv.id }, 0)
      roundCTGauge.set({ server: srv.id }, 0)

      if (prev === undefined) {
        serverAlertState[srv.id] = false
        continue
      }

      if (serverAlertState[srv.id] !== false) {
        serverAlertState[srv.id] = false
        pushAlertEvent(srv.id, 'offline')
        await sendAlert(`🔴 Servidor ${srv.name || srv.host} offline`)
      }
    }
  }
}

function updateLiveServerGauges(srv, state) {
  const scoreboard = readLiveFile('live_scoreboard.json', resolveLiveDir(srv.id))

  serverOnlineGauge.set({ server: srv.id }, 1)
  const map = state.map || 'unknown'
  const hostname = state.name || srv.id
  const prev = lastServerInfo[srv.id]
  if (prev && (prev.map !== map || prev.hostname !== hostname)) {
    serverInfoGauge.remove({ server: srv.id, map: prev.map, hostname: prev.hostname })
  }
  lastServerInfo[srv.id] = { map, hostname }
  serverInfoGauge.set({ server: srv.id, map, hostname }, 1)
  maxPlayersGauge.set({ server: srv.id }, parseInt(state.maxplayers, 10) || 0)
  playersOnlineGauge.set({ server: srv.id }, state.players.length)

  const roundT = scoreboard && Number.isFinite(scoreboard.round_t) ? scoreboard.round_t : 0
  const roundCT = scoreboard && Number.isFinite(scoreboard.round_ct) ? scoreboard.round_ct : 0
  roundTGauge.set({ server: srv.id }, roundT)
  roundCTGauge.set({ server: srv.id }, roundCT)

  const mapStarted = scoreboard && Number.isFinite(scoreboard.map_started_at)
    ? scoreboard.map_started_at * 1000
    : 0
  mapTimeGauge.set({ server: srv.id }, mapStarted ? Math.max(0, (Date.now() - mapStarted) / 1000) : 0)
}

// ALERTAS DE INDISPONIBILIDADE DA STACK (containers do projeto via docker.sock).
// Os servidores de jogo (serviços cs16*) ficam de fora — já têm alerta próprio
// via GameDig (checkServerAlerts). O projeto é filtrado pelo label do compose.
const STACK_PROJECT = process.env.STACK_PROJECT || 'csserver_wstats'

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

function stackServiceLabel(service) {
  if (STACK_SERVICE_NAMES[service]) return STACK_SERVICE_NAMES[service]
  if (/^watch-main-/.test(service)) return `Espectador ${service.replace(/^watch-main-/, '')}`
  if (/^watch-hltv-/.test(service)) return `HLTV ${service.replace(/^watch-hltv-/, '')}`
  return service
}

function isGameServerService(service) {
  return service === 'cs16' || /^cs16[a-z0-9_-]+$/.test(service)
}

function runDocker(args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message || '').trim().split('\n').slice(-8).join('\n')))
        return
      }
      resolve(stdout || '')
    })
  })
}

const stackHealthState = {}

async function checkStackAlerts() {
  let out
  try {
    out = await runDocker([
      'ps', '-a',
      '--filter', `label=com.docker.compose.project=${STACK_PROJECT}`,
      '--format', '{{.Label "com.docker.compose.service"}}|{{.Names}}|{{.State}}|{{.Status}}'
    ])
  } catch (err) {
    console.error('checkStackAlerts: docker indisponível:', err.message)
    return
  }

  const seen = {}
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [service, name, state, status] = line.split('|')
    if (!service || isGameServerService(service)) continue

    seen[service] = true
    // Up = rodando E sem "(unhealthy)" (healthcheck). "(health: starting)"
    // durante o boot conta como up para não disparar alerta em recriação.
    const healthy = state === 'running' && !String(status).includes('(unhealthy)')
    const prev = stackHealthState[service]
    if (prev === undefined) {
      stackHealthState[service] = healthy
      continue
    }
    if (healthy !== prev) {
      stackHealthState[service] = healthy
      const label = stackServiceLabel(service)
      if (healthy) {
        pushAlertEvent(service, 'stack-up', label)
        await sendAlert(`🟢 Serviço ${label} voltou (${name})`)
      } else {
        pushAlertEvent(service, 'stack-down', label)
        await sendAlert(`🔴 Serviço ${label} indisponível (${name} — ${state}${status ? `, ${status}` : ''})`)
      }
    }
  }

  // Containers removidos (ex.: prune) saem do estado sem alerta.
  for (const service of Object.keys(stackHealthState)) {
    if (!seen[service]) delete stackHealthState[service]
  }
}

module.exports = {
  serverConfigs,
  primaryServer,
  getServerList,
  startConfigWatch,
  getServerFilter,
  findServer,
  resolveServer,
  resolveLiveDir,
  queryServer,
  getServerMap,
  runRconCommand,
  checkServerAlerts,
  checkStackAlerts,
  updateLiveServerGauges,
  serverAlertState,
  stackHealthState,
  alertEvents,
  alertWebhookUrl
}
