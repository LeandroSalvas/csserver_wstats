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

// app.js helper block
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

  const normalized = value === 'Online' || value === 'OK'
    ? 'status-ok'
    : value === 'Aguardando' || value === 'Não usado'
      ? 'status-pending'
      : 'status-error'

  element.innerText = value
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
  { href: 'index.html', label: '🏠 Home' },
  { href: 'maps.html', label: '🗺️ Ver ranking por mapa' },
  { href: 'rankings.html', label: '🏆 Rankings' },
  { href: 'advanced.html', label: '📈 Avançadas' },
  { href: 'connect.html', label: '🔗 Conectar' },
  { href: 'live.html', label: '📡 Live Match' },
  { href: 'admin.html', label: '🛠️ Painel RCON' },
  { href: 'system.html', label: '🛡️ Sistema' }
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
      link.textContent = item.label

      if (item.href.split('/').pop() === currentPage) {
        link.classList.add('active')
        link.style.display = 'none'
      }

      container.appendChild(link)
    })
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

function showEmptyRow(table, columns = 6, text = 'Nenhum dado disponível') {
  if (!table) return
  table.innerHTML = `\n    <tr class="empty-row">\n      <td colspan="${columns}">${text}</td>\n    </tr>\n  `
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
  element.innerText = online ? 'Online' : 'Offline'
  element.classList.toggle('server-status-online', online)
  element.classList.toggle('server-status-offline', !online)
}

/* Execução imediata para renderizar e aplicar navegação ativa quando o DOM estiver pronto */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    renderPageNav()
    applyActiveNav()
  })
} else {
  renderPageNav()
  applyActiveNav()
}
