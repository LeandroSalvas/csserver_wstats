// Serviço SSE/LIVE: clientes conectados, polling por diffs dos arquivos live,
// e rastreamento de partidas (persistência de cs_matches / cs_matches_players).

const { MAX_SSE_CLIENTS } = require('./config')
const { db } = require('./db')
const {
  playersOnlineGauge,
  matchesTotal,
  matchDurationHistogram
} = require('./metrics')
const { readLiveFile } = require('./helpers')
const { serverConfigs, primaryServer, resolveLiveDir } = require('./serverCtx')

const sseClients = new Set()
let ssePingTimer = null

function checkLiveChanges() {
  for (const client of sseClients) {
    const scoreboard = readLiveFile('live_scoreboard.json', client.dir)
    const killfeed = readLiveFile('live_killfeed.json', client.dir)
    if (scoreboard) client.res.write(`event: scoreboard\ndata: ${JSON.stringify(scoreboard)}\n\n`)
    if (killfeed) client.res.write(`event: killfeed\ndata: ${JSON.stringify(killfeed)}\n\n`)
    client.res.write(': ping\n\n')
  }

  const servers = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]
  for (const srv of servers) {
    const scoreboard = readLiveFile('live_scoreboard.json', resolveLiveDir(srv.id))
    if (scoreboard && Array.isArray(scoreboard.players)) {
      playersOnlineGauge.set({ server: srv.id }, scoreboard.players.length)
    }
  }

  processLastMatch()
}

function startSsePolling() {
  checkLiveChanges()
  if (ssePingTimer) clearInterval(ssePingTimer)
  ssePingTimer = setInterval(checkLiveChanges, 2000)
}

// RASTREAMENTO DE PARTIDAS
const processedMatches = new Set()

async function processLastMatch() {
  const servers = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]

  for (const srv of servers) {
    const scoreboard = readLiveFile('live_scoreboard.json', resolveLiveDir(srv.id))
    const last = scoreboard && scoreboard.last_match
    if (!last || !last.ended_at) continue

    const key = `${srv.id}|${last.map}|${last.ended_at}`
    if (processedMatches.has(key)) continue

    processedMatches.add(key)
    if (processedMatches.size > 500) {
      processedMatches.delete(processedMatches.values().next().value)
    }

    try {
      const roundT = Number(last.round_t)
      const roundCt = Number(last.round_ct)
      const winner = roundT > roundCt ? 'T' : roundCt > roundT ? 'CT' : 'DRAW'
      const durationSec = last.started_at ? Math.max(0, last.ended_at - last.started_at) : null

      const [result] = await db.query(
        `INSERT IGNORE INTO cs_matches (server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          srv.id,
          last.map,
          last.round_t,
          last.round_ct,
          winner,
          durationSec,
          last.started_at ? new Date(last.started_at * 1000) : null,
          new Date(last.ended_at * 1000)
        ]
      )

      if (result.affectedRows > 0) {
        matchesTotal.inc({ server: srv.id })
        if (durationSec !== null) {
          matchDurationHistogram.observe({ server: srv.id, map: last.map, winner }, durationSec)
        }
        console.log(`Partida registrada: ${srv.id}/${last.map} ${last.round_t}-${last.round_ct}`)
        await insertMatchPlayers(result.insertId, srv.id, last)
      }
    } catch (err) {
      console.error(`Erro ao registrar partida (${srv.id}):`, err.message)
    }
  }
}

async function insertMatchPlayers(matchId, serverId, last) {
  const players = Array.isArray(last.players) ? last.players : []
  if (!players.length) return

  const values = []
  const params = []

  players.forEach((p, i) => {
    values.push('(?,?,?,?,?,?,?,?,?)')
    params.push(
      matchId,
      serverId,
      i,
      String(p.steamid || '').slice(0, 32),
      String(p.name || '').slice(0, 64),
      p.team || null,
      Number(p.kills) || 0,
      Number(p.deaths) || 0,
      Number(p.hs) || 0
    )
  })

  try {
    await db.query(
      `INSERT IGNORE INTO cs_matches_players (match_id, server, pid, steamid, name, team, kills, deaths, hs)
       VALUES ${values.join(',')}`,
      params
    )
  } catch (err) {
    console.error(`Erro ao inserir jogadores da partida ${matchId}:`, err.message)
  }
}

module.exports = {
  sseClients,
  MAX_SSE_CLIENTS,
  checkLiveChanges,
  startSsePolling,
  processLastMatch,
  insertMatchPlayers
}
