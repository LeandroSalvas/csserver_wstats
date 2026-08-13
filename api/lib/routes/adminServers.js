// Rotas de gerenciamento de servidores (admin autenticado). As mutações passam
// pelo adapter (serverManager.js) e exigem CSRF + commandLimiter.

const {
  commandLimiter,
  requireAdmin,
  requireCsrf,
  getProvider
} = require('../core')

function register(app) {
  app.get('/admin/servers', requireAdmin, async (req, res) => {
    try {
      const provider = getProvider()
      const servers = await provider.list()
      res.json({ servers })
    } catch (err) {
      console.error('Erro ao listar servidores (admin):', err)
      res.status(500).json({ error: 'Falha ao listar servidores', detail: err.message })
    }
  })

  app.get('/admin/servers/maps', requireAdmin, async (req, res) => {
    try {
      const provider = getProvider()
      const maps = await provider.availableMaps()
      res.json({ maps })
    } catch (err) {
      console.error('Erro ao listar mapas disponíveis:', err)
      res.status(500).json({ error: 'Falha ao listar mapas disponíveis', detail: err.message })
    }
  })

  app.post('/admin/servers/:id/start', commandLimiter, requireAdmin, requireCsrf, async (req, res) => {
    try {
      const provider = getProvider()
      const result = await provider.start(req.params.id)
      res.json({ success: true, ...result })
    } catch (err) {
      console.error('Erro ao iniciar servidor:', req.params.id, err.message)
      res.status(err.status || 500).json({ success: false, error: err.message || 'Falha ao iniciar servidor' })
    }
  })

  app.post('/admin/servers/:id/stop', commandLimiter, requireAdmin, requireCsrf, async (req, res) => {
    try {
      const provider = getProvider()
      const result = await provider.stop(req.params.id)
      res.json({ success: true, ...result })
    } catch (err) {
      console.error('Erro ao parar servidor:', req.params.id, err.message)
      res.status(err.status || 500).json({ success: false, error: err.message || 'Falha ao parar servidor' })
    }
  })

  app.post('/admin/servers/:id/restart', commandLimiter, requireAdmin, requireCsrf, async (req, res) => {
    try {
      const provider = getProvider()
      const result = await provider.restart(req.params.id)
      res.json({ success: true, ...result })
    } catch (err) {
      console.error('Erro ao reiniciar servidor:', req.params.id, err.message)
      res.status(err.status || 500).json({ success: false, error: err.message || 'Falha ao reiniciar servidor' })
    }
  })

  app.post('/admin/servers', commandLimiter, requireAdmin, requireCsrf, async (req, res) => {
    try {
      const provider = getProvider()
      const result = await provider.add(req.body || {})
      res.status(201).json({ success: true, server: result })
    } catch (err) {
      console.error('Erro ao adicionar servidor:', err.message)
      res.status(err.status || 500).json({ success: false, error: err.message || 'Falha ao adicionar servidor' })
    }
  })

  app.delete('/admin/servers/:id', commandLimiter, requireAdmin, requireCsrf, async (req, res) => {
    try {
      const provider = getProvider()
      const result = await provider.remove(req.params.id)
      res.json({ success: true, ...result })
    } catch (err) {
      console.error('Erro ao remover servidor:', req.params.id, err.message)
      res.status(err.status || 500).json({ success: false, error: err.message || 'Falha ao remover servidor' })
    }
  })
}

module.exports = { register }
