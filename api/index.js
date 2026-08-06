const express = require('express')
const mysql = require('mysql2/promise')
const session = require('express-session')
const { createClient } = require('redis')
const { RedisStore } = require('connect-redis')
const rateLimit = require('express-rate-limit')
const crypto = require('crypto')
const Rcon = require('rcon')
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const client = require('prom-client')

const app = express()
app.set('trust proxy', 1)
app.use(express.json())

const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:8080', 'http://192.168.15.54:8080']

app.use(cors({
  origin: corsOrigins,
  credentials: true
}))

// Headers de segurança para as respostas da API (o nginx também cobre o frontend).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

// Padroniza respostas de erro: log completo no servidor, mensagem genérica no cliente.
function handleError(res, err, context) {
  console.error(`Erro em ${context}:`, err)
  res.status(500).json({ error: 'Erro interno do servidor' })
}

let sessionMiddleware = null
app.use((req, res, next) => {
  if (!sessionMiddleware) return next(new Error('Sessão ainda não inicializada'))
  return sessionMiddleware(req, res, next)
})

const LIVE_DATA_DIR = process.env.LIVE_DATA_DIR || '/home/cs16/cstrike/addons/amxmodx/data/live'

function timingSafeEqualStr(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest()
  const hashB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

function getPagination(req, maxLimit = 50) {
  const rawLimit = parseInt(req.query.limit, 10)
  const rawPage = parseInt(req.query.page, 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : 10
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1
  const offset = (page - 1) * limit
  return { limit, page, offset }
}

// Filtro defensivo para excluir bots (PodBod/HLTV registram steamid "BOT")
// de rankings, tops, buscas e snapshots.
const NOT_BOT = "steamid NOT LIKE 'BOT%'"
const NOT_BOT_WHERE = `AND ${NOT_BOT}`

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

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Tente novamente em 1 minuto.' }
})

const commandLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitos comandos. Tente novamente em 1 minuto.' }
})

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

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cs_matches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      server VARCHAR(32) NOT NULL DEFAULT 'main',
      map VARCHAR(64) NOT NULL,
      round_t INT NOT NULL DEFAULT 0,
      round_ct INT NOT NULL DEFAULT 0,
      winner ENUM('T','CT','DRAW') NULL,
      duration_sec INT NULL,
      started_at DATETIME NULL,
      ended_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_match (server, map, ended_at)
    )
  `)

  // Migrações idempotentes para bancos existentes (multi-servidor).
  const ensureColumn = async (table, column, ddl) => {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    )
    if (!row.n) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`)
  }

  const ensureKey = async (table, key, ddl) => {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, key]
    )
    if (!row.n) await db.query(`ALTER TABLE \`${table}\` ADD ${ddl}`)
  }

  await ensureColumn('csstats', 'server_name', "`server_name` varchar(32) NOT NULL DEFAULT 'main' AFTER `session_map`")
  await ensureKey('csstats', 'server_steamid', 'UNIQUE KEY `server_steamid` (`server_name`, `steamid`(16))')

  await ensureColumn('csstats_snapshots', 'server_name', "`server_name` varchar(32) NOT NULL DEFAULT 'main'")
  await ensureKey('csstats_snapshots', 'idx_snap_server', 'KEY `idx_snap_server` (`server_name`)')

  await ensureColumn('cs_matches', 'server', "`server` varchar(32) NOT NULL DEFAULT 'main'")

  // uq_match precisa incluir `server` (bancos antigos tinham apenas map+ended_at).
  // Se o índice não existir, apenas cria; se existir sem `server`, recria.
  try {
    const [[uqMatchExists]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cs_matches' AND INDEX_NAME = 'uq_match'`
    )
    if (!uqMatchExists.n) {
      await db.query('ALTER TABLE `cs_matches` ADD UNIQUE KEY `uq_match` (`server`, `map`, `ended_at`)')
    } else {
      const [[uqMatchCols]] = await db.query(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cs_matches'
           AND INDEX_NAME = 'uq_match' AND COLUMN_NAME = 'server'`
      )
      if (uqMatchCols.n === 0) {
        await db.query('ALTER TABLE `cs_matches` DROP INDEX `uq_match`')
        await db.query('ALTER TABLE `cs_matches` ADD UNIQUE KEY `uq_match` (`server`, `map`, `ended_at`)')
      }
    }
  } catch (err) {
    console.error('Migração uq_match falhou:', err)
  }

  // csstats_snapshots.skill: INT → FLOAT (alinhar com csstats.skill, evitar truncamento).
  try {
    const [[skillCol]] = await db.query(
      `SELECT DATA_TYPE AS t FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'csstats_snapshots' AND COLUMN_NAME = 'skill'`
    )
    if (skillCol && skillCol.t && String(skillCol.t).toUpperCase() !== 'FLOAT') {
      await db.query('ALTER TABLE `csstats_snapshots` MODIFY `skill` float NULL')
    }
  } catch (err) {
    console.error('Migração skill FLOAT falhou:', err)
  }

  // Índice composto para as CTEs de LAG por (server_name, steamid, created_at).
  await ensureKey('csstats_snapshots', 'idx_snap_server_steamid_time',
    'KEY `idx_snap_server_steamid_time` (`server_name`, `steamid`, `created_at`)')
}

app.get('/health', async (req, res) => {
  const health = { status: 'ok', db: 'ok' }

  try {
    await db.query('SELECT 1 AS ok')
    dbUpGauge.set(1)
  } catch (err) {
    dbUpGauge.set(0)
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
      redisUpGauge.set(1)
    } catch (err) {
      health.status = 'degraded'
      health.redis = 'down'
      health.redisError = err.message
      redisUpGauge.set(0)
    }
  }

  res.json(health)
})

// --- Prometheus ---
client.collectDefaultMetrics({ timeout: 10000 })

const httpRequestsTotal = new client.Counter({
  name: 'cs16_http_requests_total',
  help: 'Total de requisições HTTP processadas',
  labelNames: ['method', 'path', 'status']
})

const playersOnlineGauge = new client.Gauge({
  name: 'cs16_players_online',
  help: 'Jogadores online por servidor',
  labelNames: ['server']
})

const dbUpGauge = new client.Gauge({
  name: 'cs16_db_up',
  help: 'Banco de dados acessível (1 = sim, 0 = não)'
})

const matchesTotal = new client.Counter({
  name: 'cs16_matches_total',
  help: 'Partidas registradas no banco',
  labelNames: ['server']
})

const httpRequestDuration = new client.Histogram({
  name: 'cs16_http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
})

const redisUpGauge = new client.Gauge({
  name: 'cs16_redis_up',
  help: 'Redis acessível (1 = sim, 0 = não)'
})

const dbQueryErrorsTotal = new client.Counter({
  name: 'cs16_db_query_errors_total',
  help: 'Queries SQL com erro'
})

const matchDurationHistogram = new client.Histogram({
  name: 'cs16_match_duration_seconds',
  help: 'Duração das partidas registradas',
  labelNames: ['server', 'map', 'winner'],
  buckets: [300, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200]
})

const serverOnlineGauge = new client.Gauge({
  name: 'cs16_server_online',
  help: 'Servidor online (1 = sim, 0 = não)',
  labelNames: ['server']
})

const serverInfoGauge = new client.Gauge({
  name: 'cs16_server_info',
  help: 'Informações do servidor (mapa e hostname atuais)',
  labelNames: ['server', 'map', 'hostname']
})

const maxPlayersGauge = new client.Gauge({
  name: 'cs16_max_players',
  help: 'Lotação máxima do servidor',
  labelNames: ['server']
})

const roundTGauge = new client.Gauge({
  name: 'cs16_round_t',
  help: 'Rodadas vencidas pelo Terrorista (placar ao vivo)',
  labelNames: ['server']
})

const roundCTGauge = new client.Gauge({
  name: 'cs16_round_ct',
  help: 'Rodadas vencidas pela Contra-Terrorista (placar ao vivo)',
  labelNames: ['server']
})

const mapTimeGauge = new client.Gauge({
  name: 'cs16_map_time_seconds',
  help: 'Tempo decorrido no mapa atual',
  labelNames: ['server']
})

const playersRegisteredGauge = new client.Gauge({
  name: 'cs16_players_registered',
  help: 'Jogadores registrados no banco',
  labelNames: ['server']
})

const statsTotalGauge = new client.Gauge({
  name: 'cs16_stats_total',
  help: 'Totais agregados de estatísticas por servidor',
  labelNames: ['server', 'stat']
})

const accuracyGauge = new client.Gauge({
  name: 'cs16_accuracy',
  help: 'Precisão média (hits/shots) por servidor',
  labelNames: ['server']
})

const skillAvgGauge = new client.Gauge({
  name: 'cs16_skill_avg',
  help: 'Skill médio por servidor',
  labelNames: ['server']
})

const skillMaxGauge = new client.Gauge({
  name: 'cs16_skill_max',
  help: 'Skill máximo por servidor',
  labelNames: ['server']
})

const connectionTimeGauge = new client.Gauge({
  name: 'cs16_connection_time_seconds',
  help: 'Tempo total conectado (soma) por servidor',
  labelNames: ['server']
})

const activePlayersGauge = new client.Gauge({
  name: 'cs16_active_players',
  help: 'Jogadores distintos ativos no período (dias)',
  labelNames: ['server', 'period']
})

const killsGauge = new client.Gauge({
  name: 'cs16_kills_period_total',
  help: 'Kills no período (delta de snapshots) por servidor',
  labelNames: ['server', 'period']
})

const snapshotsByMapGauge = new client.Gauge({
  name: 'cs16_snapshots_total',
  help: 'Snapshots (popularidade) por servidor e mapa',
  labelNames: ['server', 'map']
})

// Wrap de db.query para contabilizar erros de query sem quebrar o pool.
{
  const originalQuery = db.query.bind(db)
  db.query = async (...args) => {
    try {
      return await originalQuery(...args)
    } catch (err) {
      dbQueryErrorsTotal.inc()
      throw err
    }
  }
}

app.use((req, res, next) => {
  const startTime = process.hrtime()
  res.on('finish', () => {
    const routePath = req.route ? req.route.path : req.path
    httpRequestsTotal.inc({ method: req.method, path: routePath, status: res.statusCode })
    const [seconds, nanoseconds] = process.hrtime(startTime)
    httpRequestDuration.observe(
      { method: req.method, path: routePath, status: res.statusCode },
      seconds + nanoseconds / 1e9
    )
  })
  next()
})

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType)
    res.end(await client.register.metrics())
  } catch (err) {
    res.status(500).end('Erro ao gerar métricas')
  }
})

const sessionStoreType = (process.env.SESSION_STORE || 'redis').toLowerCase()
const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  console.error('SESSION_SECRET não configurado. Defina uma string longa e aleatória.')
  process.exit(1)
}

async function createSessionStore() {
  if (sessionStoreType !== 'redis') {
    return null
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
  redisClient.on('error', (err) => {
    console.error('Redis error:', err)
    redisUpGauge.set(0)
  })
  redisClient.on('connect', () => console.log('Redis: conectando...'))
  redisClient.on('ready', () => {
    console.log('Redis: pronto')
    redisUpGauge.set(1)
  })

  try {
    await withTimeout(redisClient.connect(), 3000)
    await redisClient.ping()
    redisUpGauge.set(1)
    console.log('Sessões: usando RedisStore')
    return new RedisStore({ client: redisClient })
  } catch (err) {
    redisUpGauge.set(0)
    console.error('Redis indisponível, sessões cairão para MemoryStore:', err.message)
    return null
  }
}

async function setupSession() {
  const store = await createSessionStore()

  const sessionOptions = {
    secret: sessionSecret,
    name: 'cs16.sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 1000
    }
  }
  if (store) sessionOptions.store = store

  sessionMiddleware = session(sessionOptions)
}

const lastState = {}
const lastMapByServer = {}
let snapshotInProgress = false
const lastServerInfo = {}


const Gamedig = require('gamedig')

const GAMEDIG_HOST = process.env.GAMEDIG_HOST || 'cs16'
const GAMEDIG_PORT = parseInt(process.env.GAMEDIG_PORT || '27015', 10)

function getServerConfigs() {
  const raw = process.env.CS_SERVERS
  if (!raw) return null
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) && list.length ? list : null
  } catch (err) {
    console.error('CS_SERVERS inválido:', err.message)
    return null
  }
}

const serverConfigs = getServerConfigs()

const primaryServer = serverConfigs && serverConfigs.length
  ? serverConfigs[0]
  : { id: 'main', name: GAMEDIG_HOST, host: GAMEDIG_HOST, port: GAMEDIG_PORT, liveDir: LIVE_DATA_DIR }

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
  return Gamedig.query({
    type: 'cs16',
    host: srv.host,
    port: parseInt(srv.port, 10)
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


// TOP 10
app.get('/top10', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

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
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY kills DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)

  } catch (err) {
    handleError(res, err)
  }
})

app.get('/top-headshots', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

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
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY hs DESC, kills DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})

app.get('/top-accuracy', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

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
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      ORDER BY accuracy DESC, hs DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})

app.get('/top-killstreak', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      WITH ordered AS (
        SELECT
          steamid,
          name,
          created_at,
          kills,
          LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills
        FROM csstats_snapshots
        ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      )
      SELECT
        steamid,
        MAX(name) AS name,
        MAX(GREATEST(kills - COALESCE(prev_kills, 0), 0)) AS streak
      FROM ordered
      GROUP BY steamid
      HAVING streak > 0
      ORDER BY streak DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


// TOP ASSISTS
app.get('/top-assists', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        assists,
        kills,
        deaths,
        skill,
        ROUND(assists / IF(kills = 0, 1, kills), 2) AS assists_per_kill
      FROM csstats
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY assists DESC, kills DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


// TOP DAMAGE
app.get('/top-damage', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        dmg,
        kills,
        deaths,
        skill,
        ROUND(dmg / IF(kills = 0, 1, kills), 1) AS dmg_per_kill
      FROM csstats
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY dmg DESC, kills DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


// TOP TEAM KILLS
app.get('/top-tk', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        tks,
        kills,
        deaths,
        skill
      FROM csstats
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY tks DESC, kills DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


// TOP BOMB
app.get('/top-bomb', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        bombplants,
        bombdefused,
        bombdef,
        bombexplosions,
        skill
      FROM csstats
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY (bombplants + bombdefused + bombdef + bombexplosions) DESC, bombplants DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


// TOP CONNECT TIME
app.get('/top-connect-time', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        connection_time,
        connects,
        kills,
        deaths,
        skill,
        ROUND(connection_time / 3600, 1) AS hours_played
      FROM csstats
      WHERE connection_time > 0
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      ORDER BY connection_time DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


// PLAYER
app.get('/player/:steamid', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT steamid, name, skill, kills, deaths, hs, tks, shots, hits,
             dmg, bombdef, bombdefused, bombplants, bombexplosions,
             connection_time, connects, assists, first_join, last_join, server_name
      FROM csstats
      WHERE steamid = ?
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      ORDER BY last_join DESC
      LIMIT 1
    `, [req.params.steamid, ...(sf ? sf.params : [])])

    res.json(rows[0] || null)

  } catch (err) {
    handleError(res, err)
  }
})

// BUSCA DE JOGADOR
app.get('/player-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) {
      return res.json([])
    }
    if (q.length > 64) {
      return res.status(400).json({ error: 'Busca muito longa' })
    }

    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT steamid, name, kills, deaths, hs, skill
      FROM csstats
      WHERE (name LIKE ? OR steamid LIKE ?)
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      ORDER BY kills DESC
      LIMIT 10
    `, [`%${q}%`, `%${q}%`, ...(sf ? sf.params : [])])

    res.json(rows)

  } catch (err) {
    handleError(res, err, 'busca de jogador')
  }
})


// TOP SKILL
app.get('/topskill', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT name, steamid, skill
      FROM csstats
      ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
      ORDER BY skill DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)

  } catch (err) {
    handleError(res, err)
  }
})


// TOP KD
app.get('/topkd', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        kills,
        deaths,
        ROUND(kills / IF(deaths = 0, 1, deaths), 2) AS kd
      FROM csstats
      WHERE kills > 10
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      ORDER BY kd DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)

  } catch (err) {
    handleError(res, err)
  }
})


//STATUS GERAIS
app.get('/stats', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [[players]] = await db.query(
      `SELECT COUNT(*) total FROM csstats ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}`,
      sf ? sf.params : []
    )

    const [[kills]] = await db.query(
      `SELECT COALESCE(SUM(kills), 0) total FROM csstats ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}`,
      sf ? sf.params : []
    )

    const [[maps]] = await db.query(
      `SELECT COUNT(DISTINCT map) total FROM csstats_snapshots ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}`,
      sf ? sf.params : []
    )

    res.json({
      players: players.total,
      kills: kills.total,
      maps: maps.total,
    })
  } catch (err) {
    handleError(res, err)
  }
})

// MAPS
const SNAPSHOT_STALE_MS = 10 * 60 * 1000

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


setInterval(snapshot, 60000)

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
        WITH ordered AS (
          SELECT kills, created_at,
            LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills
          FROM csstats_snapshots
          WHERE server_name = ? AND ${NOT_BOT}
        )
        SELECT COALESCE(SUM(GREATEST(kills - COALESCE(prev_kills, 0), 0)), 0) AS kills7d
        FROM ordered
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `, [srv.id])
      const [[{ kills30d }]] = await db.query(`
        WITH ordered AS (
          SELECT kills, created_at,
            LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills
          FROM csstats_snapshots
          WHERE server_name = ? AND ${NOT_BOT}
        )
        SELECT COALESCE(SUM(GREATEST(kills - COALESCE(prev_kills, 0), 0)), 0) AS kills30d
        FROM ordered
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `, [srv.id])
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

setInterval(collectDbStats, 60000)
collectDbStats()

app.get('/maps', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT
        map,
        COUNT(*) AS snapshots
      FROM csstats_snapshots
      WHERE map IS NOT NULL
        AND map <> ''
        AND map <> 'unknown'
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      GROUP BY map
      ORDER BY snapshots DESC, map ASC
    `, sf ? sf.params : [])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


async function getMapRanking(map, limit, offset = 0, server = null) {
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
        LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
        LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
        LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
      FROM csstats_snapshots
      ${server ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
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
      MAX(name) AS name,
      SUM(kills_delta) AS kills,
      SUM(deaths_delta) AS deaths,
      SUM(hs_delta) AS hs,
      MAX(skill) AS skill,
      ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
    FROM deltas
    WHERE map = ?
    GROUP BY steamid
    HAVING kills > 0 OR deaths > 0 OR hs > 0
    ORDER BY kills DESC, kd DESC
    LIMIT ? OFFSET ?
  `, [...(server ? [server] : []), map, limit, offset])

  return rows
}

app.get('/map-ranking/:map', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req, 20)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const rows = await getMapRanking(req.params.map, limit, offset, sf ? sf.server : null)
    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


app.get('/ranking/weekly', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

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
          LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
          LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
          LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
        FROM csstats_snapshots
        ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
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
        MAX(name) AS name,
        SUM(kills_delta) AS kills,
        SUM(deaths_delta) AS deaths,
        SUM(hs_delta) AS hs,
        MAX(skill) AS skill,
        ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
      FROM deltas
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY steamid
      HAVING kills > 0 OR deaths > 0 OR hs > 0
      ORDER BY kills DESC, kd DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


app.get('/ranking/monthly', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

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
          LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
          LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
          LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
        FROM csstats_snapshots
        ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
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
        MAX(name) AS name,
        SUM(kills_delta) AS kills,
        SUM(deaths_delta) AS deaths,
        SUM(hs_delta) AS hs,
        MAX(skill) AS skill,
        ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
      FROM deltas
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY steamid
      HAVING kills > 0 OR deaths > 0 OR hs > 0
      ORDER BY kills DESC, kd DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})


app.get('/player-history-daily/:steamid', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      WITH ordered AS (
        SELECT
          steamid,
          created_at,
          kills,
          deaths,
          hs,
          skill,
          LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
          LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
          LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
        FROM csstats_snapshots
        WHERE steamid = ?
        ${sf ? sf.where : ''}
        ${NOT_BOT_WHERE}
      ),
      deltas AS (
        SELECT
          created_at,
          GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
          GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
          GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
          skill
        FROM ordered
      )
      SELECT
        DATE(created_at) AS day,
        SUM(kills_delta) AS kills,
        SUM(deaths_delta) AS deaths,
        SUM(hs_delta) AS hs,
        MAX(skill) AS skill
      FROM deltas
      GROUP BY day
      HAVING kills > 0 OR deaths > 0 OR hs > 0
      ORDER BY day DESC
      LIMIT 60
    `, [req.params.steamid, ...(sf ? sf.params : [])])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})

app.get('/player-last-map/:steamid', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT map, created_at
      FROM csstats_snapshots
      WHERE steamid = ?
        AND map IS NOT NULL
        AND map <> ''
        AND map <> 'unknown'
      ${sf ? sf.where : ''}
      ${NOT_BOT_WHERE}
      ORDER BY created_at DESC
      LIMIT 1
    `, [req.params.steamid, ...(sf ? sf.params : [])])

    res.json(rows[0] || null)
  } catch (err) {
    handleError(res, err)
  }
})

// HISTÓRICO DE POSIÇÃO NO RANKING
app.get('/player-rank-history/:steamid', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      WITH daily AS (
        SELECT
          steamid,
          DATE(created_at) AS day,
          MAX(skill) AS skill
        FROM csstats_snapshots
        WHERE steamid = ?
        ${sf ? sf.where : ''}
        ${NOT_BOT_WHERE}
        GROUP BY steamid, day
      ),
      all_players_daily AS (
        SELECT
          steamid,
          DATE(created_at) AS day,
          MAX(skill) AS skill
        FROM csstats_snapshots
        WHERE created_at >= COALESCE((SELECT MIN(day) FROM daily), NOW() - INTERVAL 90 DAY)
        ${sf ? sf.where : ''}
        ${NOT_BOT_WHERE}
        GROUP BY steamid, day
      ),
      ranked AS (
        SELECT
          day,
          steamid,
          skill,
          RANK() OVER (PARTITION BY day ORDER BY skill DESC) AS position
        FROM all_players_daily
      )
      SELECT
        r.day,
        r.position,
        r.skill,
        d.total_players
      FROM ranked r
      JOIN (
        SELECT day, COUNT(*) AS total_players
        FROM all_players_daily
        GROUP BY day
      ) d ON d.day = r.day
      WHERE r.steamid = ?
      ORDER BY r.day ASC
    `, [req.params.steamid, ...(sf ? sf.params : []), ...(sf ? sf.params : []), req.params.steamid])

    res.json(rows)
  } catch (err) {
    handleError(res, err)
  }
})

app.get('/servers', async (req, res) => {
  const list = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]
  const results = await Promise.all(list.map(async (srv) => {
    try {
      const state = await queryServer(srv)
      return {
        id: srv.id,
        name: srv.name || srv.host,
        host: srv.host,
        port: parseInt(srv.port, 10),
        online: true,
        map: state.map,
        players: state.players.length,
        maxplayers: state.maxplayers,
        hostname: state.name
      }
    } catch (err) {
      return {
        id: srv.id,
        name: srv.name || srv.host,
        host: srv.host,
        port: parseInt(srv.port, 10),
        online: false,
        map: 'unknown',
        players: 0,
        maxplayers: 0,
        hostname: 'offline'
      }
    }
  }))
  res.json(results)
})

app.get('/server/:id', async (req, res) => {
  const srv = findServer(req.params.id)
  if (!srv) return res.status(400).json({ error: `Servidor não configurado: ${req.params.id}` })
  try {
    const state = await queryServer(srv)
    res.json({
      id: srv.id,
      name: srv.name || srv.host,
      host: srv.host,
      port: parseInt(srv.port, 10),
      online: true,
      map: state.map,
      players: state.players.length,
      maxplayers: state.maxplayers,
      hostname: state.name,
      playersList: state.players
    })
  } catch (err) {
    res.json({
      id: srv.id,
      name: srv.name || srv.host,
      host: srv.host,
      port: parseInt(srv.port, 10),
      online: false,
      map: 'unknown',
      players: 0,
      maxplayers: 0,
      hostname: 'offline',
      playersList: []
    })
  }
})

app.get('/server', async (req, res) => {
  const srv = req.query.server ? findServer(req.query.server) : primaryServer
  if (!srv) return res.status(400).json({ error: `Servidor não configurado: ${req.query.server}` })

  try {

    const state = await queryServer(srv)

    res.json({
      map: state.map,
      players: state.players.length,
      maxplayers: state.maxplayers,
      hostname: state.name
    })

  } catch (err) {

    res.json({
      map: 'unknown',
      players: 0,
      maxplayers: 0,
      hostname: 'offline'
    })

  }

})


//ADMIN FUNCTIONS
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

function requireAdmin(req, res, next) {
  if (!req.session?.adminToken) {
    return res.status(401).json({ error: 'Não autenticado' })
  }
  next()
}

function getCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex')
  }
  return req.session.csrfToken
}

function requireCsrf(req, res, next) {
  const headerToken = req.get('x-csrf-token')
  const sessionToken = req.session?.csrfToken

  if (!headerToken || !sessionToken || !timingSafeEqualStr(headerToken, sessionToken)) {
    return res.status(403).json({ error: 'Token CSRF inválido' })
  }
  next()
}

app.post('/admin/login', loginLimiter, requireCsrf, async (req, res) => {
  try {
    const { password } = req.body || {}

    if (!password) {
      return res.status(400).json({ error: 'Senha RCON obrigatória' })
    }

    const rconPassword = process.env.RCON_PASSWORD
    if (!rconPassword) {
      console.error('RCON_PASSWORD não configurado no ambiente')
      return res.status(500).json({ success: false, error: 'RCON não configurado no servidor' })
    }

    if (!timingSafeEqualStr(password, rconPassword)) {
      return res.status(401).json({ success: false, error: 'Senha incorreta' })
    }

    const response = await runRconCommand(rconPassword, 'status').catch(() => 'ok')

    req.session.regenerate((err) => {
      if (err) {
        console.error('Erro ao regenerar sessão:', err)
        return res.status(500).json({ success: false, error: 'Falha ao criar sessão' })
      }

      req.session.adminToken = crypto.randomBytes(32).toString('hex')
      req.session.adminLoggedInAt = Date.now()
      req.session.csrfToken = crypto.randomBytes(32).toString('hex')

      res.json({
        success: true,
        message: 'Autenticado com sucesso',
        csrfToken: req.session.csrfToken,
        response
      })
    })
  } catch (err) {
    console.error('Erro no login RCON:', err)
    res.status(401).json({
      success: false,
      error: 'Falha ao autenticar no RCON'
    })
  }
})

app.post('/admin/command', commandLimiter, requireAdmin, requireCsrf, async (req, res) => {
  try {
    const { command, server } = req.body || {}

    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Comando obrigatório' })
    }

    const rconPassword = process.env.RCON_PASSWORD
    if (!rconPassword) {
      return res.status(500).json({ success: false, error: 'RCON não configurado' })
    }

    const response = await runRconCommand(rconPassword, command.trim(), server)

    res.json({
      success: true,
      command: command.trim(),
      server: server || primaryServer.id,
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

app.post('/admin/logout', requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('cs16.sid')
    res.json({ success: true })
  })
})

//ROTA DE SESSÃO
app.get('/admin/session', (req, res) => {
  res.json({
    authenticated: !!req.session?.adminToken,
    csrfToken: getCsrfToken(req)
  })
})

app.get('/live/killfeed', (req, res) => {
  try {
    if (req.query.server && !findServer(req.query.server)) {
      return res.status(400).json({ error: `Servidor não configurado: ${req.query.server}` })
    }
    const filePath = path.join(resolveLiveDir(req.query.server), 'live_killfeed.json')

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
    if (req.query.server && !findServer(req.query.server)) {
      return res.status(400).json({ error: `Servidor não configurado: ${req.query.server}` })
    }
    const filePath = path.join(resolveLiveDir(req.query.server), 'live_scoreboard.json')

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

// SSE LIVE
const sseClients = new Set()
let ssePingTimer = null

function readLiveFile(name, dir) {
  const filePath = path.join(dir || LIVE_DATA_DIR, name)
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}

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

app.get('/live/events', (req, res) => {
  if (req.query.server && !findServer(req.query.server)) {
    return res.status(400).json({ error: `Servidor não configurado: ${req.query.server}` })
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  res.write('retry: 3000\n\n')

  const dir = resolveLiveDir(req.query.server)
  const client = { res, dir }
  sseClients.add(client)

  const scoreboard = readLiveFile('live_scoreboard.json', dir)
  const killfeed = readLiveFile('live_killfeed.json', dir)
  if (scoreboard) res.write(`event: scoreboard\ndata: ${JSON.stringify(scoreboard)}\n\n`)
  if (killfeed) res.write(`event: killfeed\ndata: ${JSON.stringify(killfeed)}\n\n`)

  req.on('close', () => {
    sseClients.delete(client)
  })
})

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
      }
    } catch (err) {
      console.error(`Erro ao registrar partida (${srv.id}):`, err.message)
    }
  }
}

app.get('/matches', async (req, res) => {
  try {
    const { limit, offset } = getPagination(req)
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
      FROM cs_matches
      ${sf ? 'WHERE server = ?' : ''}
      ORDER BY ended_at DESC
      LIMIT ? OFFSET ?
    `, [...(sf ? sf.params : []), limit, offset])

    res.json(rows)
  } catch (err) {
    handleError(res, err, 'listagem de partidas')
  }
})

app.get('/matches/latest', async (req, res) => {
  try {
    const sf = getServerFilter(req)
    if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

    const [rows] = await db.query(`
      SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
      FROM cs_matches
      ${sf ? 'WHERE server = ?' : ''}
      ORDER BY ended_at DESC
      LIMIT 1
    `, sf ? sf.params : [])

    res.json(rows[0] || null)
  } catch (err) {
    handleError(res, err, 'última partida')
  }
})

app.get('/matches/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
      FROM cs_matches
      WHERE id = ?
    `, [req.params.id])

    res.json(rows[0] || null)
  } catch (err) {
    handleError(res, err, 'partida')
  }
})

// ALERTAS DE SERVIDOR
const alertWebhookUrl = process.env.ALERT_WEBHOOK_URL || ''
let serverAlertState = {}
const alertEvents = []

function pushAlertEvent(serverId, type) {
  alertEvents.push({ serverId, type, at: new Date().toISOString() })
  if (alertEvents.length > 20) {
    alertEvents.shift()
  }
}

async function sendAlert(text) {
  if (!alertWebhookUrl) return
  try {
    const isDiscord = /discord(app)?\.com\/api\/webhooks/i.test(alertWebhookUrl)
    await withTimeout(fetch(alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isDiscord ? { content: text } : { text })
    }), 5000)
  } catch (err) {
    console.error('Erro ao enviar alerta:', err.message)
  }
}

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

app.get('/alerts', (req, res) => {
  const servers = serverConfigs && serverConfigs.length ? serverConfigs : [primaryServer]
  const current = {}
  for (const srv of servers) {
    current[srv.id] = serverAlertState[srv.id] === undefined
      ? 'unknown'
      : serverAlertState[srv.id] ? 'online' : 'offline'
  }
  res.json({
    configured: !!alertWebhookUrl,
    currentStatus: current,
    events: alertEvents
  })
})

// LOGIN STEAM (OpenID)
const steamReturnUrl = process.env.STEAM_RETURN_URL || ''
const steamAdminIds = new Set(
  (process.env.STEAM_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const steamRealm = steamReturnUrl ? new URL(steamReturnUrl).origin + '/' : ''

function buildSteamOpenIdUrl(returnTo) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': steamRealm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  })
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`
}

function extractSteamId(claimedId) {
  const match = String(claimedId || '').match(/\/id\/(\d+)$/)
  return match ? match[1] : null
}

app.get('/auth/steam', (req, res) => {
  if (!steamReturnUrl || !steamAdminIds.size) {
    return res.status(400).json({ error: 'Login Steam não configurado (STEAM_RETURN_URL / STEAM_ADMIN_IDS)' })
  }
  res.redirect(buildSteamOpenIdUrl(steamReturnUrl))
})

app.get('/auth/steam/callback', async (req, res) => {
  if (!steamReturnUrl || !steamAdminIds.size) {
    return res.status(400).json({ error: 'Login Steam não configurado' })
  }

  const params = {}
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith('openid.')) params[key] = String(value)
  }
  params['openid.mode'] = 'check_authentication'

  try {
    const validation = await withTimeout(fetch(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    }), 15000)
    const text = await validation.text()

    if (!/is_valid:\s*true/i.test(text)) {
      return res.status(403).send('Validação OpenID falhou')
    }

    const steamId = extractSteamId(params['openid.claimed_id'] || params['openid.identity'])
    if (!steamId || !steamAdminIds.has(steamId)) {
      return res.status(403).send('SteamID não autorizado para administração')
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('Erro ao regenerar sessão (Steam):', err)
        return res.status(500).send('Erro interno')
      }
      req.session.adminToken = crypto.randomBytes(32).toString('hex')
      req.session.adminLoggedInAt = Date.now()
      req.session.steamId = steamId
      req.session.csrfToken = crypto.randomBytes(32).toString('hex')
      res.redirect('/admin.html')
    })
  } catch (err) {
    console.error('Erro no callback Steam:', err.message)
    res.status(502).send('Erro ao validar login Steam')
  }
})

app.get('/auth/steam/status', (req, res) => {
  res.json({
    enabled: !!(steamReturnUrl && steamAdminIds.size),
    steamId: req.session?.steamId || null
  })
})

// INICIALIZA SERVIDOR
async function start() {
  try {
    await ensureSchema()
  } catch (err) {
    console.error('Falha ao garantir schema do banco:', err.message)
  }
  await setupSession()
  app.listen(3000, '0.0.0.0', () => {
    console.log('API rodando na porta 3000')
    startSsePolling()
    setInterval(checkServerAlerts, 30000)
    checkServerAlerts()
  })
}

start().catch((err) => {
  console.error('Falha ao inicializar API:', err)
  process.exit(1)
})
