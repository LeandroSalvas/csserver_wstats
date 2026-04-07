let top10NeedsLoadingUi = true

async function loadSystemStatus() {
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

    if (health.redis) {
      setStatusChip('systemRedis', health.redis === 'ok' ? 'Online' : 'Offline')
    } else {
      setStatusChip('systemRedis', 'Não usado')
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

function updatePodium(players) {
  const slots = [
    { selector: '#p1', data: players[0] },
    { selector: '#p2', data: players[1] },
    { selector: '#p3', data: players[2] }
  ]

  slots.forEach(({ selector, data }) => {
    const nameEl = document.querySelector(`${selector} .name`)
    const statEl = document.querySelector(`${selector} .stat`)

    if (!nameEl || !statEl) return

    if (data) {
      nameEl.innerText = data.name
      statEl.innerText = `${i18nUtils.t('labels.kills')}: ${data.kills}`
    } else {
      nameEl.innerText = '-'
      statEl.innerText = '-'
    }
  })
}

async function loadTop10() {
  const table = document.getElementById('ranking')

  if (top10NeedsLoadingUi) {
    setStatus(i18nUtils.t('status.loadingRanking'))
    showSkeletonRows(table, 6, 4)
  }

  try {
    const players = await fetchJson('/top10')
    clearStatus()
    top10NeedsLoadingUi = false

    updatePodium(players)

    if (!Array.isArray(players) || players.length === 0) {
      showEmptyRow(table)
      animateTableUpdate(table.closest('table'))
      return
    }

    table.innerHTML = ''
    const fragment = document.createDocumentFragment()

    players.forEach((p, index) => {
      const row = document.createElement('tr')
      row.className = index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : ''
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}">${p.name}</a></td>
        <td>${p.kills}</td>
        <td>${p.deaths}</td>
        <td>${p.kd}</td>
        <td>${p.skill}</td>
      `
      fragment.appendChild(row)
    })

    table.appendChild(fragment)
    animateTableUpdate(table.closest('table'))
  } catch (err) {
    top10NeedsLoadingUi = true
    console.error('Erro ao carregar top10:', err)
    setStatus(`${i18nUtils.t('errors.loadRanking')}: ${err.message}`, 'error')
    showEmptyRow(table, 6, i18nUtils.t('errors.failToLoad'))
    animateTableUpdate(table.closest('table'))
  }
}

async function loadStats() {
  try {
    const s = await fetchJson('/stats')

    document.getElementById('players').innerText = s.players
    document.getElementById('kills').innerText = s.kills
    document.getElementById('maps').innerText = s.maps
  } catch (err) {
    console.error('Erro ao carregar stats:', err)
    setStatus(`${i18nUtils.t('errors.loadFailed')} stats: ${err.message}`, 'error')
  }
}

async function loadServer() {
  try {
    const s = await fetchJson('/server')

    document.getElementById('hostname').innerText = s.hostname
    document.getElementById('currentMap').innerText = s.map
    document.getElementById('playersOnline').innerText = s.players
    document.getElementById('maxPlayers').innerText = s.maxplayers
    setServerStatusElement(document.getElementById('serverStatus'), true)
    setStatusChip('systemCs', 'Online')
  } catch (err) {
    console.error('Erro ao carregar status do servidor:', err)
    setStatus(`${i18nUtils.t('errors.loadServer')}: ${err.message}`, 'error')
    document.getElementById('hostname').innerText = i18nUtils.t('status.offline')
    document.getElementById('currentMap').innerText = '-'
    document.getElementById('playersOnline').innerText = '0'
    document.getElementById('maxPlayers').innerText = '0'
    setServerStatusElement(document.getElementById('serverStatus'), false)
    setStatusChip('systemCs', 'Offline')
  }
}

function refreshAll() {
  if (document.hidden) return
  loadTop10()
  loadStats()
  loadServer()
  loadSystemStatus()
}

window.addEventListener('focus', refreshAll)
setInterval(refreshAll, 15000)

refreshAll()
