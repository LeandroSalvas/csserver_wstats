// Ponto de entrada da API: monta o app Express, registra rotas (módulos em
// lib/), e cuida de inicialização e encerramento gracioso.

const express = require('express')
const cors = require('cors')

const {
  config,
  metrics,
  db,
  cache,
  security,
  helpers,
  serverCtx,
  live,
  ensureSchema,
  seedSuperadmin,
  setupSession,
  getSessionMiddleware,
  withTimeout,
  httpRequestsTotal,
  httpRequestDuration,
  checkServerAlerts,
  checkStackAlerts
} = require('./lib/core')
const { startDiscordBot, destroyDiscordBot } = require('./lib/discordBot')

const app = express()
app.set('trust proxy', 1)
app.use(express.json())

app.use(cors({
  origin: config.corsOrigins,
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

app.use((req, res, next) => {
  if (!getSessionMiddleware()) return next(new Error('Sessão ainda não inicializada'))
  return getSessionMiddleware()(req, res, next)
})

// Métricas HTTP (contador + duração) registradas por resposta.
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

// Rotas (módulos de lib/routes).
require('./lib/routes/top').register(app)
require('./lib/routes/rankings').register(app)
require('./lib/routes/system').register(app)
require('./lib/routes/auth').register(app)
require('./lib/routes/admin').register(app)
require('./lib/routes/adminServers').register(app)
require('./lib/routes/adminUsers').register(app)
require('./lib/routes/matches').register(app)
require('./lib/routes/live').register(app)

// Tratador global de erros (Express 5 encaminha rejeições async para cá).
function errorHandler(err, req, res, next) {
  console.error('Erro não tratado:', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: 'Erro interno do servidor' })
}
app.use(errorHandler)

// INICIALIZA SERVIDOR
async function start() {
  // ensureSchema com retry/backoff: banco pode estar subindo junto com a API
  // no compose (depends_on espera "healthy", mas conexões ainda podem falhar).
  const SCHEMA_MAX_RETRIES = 5
  for (let attempt = 1; attempt <= SCHEMA_MAX_RETRIES; attempt++) {
    try {
      await ensureSchema()
      break
    } catch (err) {
      if (attempt === SCHEMA_MAX_RETRIES) {
        console.error('Falha ao garantir schema do banco após retries:', err.message)
      } else {
        const delay = Math.min(1000 * 2 ** attempt, 10000)
        console.warn(`ensureSchema falhou (tentativa ${attempt}/${SCHEMA_MAX_RETRIES}); retry em ${delay}ms:`, err.message)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  await setupSession()
  await seedSuperadmin()
  serverCtx.startConfigWatch()

  const server = app.listen(3000, '0.0.0.0', () => {
    console.log('API rodando na porta 3000')
    live.startSsePolling()
    async function checkAlerts() {
      await Promise.allSettled([checkServerAlerts(), checkStackAlerts()])
    }
    setInterval(checkAlerts, 30000)
    checkAlerts()
    setInterval(serverCtx.snapshot, 60000)
    serverCtx.snapshot()
    setInterval(serverCtx.collectDbStats, 60000)
    serverCtx.collectDbStats()
    startDiscordBot()
  })
  return server
}

const serverPromise = start()
serverPromise.then((srv) => {
  setupGracefulShutdown(srv)
}).catch((err) => {
  console.error('Falha ao inicializar API:', err)
  process.exit(1)
})

// Encerramento gracioso: para de aceitar conexões, desconecta clientes SSE,
// fecha o pool MySQL e o Redis, e encerra com exit 0.
function setupGracefulShutdown(srv) {
  const shutdown = () => {
    console.log('Encerrando com graça (SIGTERM/SIGINT)...')

    destroyDiscordBot()

    for (const client of live.sseClients) client.res.end()
    live.sseClients.clear()

    const forceExit = setTimeout(() => {
      console.error('Shutdown excedeu 10s; forçando saída')
      process.exit(1)
    }, 10000)
    forceExit.unref()

    srv.close(async () => {
      const closes = [db.end()]
      const redisClient = cache.getRedisClient()
      if (redisClient) closes.push(withTimeout(redisClient.quit(), 3000).catch(() => {}))
      await Promise.allSettled(closes)
      clearTimeout(forceExit)
      console.log('API encerrada')
      process.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err)
  process.exit(1)
})
