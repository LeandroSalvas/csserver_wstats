/*
 * common.js
 * Helper functions compartilhados entre várias páginas do frontend.
 *
 * Blocos e origens:
 * - app.js: status de página, fetchJson, skeleton loaders, navegação ativa
 * - maps.js: carregamento de lista de mapas
 * - rankings.js: carregamento de rankings
 * - player.js: carregamento de perfil e histórico
 * - map.js: carregamento de ranking por mapa
 * - live.js: carregamento de painel ao vivo e kill feed
 * - admin.js: permanece com lógica local específica de administração
 */

const API = '/api'

// --- Sessão de autenticação (admin) ---
let currentUser = null
let csrfToken = null
// Inicia o fetch da sessão imediatamente (paralelo ao restante do carregamento);
// initCommon() o aguarda antes de renderizar nav/guardar páginas.
const authSessionPromise = loadAuthSession()
// Exposto para as páginas que precisam aguardar a sessão antes de carregar
// dados de admin (evita o race de isActiveAdmin() rodar com user ainda null).
window.authSessionPromise = authSessionPromise

async function loadAuthSession() {
  try {
    const res = await fetch(`${API}/auth/session`, { credentials: 'include', cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      csrfToken = data.csrfToken || null
      currentUser = data.user || null
    }
  } catch (err) {
    console.error('Erro ao verificar sessão:', err)
  }
  return { user: currentUser, csrfToken }
}

function isActiveAdmin(user) {
  return !!(user && user.status === 'active' && (user.role === 'admin' || user.role === 'superadmin'))
}

function getCurrentUser() {
  return currentUser
}

function getCsrfToken() {
  return csrfToken
}

// Guard de página no cliente: redireciona para /login quando o body declara
// data-requires-admin e a sessão não é de um admin ativo. (Complemento da
// proteção no servidor via nginx auth_request — evita flash de conteúdo.)
function guardPage() {
  const requires = document.body && document.body.hasAttribute('data-requires-admin')
  if (!requires) return
  if (isActiveAdmin(currentUser)) return
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.replace(`/login?next=${next}`)
}

// bfcache: "voltar" restaura a página do cache sem re-executar o JS — após um
// logout o usuário veria a rota protegida de novo. No pageshow revalidamos a
// sessão e reaplicamos o guard/estado de autenticação.
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  loadAuthSession().then(() => {
    guardPage()
    renderPageNav()
    renderTopbar()
    renderLanguageToggle()
    renderAuthBadge()
    applyActiveNav()
  })
})

function renderTopbar() {
  let topbar = document.querySelector('.page-topbar')
  if (!topbar) {
    topbar = document.createElement('div')
    topbar.className = 'page-topbar'
    document.body.appendChild(topbar)
  }
  topbar.innerHTML = ''

  const langSlot = document.createElement('div')
  langSlot.className = 'lang-toggle-slot'
  topbar.appendChild(langSlot)

  const authSlot = document.createElement('div')
  authSlot.className = 'auth-badge-slot'
  topbar.appendChild(authSlot)
}

function renderAuthBadge() {
  const topbar = document.querySelector('.page-topbar')
  if (!topbar) return

  let slot = topbar.querySelector('.auth-badge-slot')
  if (!slot) {
    slot = document.createElement('div')
    slot.className = 'auth-badge-slot'
    topbar.appendChild(slot)
  }
  slot.innerHTML = ''
  slot.classList.toggle('is-auth', !!currentUser)

  if (!currentUser) {
    const link = document.createElement('a')
    link.href = '/login'
    link.className = 'auth-link'
    link.dataset.tooltip = i18nUtils.t('nav.login')
    link.textContent = '🔑 ' + i18nUtils.t('nav.login')
    slot.appendChild(link)
    return
  }

  const wrap = document.createElement('span')
  wrap.className = 'auth-user'
  const fullName = currentUser.displayName || currentUser.username || currentUser.provider
  const firstName = String(fullName).trim().split(/\s+/)[0] || currentUser.provider

  const avatar = document.createElement(currentUser.avatarUrl ? 'img' : 'span')
  avatar.className = 'auth-user-avatar'
  if (currentUser.avatarUrl) {
    avatar.src = currentUser.avatarUrl
    avatar.alt = ''
    avatar.addEventListener('error', () => {
      const fallback = document.createElement('span')
      fallback.className = 'auth-user-avatar auth-user-avatar-fallback'
      fallback.textContent = firstName.charAt(0).toUpperCase()
      avatar.replaceWith(fallback)
    })
  } else {
    avatar.classList.add('auth-user-avatar-fallback')
    avatar.textContent = firstName.charAt(0).toUpperCase()
  }
  wrap.appendChild(avatar)

  const name = document.createElement('span')
  name.className = 'auth-user-name'
  name.textContent = firstName
  name.dataset.tooltip = currentUser.role === 'superadmin' ? 'Superadmin' : 'Admin'
  wrap.appendChild(name)

  const logout = document.createElement('button')
  logout.type = 'button'
  logout.className = 'auth-logout'
  logout.textContent = i18nUtils.t('auth.logout')
  logout.onclick = async () => {
    try {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken || '' },
        credentials: 'include'
      })
    } catch (err) {
      console.error('Erro ao sair:', err)
    }
    currentUser = null
    csrfToken = null
    renderPageNav()
    renderTopbar()
    renderLanguageToggle()
    renderAuthBadge()
    applyActiveNav()
    window.location.href = '/'
  }
  wrap.appendChild(logout)
  slot.appendChild(wrap)
}

// Endereço público do servidor de jogo — edite aqui (usado na página "Conectar")
const SERVER_HOST = 'zueiracstrike.duckdns.org'
const SERVER_PORT = '27015'

// URL pública base do espectador web (WebRTC) — fallback quando a API não
// informa spectatorUrl por servidor (ex.: site estático offline).
// Exposto via swag em TLS dedicado (zueiracstrike-watch.subdomain.conf).
// A URL por servidor vem de /servers (campo spectatorUrl = BASE/<context>/),
// gerada por scripts/servers.sh compose a partir do WATCH_PUBLIC_BASE do .env.
const SPECTATOR_URL = 'https://zueiracstrike.duckdns.org:4445/'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getStatusEl() {
  return document.getElementById('statusMessage')
}

function setStatus(message, type = 'info') {
  const el = getStatusEl()
  if (!el) return
  el.textContent = message
  el.className = `status-message visible ${type}`
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
}

function clearStatus() {
  const el = getStatusEl()
  if (!el) return
  el.textContent = ''
  el.className = 'status-message'
}

function setStatusChip(elementId, value) {
  const element = document.getElementById(elementId)
  if (!element) return

  let normalized = value === 'Online' || value === 'OK'
    ? 'status-ok'
    : value === 'Aguardando' || value === 'Waiting'
      ? 'status-pending'
      : 'status-error'

  let text = value
  if (value === 'Online' || value === 'OK') {
    text = i18nUtils.t('status.online')
  } else if (value === 'Aguardando' || value === 'Waiting') {
    text = i18nUtils.t('status.pending')
  } else if (value === 'Não usado' || value === 'Not used') {
    text = i18nUtils.t('status.notUsed')
    normalized = 'status-pending'
  } else if (value === 'Offline') {
    text = i18nUtils.t('status.offline')
  } else if (value === 'Degradado' || value === 'Degraded') {
    text = i18nUtils.t('status.degraded')
  }

  element.innerText = text
  element.className = `status-pill ${normalized}`
}

async function fetchJson(path, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API}${path}`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    return res.json()
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(i18nUtils.t('errors.timeout'))
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

// --- Seleção de servidor (multi-servidor) ---
const SELECTED_SERVER_KEY = 'selectedServer'

function getSelectedServer() {
  return localStorage.getItem(SELECTED_SERVER_KEY) || ''
}

function setSelectedServer(id) {
  if (id) {
    localStorage.setItem(SELECTED_SERVER_KEY, id)
  } else {
    localStorage.removeItem(SELECTED_SERVER_KEY)
  }
}

function serverQuery() {
  const id = getSelectedServer()
  return id ? `?server=${encodeURIComponent(id)}` : ''
}

// Idem, porém para incluir em URLs que já possuem query string (?a=b&...).
function serverParam() {
  const id = getSelectedServer()
  return id ? `&server=${encodeURIComponent(id)}` : ''
}

let cachedServers = null

async function loadServersList() {
  if (cachedServers) return cachedServers
  cachedServers = await fetchJson('/servers')
  return cachedServers
}

// URL do espectador para um servidor: usa o spectatorUrl da API quando o
// servidor tem a stack de espectador criada (hasWatch); senão retorna null
// (esconde link/iframe). Fallback no SPECTATOR_URL base (main) apenas quando a
// API não responde (site estático offline).
async function spectatorUrlFor(serverId) {
  try {
    const servers = await loadServersList()
    const srv = servers && servers.find((s) => s.id === serverId)
    if (srv) return srv.hasWatch && srv.spectatorUrl ? srv.spectatorUrl : null
  } catch (err) {
    console.error('Erro ao resolver espectador:', err)
  }
  return serverId && serverId !== 'main' ? null : SPECTATOR_URL
}

// Popula qualquer <select class="server-selector"> com a lista de servidores.
// Emite um CustomEvent 'server-change' quando a seleção muda.
const selectorLabels = new WeakMap()

async function initServerSelector() {
  const selects = document.querySelectorAll('.server-selector')
  if (!selects.length) return

  let servers = []
  try {
    servers = await loadServersList()
  } catch (err) {
    console.error('Erro ao carregar lista de servidores:', err)
  }

  selects.forEach((select) => {
    select.innerHTML = ''

    // data-watch-only: só servidores com a stack de espectador (CSTV) criada
    // (usado na página /cstv — sem stack, o iframe nunca abriria).
    const watchOnly = select.dataset.watchOnly === '1'
    const visible = watchOnly ? servers.filter((s) => s.hasWatch) : servers

    let label = selectorLabels.get(select)
    if (!label) {
      label = document.createElement('label')
      label.className = 'server-selector-label'
      if (select.id) label.htmlFor = select.id
      select.parentNode.insertBefore(label, select)
      selectorLabels.set(select, label)
    }
    label.textContent = i18nUtils.t('server.selectServerLabel')

    if (!visible.length) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = i18nUtils.t('server.primary')
      select.appendChild(option)
      select.disabled = true
      return
    }

    visible.forEach((srv) => {
      const option = document.createElement('option')
      option.value = srv.id
      option.textContent = srv.name
      select.appendChild(option)
    })

    let selected = getSelectedServer()
    if (selected && visible.some((srv) => srv.id === selected)) {
      select.value = selected
    } else {
      // Sem escolha válida: exibe o servidor primário sem persistir (evita
      // gravar um default silencioso no localStorage) e limpa seleção inválida.
      if (selected) setSelectedServer('')
      select.value = visible[0].id
      setSelectedServer(visible[0].id)
    }

    if (!select.dataset.listenerAttached) {
      select.addEventListener('change', () => {
        setSelectedServer(select.value)
        document.dispatchEvent(new CustomEvent('server-change', { detail: { server: select.value } }))
      })
      select.dataset.listenerAttached = '1'
    }
  })
}

const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  maps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
  rankings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  advanced: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  matches: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="6" width="20" height="12" rx="2"/></svg>',
  connect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  cstv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>',
  modes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
  duel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="18" r="3"/><circle cx="16" cy="6" r="3"/><path d="M12.5 8 8 18"/><path d="M11.5 16 16 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  servers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
}

const pageNavItems = [
  { path: '/', labelKey: 'nav.home', tooltipKey: 'navTooltip.home', icon: NAV_ICONS.home },
  { path: '/mapas', labelKey: 'nav.maps', tooltipKey: 'navTooltip.maps', icon: NAV_ICONS.maps },
  { path: '/ranking', labelKey: 'nav.rankings', tooltipKey: 'navTooltip.rankings', icon: NAV_ICONS.rankings },
  { path: '/avancadas', labelKey: 'nav.advanced', tooltipKey: 'navTooltip.advanced', icon: NAV_ICONS.advanced },
  { path: '/partidas', labelKey: 'nav.matches', tooltipKey: 'navTooltip.matches', icon: NAV_ICONS.matches },
  { path: '/conectar', labelKey: 'nav.connect', tooltipKey: 'navTooltip.connect', icon: NAV_ICONS.connect },
  { path: '/ao-vivo', labelKey: 'nav.live', tooltipKey: 'navTooltip.live', icon: NAV_ICONS.live },
  { path: '/cstv', labelKey: 'nav.cstv', tooltipKey: 'navTooltip.cstv', icon: NAV_ICONS.cstv },
  { path: '/modosdejogo', labelKey: 'nav.modes', tooltipKey: 'navTooltip.modes', icon: NAV_ICONS.modes },
  { path: '/duelo', labelKey: 'nav.duel', tooltipKey: 'navTooltip.duel', icon: NAV_ICONS.duel },
  { path: '/admin', labelKey: 'nav.admin', tooltipKey: 'navTooltip.admin', icon: NAV_ICONS.admin, adminOnly: true },
  { path: '/servidores', labelKey: 'nav.servers', tooltipKey: 'navTooltip.servers', icon: NAV_ICONS.servers, adminOnly: true },
  { path: '/usuarios', labelKey: 'nav.users', tooltipKey: 'navTooltip.users', icon: NAV_ICONS.users, adminOnly: true },
  { path: '/sistema', labelKey: 'nav.system', tooltipKey: 'navTooltip.system', icon: NAV_ICONS.system, adminOnly: true }
]

// Diz se um item da nav deve ficar ativo dado o pathname atual.
// Subpáginas de detalhe não têm entrada própria na nav; mapeamos
// /jogador/*, /mapa/* e /partida/* para os itens de listagem correlatos.
function isNavItemActive(item, currentPath) {
  if (item.path === currentPath) return true
  if (currentPath.startsWith(item.path + '/')) return true
  if (currentPath.startsWith('/jogador/') && item.path === '/ranking') return true
  if (currentPath.startsWith('/mapa/') && item.path === '/mapas') return true
  if (currentPath.startsWith('/partida/') && item.path === '/partidas') return true
  return false
}

function renderPageNav() {
  const containers = document.querySelectorAll('.page-nav')
  if (!containers.length) return

  const currentPath = window.location.pathname

  containers.forEach((container) => {
    container.innerHTML = ''

    const row = document.createElement('div')
    row.className = 'page-nav-row'

    pageNavItems
      .filter((item) => !item.adminOnly || isActiveAdmin(currentUser))
      .forEach((item) => {
        const link = document.createElement('a')
        link.href = item.path
        if (item.icon) {
          const iconSpan = document.createElement('span')
          iconSpan.className = 'nav-icon'
          iconSpan.innerHTML = item.icon
          link.appendChild(iconSpan)
        }

        const tooltip = i18nUtils.t(item.tooltipKey)
        link.dataset.tooltip = tooltip
        if (window.matchMedia('(hover: none)').matches) {
          link.title = tooltip
        }

        if (isNavItemActive(item, currentPath)) {
          link.classList.add('active')
          link.setAttribute('aria-current', 'page')
        }

        row.appendChild(link)
      })

    container.appendChild(row)
  })
}

function renderLanguageToggle() {
  const topbar = document.querySelector('.page-topbar')
  if (!topbar) return

  const slot = topbar.querySelector('.lang-toggle-slot')
  if (!slot) return

  slot.innerHTML = ''
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'lang-toggle'
  btn.setAttribute('aria-label', i18nUtils.t('nav.langToggle'))
  btn.setAttribute('aria-pressed', i18nUtils.currentLang === 'pt' ? 'true' : 'false')
  btn.innerHTML = i18nUtils.getToggleHtml()
  btn.onclick = () => {
    i18nUtils.setLang(i18nUtils.currentLang === 'pt' ? 'en' : 'pt')
    renderPageNav()
    renderLanguageToggle()
    renderAuthBadge()
    applyActiveNav()
    initServerSelector()
  }
  slot.appendChild(btn)
}

function createSkeletonRow(columns = 4) {
  const row = document.createElement('tr')
  row.className = 'skeleton-row'

  for (let i = 0; i < columns; i += 1) {
    const td = document.createElement('td')
    td.className = 'skeleton-cell'
    td.innerHTML = '<div class="skeleton-box"></div>'
    row.appendChild(td)
  }

  return row
}

function showSkeletonRows(tbody, columns = 4, rows = 4) {
  if (!tbody) return
  tbody.innerHTML = ''
  for (let i = 0; i < rows; i += 1) {
    tbody.appendChild(createSkeletonRow(columns))
  }
}

function showEmptyRow(table, columns = 6, text) {
  if (!table) return
  const emptyText = text || i18nUtils.t('labels.noData')
  table.innerHTML = `\n    <tr class="empty-row">\n      <td colspan="${columns}">${escapeHtml(emptyText)}</td>\n    </tr>\n  `
}

function showErrorRow(table, columns = 6, text, onRetry) {
  if (!table) return
  const errorText = text || (window.i18nUtils ? i18nUtils.t('errors.generic') : 'Erro ao carregar dados')
  table.innerHTML = ''

  const tr = document.createElement('tr')
  tr.className = 'error-row'

  const td = document.createElement('td')
  td.colSpan = columns
  td.className = 'error-cell'

  const span = document.createElement('span')
  span.className = 'error-text'
  span.textContent = `⚠️ ${errorText}`
  td.appendChild(span)

  if (typeof onRetry === 'function') {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn-retry'
    btn.textContent = `🔄 ${window.i18nUtils ? i18nUtils.t('actions.retry') || 'Tentar novamente' : 'Tentar novamente'}`
    btn.onclick = () => {
      showSkeletonRows(table, columns, 4)
      onRetry()
    }
    td.appendChild(btn)
  }

  tr.appendChild(td)
  table.appendChild(tr)
}

// Re-renderiza uma tabela a partir de um array de linhas. Cada item passa por
// `renderRow(item, index)` que deve retornar um <tr> (ou null para pular).
function renderRows(table, rows, renderRow) {
  if (!table) return
  const fragment = document.createDocumentFragment()
  rows.forEach((row, index) => {
    const tr = renderRow(row, index)
    if (tr) fragment.appendChild(tr)
  })
  table.innerHTML = ''
  table.appendChild(fragment)
}

function applyActiveNav() {
  const links = Array.from(document.querySelectorAll('.page-nav a'))
  if (!links.length) return

  const currentPath = window.location.pathname
  links.forEach((link) => {
    const href = link.getAttribute('href')
    if (!href) return

    const item = pageNavItems.find((i) => i.path === href)
    const active = item ? isNavItemActive(item, currentPath) : false
    link.classList.toggle('active', active)
    if (active) {
      link.setAttribute('aria-current', 'page')
    } else {
      link.removeAttribute('aria-current')
    }
  })
}

function formatDateYmdToDmy(value) {
  if (!value) return '-'
  const [year, month, day] = value.substring(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function animateTableUpdate(table) {
  if (!table) return
  const scrollLockEl = table.closest('.scoreboard-team')
  if (scrollLockEl) scrollLockEl.classList.add('table-update-scroll-lock')
  table.classList.add('table-updated')
  window.setTimeout(() => {
    table.classList.remove('table-updated')
    if (scrollLockEl) scrollLockEl.classList.remove('table-update-scroll-lock')
  }, 350)
}

function setServerStatusElement(element, online) {
  if (!element) return
  element.innerText = online ? i18nUtils.t('status.online') : i18nUtils.t('status.offline')
  element.classList.toggle('server-status-online', online)
  element.classList.toggle('server-status-offline', !online)
}

function exportTableCsv(table, filename) {
  if (!table) return

  const rows = Array.from(table.querySelectorAll('tr'))
  if (!rows.length) return

  const csvLines = rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('th, td'))
    return cells.map((cell) => {
      const text = cell.textContent.trim().replace(/[#→\s]+$/g, '').replace(/^[#→\s]+/g, '')
      return `"${text.replace(/"/g, '""')}"`
    }).join(',')
  })

  const csv = '\uFEFF' + csvLines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function isMobileDevice() {
  return window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches
}

// Guard de mobile para o espectador (CSTV/WebRTC): não funciona em celulares/
// tablets. Esconde o botão/iframe ANTES do initWatchLink montar as URLs (evita
// até o iframe baixar o valve.zip) e, na página /cstv, redireciona pro Live Match.
let watchMobileBlocked = false
function initWatchMobileGuard() {
  if (!isMobileDevice()) return

  document.querySelectorAll('[data-watch-link]').forEach((el) => {
    el.hidden = true
    el.removeAttribute('href')
  })
  const frame = document.querySelector('[data-spectator-frame]')
  if (frame) {
    frame.removeAttribute('src')
    frame.style.display = 'none'
  }

  let message = i18nUtils.t('server.watchMobileUnsupported')
  if (window.location.pathname === '/cstv') {
    message += ' ' + i18nUtils.t('cstv.mobileRedirecting')
  }
  setStatus(message, 'warning')

  if (window.location.pathname === '/cstv') {
    window.setTimeout(() => { window.location.replace('/ao-vivo') }, 3000)
  }

  watchMobileBlocked = true
}

function initWatchLink() {
  const apply = async () => {
    if (watchMobileBlocked) return
    const applyOne = async (el) => {
      // data-watch-server força um servidor (ex.: página "Conectar", fixa no main).
      const url = await spectatorUrlFor(el.dataset.watchServer || getSelectedServer())
      if (url) {
        el.href = url
        el.hidden = false
      } else {
        el.removeAttribute('href')
        el.hidden = true
      }
    }
    document.querySelectorAll('[data-watch-link]').forEach(applyOne)
    const frame = document.querySelector('[data-spectator-frame]')
    if (frame) {
      const url = await spectatorUrlFor(frame.dataset.watchServer || getSelectedServer())
      if (url) {
        frame.src = url
        frame.hidden = false
      } else {
        frame.removeAttribute('src')
        frame.hidden = true
      }
    }
  }

  apply()
  document.addEventListener('server-change', apply)
}

function initSkipLink() {
  if (document.getElementById('skip-link')) return

  const link = document.createElement('a')
  link.id = 'skip-link'
  link.className = 'skip-link'
  link.href = '#main-content'
  link.textContent = i18nUtils.t('nav.skipToContent')
  document.body.insertBefore(link, document.body.firstChild)

  const main = document.querySelector('.container')
  if (main) {
    if (!main.id) main.id = 'main-content'
    main.setAttribute('role', 'main')
  }
}

async function initCommon() {
  document.title = '🎮 CS 1.6 Server Stats'
  i18nUtils.init()
  await authSessionPromise
  initSkipLink()
  document.querySelectorAll('.status-message').forEach((el) => el.setAttribute('aria-live', 'polite'))
  document.querySelectorAll('table th').forEach((th) => th.setAttribute('scope', 'col'))
  renderPageNav()
  renderTopbar()
  renderLanguageToggle()
  renderAuthBadge()
  applyActiveNav()
  guardPage()
  initConnectPage()
  initConnectServersTable()
  initWatchMobileGuard()
  initWatchLink()
  initServerSelector()
}

function initConnectPage() {
  if (!document.querySelector('[data-connect-host]')) return

  const fullAddress = `${SERVER_HOST}:${SERVER_PORT}`

  document.querySelectorAll('[data-connect-host]').forEach((el) => { el.textContent = SERVER_HOST })
  document.querySelectorAll('[data-connect-port]').forEach((el) => { el.textContent = SERVER_PORT })
  document.querySelectorAll('[data-connect-address]').forEach((el) => { el.textContent = fullAddress })
  document.querySelectorAll('[data-connect-command]').forEach((el) => { el.textContent = `connect ${fullAddress}` })

  const copyBtn = document.querySelector('[data-copy-command]')
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`connect ${fullAddress}`)
        copyBtn.textContent = i18nUtils.t('server.copied')
      } catch (err) {
        copyBtn.textContent = i18nUtils.t('server.copyError')
      }
      window.setTimeout(() => { copyBtn.textContent = i18nUtils.t('server.copy') }, 2000)
    })
  }
}

async function initConnectServersTable() {
  const tbody = document.getElementById('connectServersBody')
  if (!tbody) return

  try {
    const servers = await loadServersList()
    if (!Array.isArray(servers) || servers.length === 0) return

    servers.forEach((srv) => {
      const row = document.createElement('tr')
      const online = srv.online
      row.innerHTML = `
        <td>${escapeHtml(srv.name)}</td>
        <td>${escapeHtml(String(srv.hostPort ?? srv.port))}</td>
        <td>${escapeHtml(srv.map)}</td>
        <td>${srv.players}/${srv.maxplayers}</td>
        <td><span class="status-pill ${online ? 'status-ok' : 'status-error'}">${i18nUtils.t(online ? 'status.online' : 'status.offline')}</span></td>
      `
      tbody.appendChild(row)
    })
  } catch (err) {
    console.error('Erro ao carregar servidores na página conectar:', err)
  }
}

let searchDebounceTimer = null

// --- Busca com semântica de combobox/listbox (WCAG 4.1.2) ---
const comboboxStates = new WeakMap()

function setupSearchListbox(input, results) {
  const resultsId = results.id || `search-results-${Math.random().toString(36).slice(2, 8)}`
  results.id = resultsId

  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', resultsId)
  input.setAttribute('aria-expanded', 'false')
  results.setAttribute('role', 'listbox')

  let activeIndex = -1

  const options = () => Array.from(results.querySelectorAll('[role="option"]'))

  const setExpanded = (open) => {
    input.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (!open) {
      activeIndex = -1
      input.removeAttribute('aria-activedescendant')
      options().forEach((opt) => opt.removeAttribute('aria-selected'))
    }
  }

  const highlight = (idx) => {
    const opts = options()
    if (!opts.length) return
    activeIndex = (idx + opts.length) % opts.length
    opts.forEach((opt, i) => {
      if (i === activeIndex) opt.setAttribute('aria-selected', 'true')
      else opt.removeAttribute('aria-selected')
    })
    const el = opts[activeIndex]
    input.setAttribute('aria-activedescendant', el.id)
    el.scrollIntoView({ block: 'nearest' })
  }

  const close = () => {
    results.classList.remove('visible')
    setExpanded(false)
  }

  input.addEventListener('keydown', (e) => {
    if (!results.classList.contains('visible')) {
      if (e.key === 'Escape') close()
      return
    }

    const opts = options()

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlight(activeIndex + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlight(activeIndex === -1 ? opts.length - 1 : activeIndex - 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Enter') {
      const target = activeIndex >= 0 ? opts[activeIndex] : opts[0]
      if (target) {
        e.preventDefault()
        target.click()
      }
    }
  })

  input.addEventListener('input', () => {
    if (!results.classList.contains('visible')) setExpanded(false)
  })

  const state = {
    setExpanded,
    close,
    markOptions() {
      const baseId = results.id
      options().forEach((opt, i) => {
        opt.id = `${baseId}-opt-${i}`
        opt.tabIndex = -1
      })
    }
  }
  comboboxStates.set(input, state)
  return state
}

function initPlayerSearch() {
  const nav = document.querySelector('.page-nav')
  if (!nav) return

  const existing = nav.querySelector('.player-search')
  if (existing) {
    const input = existing.querySelector('input')
    if (input) input.placeholder = i18nUtils.t('nav.search')
    return
  }

  const wrap = document.createElement('div')
  wrap.className = 'player-search'

  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = i18nUtils.t('nav.search')
  input.autocomplete = 'off'
  input.setAttribute('data-i18n-aria-label', 'nav.search')
  wrap.appendChild(input)

  const results = document.createElement('div')
  results.className = 'search-results'
  wrap.appendChild(results)

  const combobox = setupSearchListbox(input, results)

  input.addEventListener('input', () => {
    const q = input.value.trim()
    window.clearTimeout(searchDebounceTimer)
    if (!q) {
      combobox.close()
      results.innerHTML = ''
      return
    }
    searchDebounceTimer = window.setTimeout(() => runPlayerSearch(q, results, combobox), 300)
  })

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      combobox.close()
    }
  })

  const utils = nav.querySelector('.page-nav-utils') || nav
  utils.appendChild(wrap)
}

async function runPlayerSearch(q, results, combobox) {
  try {
    const res = await fetchJson(`/player-search?q=${encodeURIComponent(q)}${serverParam()}`)
    results.innerHTML = ''

    if (!res.length) {
      const empty = document.createElement('div')
      empty.className = 'sr-empty'
      empty.textContent = i18nUtils.t('search.noResults')
      results.appendChild(empty)
    } else {
      res.forEach((p) => {
        const link = document.createElement('a')
        link.href = `/jogador/${encodeURIComponent(p.steamid)}`
        link.setAttribute('role', 'option')

        const name = document.createElement('span')
        name.className = 'sr-name'
        name.textContent = p.name || p.steamid

        const meta = document.createElement('span')
        meta.className = 'sr-meta'

        const steam = document.createElement('span')
        steam.className = 'sr-steamid'
        steam.textContent = p.steamid

        const kills = document.createElement('span')
        kills.className = 'sr-kills'
        kills.textContent = `${p.kills} ${i18nUtils.t('labels.kills').toLowerCase()}`

        meta.appendChild(steam)
        meta.appendChild(kills)
        link.appendChild(name)
        link.appendChild(meta)
        results.appendChild(link)
      })
    }

    results.classList.add('visible')
    if (combobox) {
      combobox.markOptions()
      combobox.setExpanded(true)
    }
  } catch (err) {
    results.innerHTML = ''
    const error = document.createElement('div')
    error.className = 'sr-error'
    error.textContent = i18nUtils.t('errors.search')
    results.appendChild(error)
    results.classList.add('visible')
    if (combobox) {
      combobox.markOptions()
      combobox.setExpanded(true)
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCommon)
} else {
  initCommon()
}
