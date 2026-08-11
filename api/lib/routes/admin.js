// Rotas de admin (RCON + sessão) e login Steam (OpenID).

const crypto = require('crypto')

const {
  loginLimiter,
  commandLimiter,
  requireAdmin,
  requireCsrf,
  getCsrfToken,
  timingSafeEqualStr,
  withTimeout,
  runRconCommand,
  primaryServer,
  steamReturnUrl,
  steamAdminIds,
  STEAM_OPENID_ENDPOINT,
  steamRealm
} = require('../core')

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

function register(app) {
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
}

module.exports = { register }
