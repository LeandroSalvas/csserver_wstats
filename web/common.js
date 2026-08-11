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

// Endereço público do servidor de jogo — edite aqui (usado na página "Conectar")
const SERVER_HOST = 'zueiracstrike.duckdns.org'
const SERVER_PORT = '27015'

// URL pública do espectador web (WebRTC) — editado aqui
// Exposto via swag em TLS dedicado (zueiracstrike-watch.subdomain.conf)
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

async function loadServersList() {
  return fetchJson('/servers')
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

    let label = selectorLabels.get(select)
    if (!label) {
      label = document.createElement('label')
      label.className = 'server-selector-label'
      if (select.id) label.htmlFor = select.id
      select.parentNode.insertBefore(label, select)
      selectorLabels.set(select, label)
    }
    label.textContent = i18nUtils.t('server.selectServerLabel')

    if (!servers.length) {
      const option = document.createElement('option')
      option.value = ''
      option.textContent = i18nUtils.t('server.primary')
      select.appendChild(option)
      select.disabled = true
      return
    }

    servers.forEach((srv) => {
      const option = document.createElement('option')
      option.value = srv.id
      option.textContent = srv.name
      select.appendChild(option)
    })

    let selected = getSelectedServer()
    if (selected && servers.some((srv) => srv.id === selected)) {
      select.value = selected
    } else {
      // Sem escolha válida: exibe o servidor primário sem persistir (evita
      // gravar um default silencioso no localStorage) e limpa seleção inválida.
      if (selected) setSelectedServer('')
      select.value = servers[0].id
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

const pageNavItems = [
  { path: '/', labelKey: 'nav.home' },
  { path: '/mapas', labelKey: 'nav.maps' },
  { path: '/ranking', labelKey: 'nav.rankings' },
  { path: '/avancadas', labelKey: 'nav.advanced' },
  { path: '/partidas', labelKey: 'nav.matches' },
  { path: '/conectar', labelKey: 'nav.connect' },
  { path: '/ao-vivo', labelKey: 'nav.live' },
  { path: '/cstv', labelKey: 'nav.cstv' },
  { path: '/duelo', labelKey: 'nav.duel' },
  { path: '/admin', labelKey: 'nav.admin' },
  { path: '/sistema', labelKey: 'nav.system' }
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

    pageNavItems.forEach((item) => {
      const link = document.createElement('a')
      link.href = item.path
      link.textContent = i18nUtils.t(item.labelKey)

      if (isNavItemActive(item, currentPath)) {
        link.classList.add('active')
        link.setAttribute('aria-current', 'page')
      }

      container.appendChild(link)
    })
  })
}

function renderLanguageToggle() {
  const slots = document.querySelectorAll('.lang-toggle-slot')
  slots.forEach((slot) => {
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
      applyActiveNav()
      initPlayerSearch()
      initServerSelector()
    }
    slot.appendChild(btn)
  })
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

function initWatchLink() {
  document.querySelectorAll('[data-watch-link]').forEach((el) => {
    el.href = SPECTATOR_URL
  })
  document.querySelectorAll('[data-spectator-frame]').forEach((el) => {
    el.src = SPECTATOR_URL
  })
}

function initCommon() {
  i18nUtils.init()
  document.querySelectorAll('.status-message').forEach((el) => el.setAttribute('aria-live', 'polite'))
  document.querySelectorAll('table th').forEach((th) => th.setAttribute('scope', 'col'))
  renderPageNav()
  renderLanguageToggle()
  applyActiveNav()
  initConnectPage()
  initWatchLink()
  initPlayerSearch()
  initServerSelector()
}

function initConnectPage() {
  if (!document.querySelector('[data-connect-host]')) return

  const fullAddress = `${SERVER_HOST}:${SERVER_PORT}`

  document.querySelectorAll('[data-connect-host]').forEach((el) => { el.textContent = SERVER_HOST })
  document.querySelectorAll('[data-connect-port]').forEach((el) => { el.textContent = SERVER_PORT })
  document.querySelectorAll('[data-connect-address]').forEach((el) => { el.textContent = fullAddress })
  document.querySelectorAll('[data-connect-command]').forEach((el) => { el.textContent = `connect ${fullAddress}` })

  const steamLink = document.querySelector('[data-connect-steam]')
  if (steamLink) {
    steamLink.href = `steam://rungameid/10//%2Bconnect%20${encodeURIComponent(fullAddress)}`
  }

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

let searchDebounceTimer = null

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

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector('a')
      if (first) window.location.href = first.getAttribute('href')
    }
  })

  input.addEventListener('input', () => {
    const q = input.value.trim()
    window.clearTimeout(searchDebounceTimer)
    if (!q) {
      results.classList.remove('visible')
      results.innerHTML = ''
      return
    }
    searchDebounceTimer = window.setTimeout(() => runPlayerSearch(q, results), 300)
  })

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      results.classList.remove('visible')
    }
  })

  nav.appendChild(wrap)
}

async function runPlayerSearch(q, results) {
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
  } catch (err) {
    results.innerHTML = ''
    const error = document.createElement('div')
    error.className = 'sr-error'
    error.textContent = i18nUtils.t('errors.search')
    results.appendChild(error)
    results.classList.add('visible')
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCommon)
} else {
  initCommon()
}
