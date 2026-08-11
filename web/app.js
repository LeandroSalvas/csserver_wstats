let top10NeedsLoadingUi = true
let lastTop10Signature = ''

async function loadSystemStatus() {
  try {
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
    const players = await fetchJson(`/top10${serverQuery()}`)
    clearStatus()
    top10NeedsLoadingUi = false

    updatePodium(players)

    const signature = Array.isArray(players)
      ? players.map((p) => `${p.steamid}|${p.kills}|${p.deaths}|${p.kd}|${p.skill}`).join(';')
      : 'empty'
    const changed = signature !== lastTop10Signature
    lastTop10Signature = signature

    if (!Array.isArray(players) || players.length === 0) {
      showEmptyRow(table)
      if (changed) animateTableUpdate(table.closest('table'))
      return
    }

    // Sem mudança nos dados: não re-renderiza nem anima a tabela (evita o
    // "flash" da home a cada ciclo de refresh de 15s).
    if (!changed) return

    table.innerHTML = ''
    const fragment = document.createDocumentFragment()

    players.forEach((p, index) => {
      const row = document.createElement('tr')
      row.className = index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : ''
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><a href="/jogador/${encodeURIComponent(p.steamid)}">${escapeHtml(p.name)}</a></td>
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
    lastTop10Signature = ''
    top10NeedsLoadingUi = true
    console.error('Erro ao carregar top10:', err)
    setStatus(`${i18nUtils.t('errors.loadRanking')}: ${err.message}`, 'error')
    showEmptyRow(table, 6, i18nUtils.t('errors.failToLoad'))
    animateTableUpdate(table.closest('table'))
  }
}

async function loadStats() {
  try {
    const s = await fetchJson(`/stats${serverQuery()}`)

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
    const s = await fetchJson(`/server${serverQuery()}`)

    document.getElementById('hostname').innerText = s.hostname
    setCurrentMapLink(s.map)
    document.getElementById('playersOnline').innerText = s.players
    document.getElementById('maxPlayers').innerText = s.maxplayers
    setServerStatusElement(document.getElementById('serverStatus'), true)
    setStatusChip('systemCs', 'Online')
  } catch (err) {
    console.error('Erro ao carregar status do servidor:', err)
    setStatus(`${i18nUtils.t('errors.loadServer')}: ${err.message}`, 'error')
    document.getElementById('hostname').innerText = i18nUtils.t('status.offline')
    setCurrentMapLink(null)
    document.getElementById('playersOnline').innerText = '0'
    document.getElementById('maxPlayers').innerText = '0'
    setServerStatusElement(document.getElementById('serverStatus'), false)
    setStatusChip('systemCs', 'Offline')
  }
}

function formatMatchDuration(seconds) {
  const total = Number(seconds) || 0
  if (total <= 0) return '-'
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}m ${secs}s`
}

function formatMatchDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(i18nUtils.currentLang === 'pt' ? 'pt-BR' : 'en-GB')
}

function lastMatchWinnerLabel(item) {
  if (item.winner === 'T') return '<span class="winner-t">T</span>'
  if (item.winner === 'CT') return '<span class="winner-ct">CT</span>'
  return `<span class="winner-draw">${escapeHtml(i18nUtils.t('matches.draw'))}</span>`
}

async function loadLastMatch() {
  const content = document.getElementById('lastMatchContent')
  const empty = document.getElementById('lastMatchEmpty')
  if (!content || !empty) return

  try {
    const m = await fetchJson(`/matches/latest${serverQuery()}`)

    if (!m) {
      content.hidden = true
      empty.hidden = false
      empty.textContent = i18nUtils.t('match.noMatches')
      return
    }

    empty.hidden = true
    content.hidden = false

    const mapLink = document.getElementById('lastMatchMap')
    mapLink.textContent = m.map
    mapLink.href = `/partida/${m.id}`
    mapLink.title = i18nUtils.t('matches.details')

    document.getElementById('lastMatchT').textContent = m.round_t
    document.getElementById('lastMatchCT').textContent = m.round_ct
    document.getElementById('lastMatchWinner').innerHTML = lastMatchWinnerLabel(m)
    document.getElementById('lastMatchDuration').textContent = formatMatchDuration(m.duration_sec)
    document.getElementById('lastMatchDate').textContent = formatMatchDate(m.ended_at)
    document.getElementById('lastMatchServer').textContent = m.server || 'main'
  } catch (err) {
    console.error('Erro ao carregar última partida:', err)
    content.hidden = true
    empty.hidden = false
    empty.textContent = i18nUtils.t('errors.loadFailed')
  }
}

function setCurrentMapLink(mapName) {
  const link = document.getElementById('currentMapLink')
  if (!link) return
  if (!mapName) {
    link.textContent = '-'
    link.removeAttribute('href')
    return
  }
  link.textContent = mapName
  link.href = `/mapa/${encodeURIComponent(mapName)}`
}

function refreshAll() {
  if (document.hidden) return
  loadTop10()
  loadStats()
  loadServer()
  loadSystemStatus()
  loadLastMatch()
}

let focusDebounceTimer = null
window.addEventListener('focus', () => {
  if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
  focusDebounceTimer = setTimeout(refreshAll, 500)
})
setInterval(refreshAll, 15000)

document.addEventListener('DOMContentLoaded', () => {
  refreshAll()
})

document.addEventListener('server-change', () => {
  lastTop10Signature = ''
  loadTop10()
  loadStats()
  loadServer()
  loadLastMatch()
})
