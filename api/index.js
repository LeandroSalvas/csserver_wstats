const express = require('express')
const mysql = require('mysql2/promise')
const session = require('express-session')
const { createClient } = require('redis')
const connectRedis = require('connect-redis')
const Rcon = require('rcon')
const fs = require('fs')

const app = express()
app.use(express.json())

let redisClient = null

const dbConfig = {
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'csuser',
  password: process.env.DB_PASSWORD || 'cs123',
  database: process.env.DB_NAME || 'csstats'
}

const db = mysql.createPool({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database
})

app.get('/health', async (req, res) => {
  const health = { status: 'ok', db: 'ok' }

  try {
    await db.query('SELECT 1 AS ok')
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      db: 'down',
      error: err.message
    })
  }

  if (redisClient) {
    try {
      await redisClient.ping()
      health.redis = 'ok'
    } catch (err) {
      health.status = 'degraded'
      health.redis = 'down'
      health.redisError = err.message
    }
  }

  res.json(health)
})

const sessionStoreType = (process.env.SESSION_STORE || 'redis').toLowerCase()
const sessionSecret = process.env.SESSION_SECRET || 'dev-insecure-session-secret'

if (sessionStoreType === 'redis') {
  const RedisStore =
    connectRedis.RedisStore ||
    (connectRedis.default && connectRedis.default.RedisStore) ||
    connectRedis.default ||
    (typeof connectRedis === 'function' ? connectRedis(session) : null)

  if (!RedisStore) {
    console.error('connect-redis: não foi possível resolver o RedisStore (export inesperado)')
    process.exit(1)
  }

  const redisHost = process.env.REDIS_HOST || 'redis'
  const redisPort = process.env.REDIS_PORT || '6379'
  const redisPassword = process.env.REDIS_PASSWORD || ''
  const redisDb = process.env.REDIS_DB || '0'

  const redisUrl = new URL(`redis://${redisHost}:${redisPort}`)
  if (redisPassword) redisUrl.password = redisPassword
  if (redisDb && redisDb !== '0') redisUrl.pathname = `/${redisDb}`

  redisClient = createClient({
    url: redisUrl.toString(),
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000)
    }
  })
  redisClient.on('error', (err) => console.error('Redis error:', err))
  redisClient.on('connect', () => console.log('Redis: conectando...'))
  redisClient.on('ready', () => console.log('Redis: pronto'))

  redisClient.connect().catch((err) => {
    // Não derruba a API: o client vai tentar reconectar e a API continua respondendo.
    console.error('Falha ao conectar no Redis (vai continuar tentando):', err)
  })

  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    }
  }))
} else {
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    }
  }))
}

const lastState = {}
let lastMap = null


const Gamedig = require('gamedig')

async function getCurrentMap(){

try{

const state = await Gamedig.query({
type: 'cs16',
host: 'cs16',
port: 27015
})

return state.map

}catch(err){

console.log("Erro ao obter mapa:", err.message)
return "unknown"

}

}


// TOP 10
app.get('/top10', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        kills,
        deaths,
        ROUND(kills / IF(deaths = 0, 1, deaths), 2) AS kd,
        skill,
        last_join
      FROM csstats
      ORDER BY kills DESC
      LIMIT 10
    `)

    res.json(rows)

    //io.emit("update")

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/top-headshots', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        kills,
        deaths,
        hs,
        skill,
        ROUND(hs / IF(kills = 0, 1, kills) * 100, 2) AS accuracy
      FROM csstats
      ORDER BY hs DESC, kills DESC
      LIMIT 10
    `)

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/top-accuracy', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        kills,
        deaths,
        hs,
        skill,
        ROUND(hs / IF(kills = 0, 1, kills) * 100, 2) AS accuracy
      FROM csstats
      WHERE kills >= 10
      ORDER BY accuracy DESC, hs DESC
      LIMIT 10
    `)

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/top-killstreak', async (req, res) => {
  try {
    const [rows] = await db.query(`
      WITH ordered AS (
        SELECT
          steamid,
          name,
          created_at,
          kills,
          LAG(kills) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_kills
        FROM csstats_snapshots
      )
      SELECT
        steamid,
        name,
        MAX(GREATEST(kills - COALESCE(prev_kills, 0), 0)) AS streak
      FROM ordered
      GROUP BY steamid, name
      HAVING streak > 0
      ORDER BY streak DESC
      LIMIT 10
    `)

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})


// PLAYER
app.get('/player/:steamid', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT *
      FROM csstats
      WHERE steamid = ?
    `, [req.params.steamid])

    res.json(rows[0])

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// TOP SKILL
app.get('/topskill', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT name, steamid, skill
      FROM csstats
      ORDER BY skill DESC
      LIMIT 10
    `)

    res.json(rows)

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// TOP KD
app.get('/topkd', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        kills,
        deaths,
        ROUND(kills / IF(deaths = 0, 1, deaths), 2) AS kd
      FROM csstats
      WHERE kills > 10
      ORDER BY kd DESC
      LIMIT 10
    `)

    res.json(rows)

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


//STATUS GERAIS
app.get('/stats', async (req, res) => {
  try {
    const [[players]] = await db.query(
      "SELECT COUNT(*) total FROM csstats"
    )

    const [[kills]] = await db.query(
      "SELECT COALESCE(SUM(kills), 0) total FROM csstats"
    )

    const [[maps]] = await db.query(
      "SELECT COUNT(DISTINCT map) total FROM csstats_snapshots"
    )

    //const [[sessions]] = await db.query(
    //  "SELECT COUNT(*) total FROM csstats_snapshots"
    //)

    res.json({
      players: players.total,
      kills: kills.total,
      maps: maps.total,
      //sessions: sessions.total
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// MAPS
async function snapshot() {

const map = await getCurrentMap()

const [players] = await db.query(`
SELECT steamid, name, kills, deaths, hs, skill
FROM csstats
`)

// 🔥 Detectar troca de mapa
if(lastMap !== map){

console.log("Mapa mudou:", map)

// salva snapshot de todos jogadores
for(const p of players){

await saveSnapshot(p, map)
lastState[p.steamid] = p

}

lastMap = map
return
}

// 🔥 Detectar mudança de stats
for(const p of players){

const prev = lastState[p.steamid]

// jogador novo
if(!prev){

await saveSnapshot(p, map)
lastState[p.steamid] = p
continue

}

// stats mudaram
const changed =
p.kills !== prev.kills ||
p.deaths !== prev.deaths ||
p.hs !== prev.hs ||
p.skill !== prev.skill

if(changed){

await saveSnapshot(p, map)
lastState[p.steamid] = p

}

}

}

async function saveSnapshot(p, map){

await db.query(`
INSERT INTO csstats_snapshots
(steamid,name,map,kills,deaths,hs,skill)
VALUES (?,?,?,?,?,?,?)
`,[
p.steamid,
p.name,
map,
p.kills,
p.deaths,
p.hs,
p.skill
])

console.log(`snapshot salvo: ${p.name} (${map})`)

}


setInterval(snapshot, 60000)

app.get('/maps', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        map,
        COUNT(*) AS snapshots
      FROM csstats_snapshots
      WHERE map IS NOT NULL
        AND map <> ''
        AND map <> 'unknown'
      GROUP BY map
      ORDER BY snapshots DESC, map ASC
    `)

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})


app.get('/map-ranking/:map', async (req, res) => {
  try {
    const [rows] = await db.query(`
      WITH ordered AS (
        SELECT
          steamid,
          name,
          map,
          kills,
          deaths,
          hs,
          skill,
          created_at,
          LAG(kills) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_kills,
          LAG(deaths) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_deaths,
          LAG(hs) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_hs
        FROM csstats_snapshots
      ),
      deltas AS (
        SELECT
          steamid,
          name,
          map,
          GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
          GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
          GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
          skill
        FROM ordered
      )
      SELECT
        steamid,
        name,
        SUM(kills_delta) AS kills,
        SUM(deaths_delta) AS deaths,
        SUM(hs_delta) AS hs,
        MAX(skill) AS skill,
        ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
      FROM deltas
      WHERE map = ?
      GROUP BY steamid, name
      HAVING kills > 0 OR deaths > 0 OR hs > 0
      ORDER BY kills DESC, kd DESC
      LIMIT 20
    `, [req.params.map])

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})


app.get('/map/:map', async (req,res)=>{

const [rows] = await db.query(`
SELECT 
name,
steamid,
MAX(kills) as kills,
MAX(deaths) as deaths,
MAX(hs) as hs,
MAX(skill) as skill
FROM csstats_snapshots
WHERE map = ?
GROUP BY steamid
ORDER BY kills DESC
LIMIT 10
`,[req.params.map])

res.json(rows)

})


app.get('/ranking/weekly', async (req, res) => {
  try {
    const [rows] = await db.query(`
      WITH ordered AS (
        SELECT
          steamid,
          name,
          map,
          kills,
          deaths,
          hs,
          skill,
          created_at,
          LAG(kills) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_kills,
          LAG(deaths) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_deaths,
          LAG(hs) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_hs
        FROM csstats_snapshots
      ),
      deltas AS (
        SELECT
          steamid,
          name,
          created_at,
          GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
          GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
          GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
          skill
        FROM ordered
      )
      SELECT
        steamid,
        name,
        SUM(kills_delta) AS kills,
        SUM(deaths_delta) AS deaths,
        SUM(hs_delta) AS hs,
        MAX(skill) AS skill,
        ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
      FROM deltas
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY steamid, name
      HAVING kills > 0 OR deaths > 0 OR hs > 0
      ORDER BY kills DESC, kd DESC
      LIMIT 20
    `)

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})


app.get('/ranking/monthly', async (req, res) => {
  try {
    const [rows] = await db.query(`
      WITH ordered AS (
        SELECT
          steamid,
          name,
          map,
          kills,
          deaths,
          hs,
          skill,
          created_at,
          LAG(kills) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_kills,
          LAG(deaths) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_deaths,
          LAG(hs) OVER (PARTITION BY steamid ORDER BY created_at) AS prev_hs
        FROM csstats_snapshots
      ),
      deltas AS (
        SELECT
          steamid,
          name,
          created_at,
          GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
          GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
          GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
          skill
        FROM ordered
      )
      SELECT
        steamid,
        name,
        SUM(kills_delta) AS kills,
        SUM(deaths_delta) AS deaths,
        SUM(hs_delta) AS hs,
        MAX(skill) AS skill,
        ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
      FROM deltas
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY steamid, name
      HAVING kills > 0 OR deaths > 0 OR hs > 0
      ORDER BY kills DESC, kd DESC
      LIMIT 20
    `)

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})


app.get('/player-history-daily/:steamid', async (req, res) => {
  try {
    const [rows] = await db.query(`
      WITH daily AS (
        SELECT
          DATE(created_at) AS day,
          MAX(kills) AS total_kills,
          MAX(deaths) AS total_deaths,
          MAX(hs) AS total_hs,
          MAX(skill) AS skill
        FROM csstats_snapshots
        WHERE steamid = ?
        GROUP BY DATE(created_at)
      )
      SELECT
        day,
        total_kills - COALESCE(LAG(total_kills) OVER (ORDER BY day), 0) AS kills,
        total_deaths - COALESCE(LAG(total_deaths) OVER (ORDER BY day), 0) AS deaths,
        total_hs - COALESCE(LAG(total_hs) OVER (ORDER BY day), 0) AS hs,
        skill
      FROM daily
      ORDER BY day ASC
      LIMIT 60
    `, [req.params.steamid])

    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/player-last-map/:steamid', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT map, created_at
      FROM csstats_snapshots
      WHERE steamid = ?
        AND map IS NOT NULL
        AND map <> ''
        AND map <> 'unknown'
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.params.steamid])

    res.json(rows[0] || null)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.get('/server', async (req,res)=>{

try{

const state = await Gamedig.query({
type: 'cs16',
host: 'cs16',
port: 27015
})

res.json({
map: state.map,
players: state.players.length,
maxplayers: state.maxplayers,
hostname: state.name
})

}catch(err){

res.json({
map:"unknown",
players:0,
maxplayers:0,
hostname:"offline"
})

}

})


//ADMIN FUNCTIONS
function runRconCommand(password, command) {
  return new Promise((resolve, reject) => {
    const client = new Rcon('cs16', 27015, password, {
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
      try { client.disconnect() } catch {}
      resolve(text && text.trim() ? text.trim() : 'Comando enviado com sucesso, sem retorno textual.')
    }

    const finishErr = (err) => {
      if (settled) return
      settled = true
      if (responseTimer) clearTimeout(responseTimer)
      try { client.disconnect() } catch {}
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

function requireAdmin(req, res, next) {
  if (!req.session?.rconAuthenticated || !req.session?.rconPassword) {
    return res.status(401).json({ error: 'Não autenticado' })
  }
  next()
}

app.post('/admin/login', async (req, res) => {
  try {
    const { password } = req.body || {}

    if (!password) {
      return res.status(400).json({ error: 'Senha RCON obrigatória' })
    }

    // testa a senha com um comando simples
    const response = await runRconCommand(password, 'status')

    req.session.rconAuthenticated = true
    req.session.rconPassword = password

    res.json({
      success: true,
      message: 'Autenticado com sucesso',
      response
    })
  } catch (err) {
    console.error('Erro no login RCON:', err)
    res.status(401).json({
      success: false,
      error: 'Falha ao autenticar no RCON'
    })
  }
})

app.post('/admin/command', requireAdmin, async (req, res) => {
  try {
    const { command } = req.body || {}

    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Comando obrigatório' })
    }

    const response = await runRconCommand(req.session.rconPassword, command.trim())

    res.json({
      success: true,
      command: command.trim(),
      response
    })
  } catch (err) {
    console.error('Erro ao executar RCON:', err)
    res.status(500).json({
      success: false,
      error: 'Falha ao executar comando RCON'
    })
  }
})

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true })
  })
})

//ROTA DE SESSÃO
app.get('/admin/session', (req, res) => {
  res.json({
    authenticated: !!req.session?.rconAuthenticated
  })
})

app.get('/live/killfeed', (req, res) => {
  try {
    const filePath = '/home/cs16/cstrike/addons/amxmodx/data/live/live_killfeed.json'

    if (!fs.existsSync(filePath)) {
      return res.json([])
    }

    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)

    res.json(Array.isArray(data) ? data : [])
  } catch (err) {
    console.error('Erro ao ler live_killfeed.json:', err)
    res.status(500).json({ error: 'Erro ao ler kill feed ao vivo' })
  }
})

app.get('/live/state', (req, res) => {
  try {
const filePath = '/home/cs16/cstrike/addons/amxmodx/data/live/live_scoreboard.json'

    if (!fs.existsSync(filePath)) {
      return res.json({
        hostname: 'Servidor offline',
        map: '-',
        players: []
      })
    }

    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw)

    res.json(data)
  } catch (err) {
    console.error('Erro ao ler live_scoreboard.json:', err)
    res.status(500).json({ error: 'Erro ao ler scoreboard ao vivo' })
  }
})

// INICIALIZA SERVIDOR
app.listen(3000, '0.0.0.0', () =>
  console.log('API rodando na porta 3000')
)
