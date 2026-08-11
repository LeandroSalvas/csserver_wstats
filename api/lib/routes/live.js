// Rotas LIVE: killfeed, estado ao vivo e SSE (eventos em tempo real).

const fs = require('fs')
const path = require('path')

const {
  findServer,
  resolveLiveDir,
  readLiveFile,
  sseClients,
  MAX_SSE_CLIENTS
} = require('../core')

function register(app) {
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

  app.get('/live/events', (req, res) => {
    if (req.query.server && !findServer(req.query.server)) {
      return res.status(400).json({ error: `Servidor não configurado: ${req.query.server}` })
    }
    // Limite de clientes SSE: evita vazamento de conexões por fan-out de páginas.
    if (sseClients.size >= MAX_SSE_CLIENTS) {
      return res.status(429).json({ error: 'Muitas conexões SSE abertas. Tente novamente.' })
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
}

module.exports = { register }
