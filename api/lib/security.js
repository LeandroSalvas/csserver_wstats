// Segurança: autenticação de métricas, sessões (Redis/MemoryStore), rate limits,
// admin (RCON) e CSRF.

const session = require('express-session')
const { createClient } = require('redis')
const { RedisStore } = require('connect-redis')
const rateLimit = require('express-rate-limit')
const crypto = require('crypto')

const {
  sessionSecret,
  sessionStoreType,
  metricsUser,
  metricsPass
} = require('./config')
const { redisUpGauge } = require('./metrics')
const { withTimeout, timingSafeEqualStr } = require('./helpers')
const { setRedisClient } = require('./cache')

if (!sessionSecret) {
  console.error('SESSION_SECRET não configurado. Defina uma string longa e aleatória.')
  process.exit(1)
}

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Tente novamente em 1 minuto.' }
})

const commandLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitos comandos. Tente novamente em 1 minuto.' }
})

// Basic Auth para /metrics (protege métricas de scrapers/curl na LAN).
// Sem METRICS_USER/METRICS_PASS configurados, /metrics permanece aberto com aviso.
if (!metricsUser || !metricsPass) {
  console.warn('METRICS_USER/METRICS_PASS não configurados — /metrics permanece sem autenticação')
}
function requireMetricsAuth(req, res, next) {
  if (!metricsUser || !metricsPass) return next()
  const denied = () => {
    res.set('WWW-Authenticate', 'Basic realm="cs16 metrics"')
    res.status(401).json({ error: 'Não autorizado' })
  }
  const b64 = String(req.headers.authorization || '').startsWith('Basic ')
    ? String(req.headers.authorization).slice(6)
    : ''
  if (!b64) return denied()
  let decoded = ''
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8')
  } catch (err) {
    return denied()
  }
  const sep = decoded.indexOf(':')
  const user = sep === -1 ? '' : decoded.slice(0, sep)
  const pass = sep === -1 ? '' : decoded.slice(sep + 1)
  if (timingSafeEqualStr(user, metricsUser) && timingSafeEqualStr(pass, metricsPass)) return next()
  return denied()
}

let sessionMiddleware = null

async function createSessionStore() {
  if (sessionStoreType !== 'redis') {
    setRedisClient(null)
    return null
  }

  const redisHost = process.env.REDIS_HOST || 'redis'
  const redisPort = process.env.REDIS_PORT || '6379'
  const redisPassword = process.env.REDIS_PASSWORD || ''
  const redisDb = process.env.REDIS_DB || '0'

  const redisUrl = new URL(`redis://${redisHost}:${redisPort}`)
  if (redisPassword) redisUrl.password = redisPassword
  if (redisDb && redisDb !== '0') redisUrl.pathname = `/${redisDb}`

  const redisClient = createClient({
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
    setRedisClient(redisClient)
    console.log('Sessões: usando RedisStore')
    return new RedisStore({ client: redisClient })
  } catch (err) {
    redisUpGauge.set(0)
    setRedisClient(null)
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
      secure: process.env.SESSION_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 1000
    }
  }
  if (store) sessionOptions.store = store

  sessionMiddleware = session(sessionOptions)
}

function getSessionMiddleware() {
  return sessionMiddleware
}

// requireAdmin original (RCON via adminToken) foi substituído por autenticação
// de usuários (sessão com `user`). Mantemos os dois nomes para compatibilidade:
// requireAuth exige qualquer sessão; requireAdmin exige um usuário ativo com
// role admin/superadmin; requireSuperadmin exige o role superadmin.
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Não autenticado' })
  }
  next()
}

function isActiveAdmin(user) {
  return !!(user && user.status === 'active' && (user.role === 'admin' || user.role === 'superadmin'))
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Não autenticado' })
  }
  if (!isActiveAdmin(req.session.user)) {
    return res.status(403).json({ error: 'Acesso negado' })
  }
  next()
}

function requireSuperadmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Não autenticado' })
  }
  if (req.session.user.role !== 'superadmin' || req.session.user.status !== 'active') {
    return res.status(403).json({ error: 'Acesso negado' })
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

module.exports = {
  loginLimiter,
  commandLimiter,
  requireMetricsAuth,
  setupSession,
  getSessionMiddleware,
  requireAuth,
  requireAdmin,
  requireSuperadmin,
  getCsrfToken,
  requireCsrf,
  timingSafeEqualStr
}
