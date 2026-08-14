// login.js — Login de administrador (local + Steam/Google).

const loginForm = document.getElementById('loginForm')
const usernameInput = document.getElementById('loginUsername')
const passwordInput = document.getElementById('loginPassword')
const loginSubmit = document.getElementById('loginSubmit')
const loginStatus = document.getElementById('loginStatus')
const passwordToggle = document.getElementById('passwordToggle')
const steamLoginBtn = document.getElementById('steamLoginBtn')
const googleLoginBtn = document.getElementById('googleLoginBtn')
const guestNote = document.getElementById('guestNote')

// Só aceita um path absoluto same-origin (mesma regra da API). Default: HOME.
function safeNext(raw) {
  const next = String(raw || '')
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next
  return '/'
}

function showProviders() {
  fetch(`${API}/auth/status`, { credentials: 'include', cache: 'no-store' })
    .then((res) => res.json())
    .then((data) => {
      const providers = (data && data.providers) || {}
      if (steamLoginBtn) steamLoginBtn.hidden = !providers.steam
      if (googleLoginBtn) googleLoginBtn.hidden = !providers.google
    })
    .catch((err) => console.error('Erro ao verificar provedores:', err))
}

async function login(e) {
  e.preventDefault()

  const username = usernameInput.value.trim()
  const password = passwordInput.value

  if (!username || !password) {
    loginStatus.textContent = i18nUtils.t('auth.invalidCredentials')
    return
  }

  loginSubmit.disabled = true
  loginSubmit.textContent = i18nUtils.t('auth.loggingIn')

  // Volta para a página de origem após o login (default: HOME), ex.: /login?next=/usuarios.
  const params = new URLSearchParams(window.location.search)
  const next = safeNext(params.get('next'))

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': getCsrfToken() || ''
      },
      credentials: 'include',
      body: JSON.stringify({ username, password, next })
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      loginStatus.textContent = data.error || i18nUtils.t('auth.invalidCredentials')
      return
    }

    await loadAuthSession()
    renderPageNav()
    renderLanguageToggle()
    renderAuthBadge()

    if (isActiveAdmin(getCurrentUser())) {
      window.location.replace(safeNext(data.next))
    } else {
      guestNote.hidden = false
    }
  } catch (err) {
    console.error(err)
    loginStatus.textContent = i18nUtils.t('auth.loginError')
  } finally {
    loginSubmit.disabled = false
    loginSubmit.textContent = i18nUtils.t('auth.submit')
  }
}

if (passwordToggle && passwordInput) {
  passwordToggle.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password'
    passwordInput.type = isPassword ? 'text' : 'password'
    passwordToggle.textContent = i18nUtils.t(isPassword ? 'admin.hidePassword' : 'admin.showPassword')
    passwordInput.focus()
  })
}

if (steamLoginBtn) {
  steamLoginBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search)
    window.location.href = `${API}/auth/steam?next=${encodeURIComponent(safeNext(params.get('next')))}`
  })
}

if (googleLoginBtn) {
  googleLoginBtn.addEventListener('click', () => {
    const params = new URLSearchParams(window.location.search)
    window.location.href = `${API}/auth/google?next=${encodeURIComponent(safeNext(params.get('next')))}`
  })
}

document.addEventListener('DOMContentLoaded', () => {
  if (loginForm) loginForm.addEventListener('submit', login)

  const params = new URLSearchParams(window.location.search)
  if (params.get('pending') === '1') {
    guestNote.hidden = false
  }
  if (params.get('expired') === '1') {
    loginStatus.textContent = i18nUtils.t('auth.sessionExpired')
  }

  showProviders()
})
