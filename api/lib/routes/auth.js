// Rotas de autenticação: login local (usuário/senha), Google OAuth2 e Steam
// OpenID 2.0, com fluxo de aprovação (status pending) para primeiros logins.
// Também expõe /auth/guard para o nginx auth_request (bloqueio de URLs).

const crypto = require('crypto')

const {
  loginLimiter,
  requireCsrf,
  getCsrfToken,
  timingSafeEqualStr,
  withTimeout,
  serializeUser,
  loginLocal,
  findOrCreateUser,
  steamReturnUrl,
  STEAM_OPENID_ENDPOINT,
  steamRealm,
  googleClientId,
  googleClientSecret,
  googleReturnUrl
} = require('../core')

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

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

// `next` só aceita um path absoluto same-origin (evita open redirect).
function sanitizeNext(raw) {
  const next = String(raw || '')
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next
  return '/admin'
}

function buildReturnToWithNext(base, next) {
  return base + (next ? `?next=${encodeURIComponent(next)}` : '')
}

// Preenche a sessão após um login bem-sucedido (sessão já regenerada).
function establishUserSession(req, user) {
  req.session.user = serializeUser(user)
  req.session.csrfToken = crypto.randomBytes(32).toString('hex')
  return req.session.csrfToken
}

function userStatusRedirect(res, user, fallbackNext) {
  if (user.status === 'active') {
    res.redirect(fallbackNext)
    return
  }
  res.redirect(`/login?pending=1${fallbackNext !== '/admin' ? `&next=${encodeURIComponent(fallbackNext)}` : ''}`)
}

function register(app) {
  app.post('/auth/login', loginLimiter, requireCsrf, async (req, res) => {
    try {
      const { username, password, next } = req.body || {}
      const user = await loginLocal(username, password)

      if (!user || user.status !== 'active') {
        return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos' })
      }

      req.session.regenerate((err) => {
        if (err) {
          console.error('Erro ao regenerar sessão (login local):', err)
          return res.status(500).json({ success: false, error: 'Falha ao criar sessão' })
        }
        const csrfToken = establishUserSession(req, user)
        res.json({
          success: true,
          message: 'Autenticado com sucesso',
          csrfToken,
          user: serializeUser(user),
          next: sanitizeNext(next)
        })
      })
    } catch (err) {
      console.error('Erro no login local:', err)
      res.status(500).json({ success: false, error: 'Erro interno do servidor' })
    }
  })

  app.post('/auth/logout', requireCsrf, (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('cs16.sid')
      res.json({ success: true })
    })
  })

  app.get('/auth/session', (req, res) => {
    res.json({
      authenticated: !!req.session?.user,
      user: req.session?.user || null,
      csrfToken: getCsrfToken(req)
    })
  })

  app.get('/auth/status', (req, res) => {
    res.json({
      providers: {
        local: true,
        steam: !!steamReturnUrl,
        google: !!(googleClientId && googleClientSecret && googleReturnUrl)
      },
      user: req.session?.user || null
    })
  })

  // Público (sem CSRF): usado pelo nginx auth_request para bloquear as URLs das
  // páginas restritas. 200 = admin ativo; 401 = negar (nginx redireciona).
  app.get('/auth/guard', (req, res) => {
    const user = req.session?.user
    const ok = user && user.status === 'active' && (user.role === 'admin' || user.role === 'superadmin')
    if (ok) return res.status(200).end()
    return res.status(401).end()
  })

  // --- Steam (OpenID 2.0) ---
  app.get('/auth/steam', (req, res) => {
    if (!steamReturnUrl) {
      return res.status(400).json({ error: 'Login Steam não configurado (STEAM_RETURN_URL)' })
    }
    const next = sanitizeNext(req.query.next)
    res.redirect(buildSteamOpenIdUrl(buildReturnToWithNext(steamReturnUrl, next)))
  })

  app.get('/auth/steam/callback', async (req, res) => {
    if (!steamReturnUrl) {
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
      if (!steamId) {
        return res.status(403).send('SteamID não identificado')
      }

      const next = sanitizeNext(req.query.next)
      const user = await findOrCreateUser('steam', steamId, {
        displayName: `Steam ${steamId.slice(-5)}`,
        avatarUrl: `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/10/${steamId}_full.jpg`
      })

      req.session.regenerate((err) => {
        if (err) {
          console.error('Erro ao regenerar sessão (Steam):', err)
          return res.status(500).send('Erro interno')
        }
        establishUserSession(req, user)
        userStatusRedirect(res, user, next)
      })
    } catch (err) {
      console.error('Erro no callback Steam:', err.message)
      res.status(502).send('Erro ao validar login Steam')
    }
  })

  // --- Google (OAuth2) ---
  app.get('/auth/google', (req, res) => {
    if (!googleClientId || !googleClientSecret || !googleReturnUrl) {
      return res.status(400).json({ error: 'Login Google não configurado (GOOGLE_CLIENT_ID/SECRET/RETURN_URL)' })
    }
    const next = sanitizeNext(req.query.next)
    const state = crypto.randomBytes(16).toString('hex')
    req.session.oauthState = state
    req.session.oauthNext = next

    const url = new URL(GOOGLE_AUTH_URL)
    url.searchParams.set('client_id', googleClientId)
    url.searchParams.set('redirect_uri', googleReturnUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('prompt', 'select_account')
    res.redirect(url.toString())
  })

  app.get('/auth/google/callback', async (req, res) => {
    if (!googleClientId || !googleClientSecret || !googleReturnUrl) {
      return res.status(400).json({ error: 'Login Google não configurado' })
    }

    const { code, state, error } = req.query
    if (error) return res.status(403).send(`Erro do Google: ${error}`)

    const expectedState = req.session?.oauthState
    const next = sanitizeNext(req.session?.oauthNext || '/admin')
    req.session.oauthState = null
    req.session.oauthNext = null

    if (!state || !expectedState || !timingSafeEqualStr(state, expectedState)) {
      return res.status(403).send('Validação de estado falhou')
    }
    if (!code) return res.status(400).send('Código de autorização ausente')

    try {
      const tokenRes = await withTimeout(fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: googleReturnUrl,
          grant_type: 'authorization_code'
        }).toString()
      }), 15000)

      const tokenData = await tokenRes.json()
      if (!tokenData.access_token) {
        console.error('Google: troca de token falhou:', tokenData)
        return res.status(502).send('Falha ao obter token do Google')
      }

      const infoRes = await withTimeout(fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      }), 15000)
      const info = await infoRes.json()
      if (!info.sub) {
        console.error('Google: userinfo inválido:', info)
        return res.status(502).send('Falha ao obter dados do usuário')
      }

      const user = await findOrCreateUser('google', info.sub, {
        displayName: info.name || null,
        email: info.email || null,
        avatarUrl: info.picture || null
      })

      req.session.regenerate((err) => {
        if (err) {
          console.error('Erro ao regenerar sessão (Google):', err)
          return res.status(500).send('Erro interno')
        }
        establishUserSession(req, user)
        userStatusRedirect(res, user, next)
      })
    } catch (err) {
      console.error('Erro no callback Google:', err.message)
      res.status(502).send('Erro ao validar login Google')
    }
  })
}

module.exports = { register }
