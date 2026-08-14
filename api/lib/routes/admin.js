// Rotas de admin: console RCON (autenticado via sessão de usuário) e sessão.
// O login (local/Google/Steam) agora vive em routes/auth.js — a senha RCON não
// é mais solicitada no frontend; o backend a usa a partir do ambiente.

const {
  commandLimiter,
  requireAdmin,
  requireCsrf,
  getCsrfToken,
  runRconCommand,
  getServerList
} = require('../core')

function register(app) {
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
        server: server || (getServerList()[0] || {}).id || 'main',
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

  app.get('/admin/session', (req, res) => {
    res.json({
      authenticated: !!req.session?.user,
      user: req.session?.user || null,
      csrfToken: getCsrfToken(req)
    })
  })
}

module.exports = { register }
