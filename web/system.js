async function loadSystemPageStatus() {
  try {
    setStatus(i18nUtils.t('status.updatingSystem'))

    const health = await fetchJson('/health')
    const apiLabel = health.status === 'ok'
      ? 'Online'
      : health.status === 'degraded'
        ? 'Degradado'
        : 'Offline'

    setStatusChip('systemApi', apiLabel)
    setStatusChip('systemDb', health.db === 'ok' ? 'Online' : 'Offline')

    if (typeof health.redis !== 'undefined') {
      setStatusChip('systemRedis', health.redis === 'ok' ? 'Online' : 'Offline')
    } else {
      setStatusChip('systemRedis', 'Não usado')
    }

    try {
      const server = await fetchJson('/server')
      const serverOnline = server.hostname && server.hostname.toLowerCase() !== 'offline'
      setStatusChip('systemCs', serverOnline ? 'Online' : 'Offline')
    } catch (err) {
      setStatusChip('systemCs', 'Offline')
    }

    loadServersTable()
    loadAlertsList()

    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar status do sistema:', err)
    setStatusChip('systemApi', 'Offline')
    setStatusChip('systemDb', 'Offline')
    setStatusChip('systemRedis', 'Offline')
    setStatusChip('systemCs', 'Offline')
    setStatus(`${i18nUtils.t('errors.loadSystem')}: ${err.message}`, 'error')
  }
}

let serverNameById = {}

async function ensureServerNames() {
  if (Object.keys(serverNameById).length) return
  try {
    const servers = await fetchJson('/servers')
    servers.forEach((srv) => { serverNameById[srv.id] = srv.name })
  } catch (err) {
    console.error('Erro ao carregar nomes de servidores:', err)
  }
}

async function loadServersTable() {
  const tbody = document.getElementById('serversTable')
  if (!tbody) return

  try {
    const servers = await fetchJson('/servers')
    tbody.innerHTML = ''

    serverNameById = {}
    servers.forEach((srv) => { serverNameById[srv.id] = srv.name })

    if (!Array.isArray(servers) || servers.length === 0) {
      showEmptyRow(tbody, 6, i18nUtils.t('labels.noData'))
      return
    }

    servers.forEach((srv) => {
      const row = document.createElement('tr')
      const online = srv.online
      row.innerHTML = `
        <td>${escapeHtml(srv.name)}</td>
        <td>${escapeHtml(srv.host)}</td>
        <td>${escapeHtml(String(srv.hostPort ?? srv.port))}</td>
        <td>${escapeHtml(srv.map)}</td>
        <td>${srv.players}/${srv.maxplayers}</td>
        <td><span class="status-pill ${online ? 'status-ok' : 'status-error'}">${i18nUtils.t(online ? 'status.online' : 'status.offline')}</span></td>
      `
      tbody.appendChild(row)
    })
  } catch (err) {
    console.error('Erro ao carregar servidores:', err)
  }
}

async function loadAlertsList() {
  const list = document.getElementById('alertsList')
  if (!list) return

  try {
    const alerts = await fetchJson('/alerts')
    await ensureServerNames()
    list.innerHTML = ''

    const enabledNote = document.createElement('li')
    enabledNote.innerHTML = `
      <span class="status-pill ${alerts.configured ? 'status-ok' : 'status-pending'}">
        ${i18nUtils.t(alerts.configured ? 'system.webhookConfigured' : 'system.webhookNotConfigured')}
      </span>
    `
    list.appendChild(enabledNote)

    if (!Array.isArray(alerts.events) || alerts.events.length === 0) {
      const empty = document.createElement('li')
      empty.textContent = i18nUtils.t('system.noAlerts')
      list.appendChild(empty)
      return
    }

    alerts.events.slice().reverse().forEach((event) => {
      const li = document.createElement('li')
      const online = event.type === 'online'
      const serverName = serverNameById[event.serverId] || event.serverId || ''
      li.innerHTML = `
        <span class="alert-badge ${online ? 'alert-badge-online' : 'alert-badge-offline'}">
          ${i18nUtils.t(online ? 'status.online' : 'status.offline')}
        </span>
        ${serverName ? `<span class="alert-server">${escapeHtml(serverName)}</span>` : ''}
        <span class="alert-time">${formatAlertDate(event.at)}</span>
      `
      list.appendChild(li)
    })
  } catch (err) {
    console.error('Erro ao carregar alertas:', err)
  }
}

function formatAlertDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(i18nUtils.currentLang === 'pt' ? 'pt-BR' : 'en-GB')
}

function refreshSystemPage() {
  if (document.hidden) return
  loadSystemPageStatus()
}

let systemFocusDebounceTimer = null
window.addEventListener('focus', () => {
  if (systemFocusDebounceTimer) clearTimeout(systemFocusDebounceTimer)
  systemFocusDebounceTimer = setTimeout(refreshSystemPage, 500)
})
setInterval(refreshSystemPage, 15000)

document.addEventListener('DOMContentLoaded', loadSystemPageStatus)
