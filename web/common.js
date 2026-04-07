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
const statusEl = document.getElementById('statusMessage')

function setStatus(message, type = 'info') {
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.className = `status-message visible ${type}`
}

function clearStatus() {
  if (!statusEl) return
  statusEl.textContent = ''
  statusEl.className = 'status-message'
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

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json()
}

const pageNavItems = [
  { href: 'index.html', labelKey: 'nav.home' },
  { href: 'maps.html', labelKey: 'nav.maps' },
  { href: 'rankings.html', labelKey: 'nav.rankings' },
  { href: 'advanced.html', labelKey: 'nav.advanced' },
  { href: 'connect.html', labelKey: 'nav.connect' },
  { href: 'live.html', labelKey: 'nav.live' },
  { href: 'admin.html', labelKey: 'nav.admin' },
  { href: 'system.html', labelKey: 'nav.system' }
]

function renderPageNav() {
  const containers = document.querySelectorAll('.page-nav')
  if (!containers.length) return

  const currentPage = window.location.pathname.split('/').pop() || 'index.html'

  containers.forEach((container) => {
    container.innerHTML = ''

    pageNavItems.forEach((item) => {
      const link = document.createElement('a')
      link.href = item.href
      link.textContent = i18nUtils.t(item.labelKey)

      if (item.href.split('/').pop() === currentPage) {
        link.classList.add('active')
        link.style.display = 'none'
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
    btn.className = 'lang-toggle'
    btn.innerHTML = i18nUtils.getToggleHtml()
    btn.onclick = () => {
      i18nUtils.setLang(i18nUtils.currentLang === 'pt' ? 'en' : 'pt')
      renderPageNav()
      renderLanguageToggle()
      applyActiveNav()
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
  table.innerHTML = `\n    <tr class="empty-row">\n      <td colspan="${columns}">${emptyText}</td>\n    </tr>\n  `
}

function applyActiveNav() {
  const links = Array.from(document.querySelectorAll('.page-nav a'))
  if (!links.length) return

  const currentPage = window.location.pathname.split('/').pop() || 'index.html'
  links.forEach((link) => {
    const href = link.getAttribute('href')
    if (!href) return

    const normalizedHref = href === '' ? 'index.html' : href.split('/').pop()
    if (normalizedHref === currentPage) {
      link.classList.add('active')
      link.style.display = 'none'
    } else {
      link.classList.remove('active')
      link.style.display = ''
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

function initCommon() {
  i18nUtils.init()
  renderPageNav()
  renderLanguageToggle()
  applyActiveNav()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCommon)
} else {
  initCommon()
}
