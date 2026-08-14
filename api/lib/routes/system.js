// Rotas de sistema: health, metrics, servidores e alertas.

const {
  db,
  getRedisClient,
  withTimeout,
  requireMetricsAuth,
  register: promRegister,
  dbUpGauge,
  redisUpGauge,
  getServerList,
  findServer,
  queryServer,
  serverAlertState,
  alertEvents,
  alertWebhookUrl,
  getWatchServerIds
} = require('../core')

function register(app) {
  app.get('/health', async (req, res) => {
    const health = { status: 'ok', db: 'ok' }

    try {
      await db.query('SELECT 1 AS ok')
      dbUpGauge.set(1)
    } catch (err) {
      console.error('Health: banco indisponível:', err.message)
      dbUpGauge.set(0)
      return res.status(503).json({
        status: 'error',
        db: 'down'
      })
    }

    const redisClient = getRedisClient()
    if (redisClient) {
      try {
        await withTimeout(redisClient.ping(), 2000)
        health.redis = 'ok'
        redisUpGauge.set(1)
      } catch (err) {
        health.status = 'degraded'
        health.redis = 'down'
        redisUpGauge.set(0)
      }
    }

    res.json(health)
  })

  app.get('/metrics', requireMetricsAuth, async (req, res) => {
    try {
      res.set('Content-Type', promRegister.contentType)
      res.end(await promRegister.metrics())
    } catch (err) {
      res.status(500).end('Erro ao gerar métricas')
    }
  })

  app.get('/servers', async (req, res) => {
    const list = getServerList()
    let watchIds = new Set()
    try { watchIds = await getWatchServerIds() } catch (err) { /* mantém vazio */ }
    const results = await Promise.all(list.map(async (srv) => {
      try {
        const state = await queryServer(srv)
        return {
          id: srv.id,
          name: srv.name || srv.host,
          host: srv.host,
          port: parseInt(srv.port, 10),
          hostPort: srv.hostPort || parseInt(srv.port, 10),
          spectatorUrl: srv.spectatorUrl || null,
          hasWatch: watchIds.has(srv.id),
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
          hostPort: srv.hostPort || parseInt(srv.port, 10),
          spectatorUrl: srv.spectatorUrl || null,
          hasWatch: watchIds.has(srv.id),
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
        hostPort: srv.hostPort || parseInt(srv.port, 10),
        spectatorUrl: srv.spectatorUrl || null,
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
        hostPort: srv.hostPort || parseInt(srv.port, 10),
        spectatorUrl: srv.spectatorUrl || null,
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
    const srv = req.query.server ? findServer(req.query.server) : getServerList()[0]
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

  app.get('/alerts', (req, res) => {
    const servers = getServerList()
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
}

module.exports = { register }
