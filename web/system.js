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

function refreshSystemPage() {
  if (document.hidden) return
  loadSystemPageStatus()
}

window.addEventListener('focus', refreshSystemPage)
setInterval(refreshSystemPage, 15000)

loadSystemPageStatus()
