const params = new URLSearchParams(window.location.search)
let steamA = params.get('p') || ''
let steamB = params.get('q') || ''
const serverFromUrl = params.get('server')
if (serverFromUrl) setSelectedServer(serverFromUrl)

// Valida o servidor vindo da URL contra a lista real; se for desconhecido,
// remove a seleção para a página carregar dados do servidor primário/todos.
const serverParamValidated = (async () => {
  if (!serverFromUrl) return
  try {
    const servers = await loadServersList()
    if (Array.isArray(servers) && !servers.some((srv) => srv.id === serverFromUrl)) {
      setSelectedServer('')
    }
  } catch (err) {
    // Lista indisponível (API offline): mantém o valor da URL.
  }
})()

const chartInstances = {}
const duelPlayers = { a: null, b: null }

const SIDE_CONFIG = {
  a: { inputId: 'duelSearchA', resultsId: 'duelResultsA', cardId: 'duelCardA', headerId: 'duelHeaderA' },
  b: { inputId: 'duelSearchB', resultsId: 'duelResultsB', cardId: 'duelCardB', headerId: 'duelHeaderB' }
}

function formatHours(seconds) {
  const total = Number(seconds) || 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function pct(a, b) {
  const denom = Number(b) || 0
  if (!denom) return 0
  return (Number(a) || 0) / denom * 100
}

function pctStr(a, b) {
  return `${pct(a, b).toFixed(1)}%`
}

function kdRatio(p) {
  return ((p.kills || 0) / ((p.deaths || 0) || 1)).toFixed(2)
}

function updateUrl() {
  const url = new URL(window.location.href)
  if (steamA) url.searchParams.set('p', steamA)
  else url.searchParams.delete('p')
  if (steamB) url.searchParams.set('q', steamB)
  else url.searchParams.delete('q')
  const server = getSelectedServer()
  if (server) url.searchParams.set('server', server)
  else url.searchParams.delete('server')
  window.history.replaceState(null, '', url.toString())
}

function renderSideCard(side) {
  const cfg = SIDE_CONFIG[side]
  const card = document.getElementById(cfg.cardId)
  const p = duelPlayers[side]
  const header = document.getElementById(cfg.headerId)

  if (!p) {
    card.className = 'duel-player-card duel-empty'
    card.innerHTML = `<div class="duel-empty-text">${escapeHtml(i18nUtils.t('duel.pickPlayer'))}</div>`
    if (header) header.textContent = i18nUtils.t(`duel.player${side === 'a' ? 'A' : 'B'}`)
    return
  }

  card.className = 'duel-player-card'
  card.innerHTML = `
    <div class="duel-player-name">${escapeHtml(p.name || p.steamid)}</div>
    <div class="duel-player-steamid">${escapeHtml(p.steamid || '-')}</div>
    <div class="duel-player-rank" data-side="${side}"></div>
    <div class="duel-player-meta">
      <div><span>${i18nUtils.t('labels.kd')}</span><strong>${kdRatio(p)}</strong></div>
      <div><span>${i18nUtils.t('labels.skill')}</span><strong>${p.skill ?? 0}</strong></div>
      <div><span>${i18nUtils.t('labels.accuracy')}</span><strong>${pctStr(p.hs, p.kills)}</strong></div>
    </div>
    <a class="duel-player-link" href="/jogador/${encodeURIComponent(p.steamid)}">${i18nUtils.t('labels.viewFullRanking')} →</a>
  `

  if (header) header.textContent = p.name || p.steamid
}

async function loadRankBadge(side) {
  const p = duelPlayers[side]
  if (!p) return

  const slot = document.querySelector(`#duelCard${side === 'a' ? 'A' : 'B'} .duel-player-rank`)
  if (!slot) return

  try {
    const history = await fetchJson(`/player-rank-history/${encodeURIComponent(p.steamid)}${serverQuery()}`)
    const last = Array.isArray(history) && history.length ? history[history.length - 1] : null
    if (last && last.position) {
      slot.textContent = `#${last.position}${last.total_players ? ` / ${last.total_players}` : ''}`
      slot.classList.add('visible')
    }
  } catch (err) {
    // Ranking indisponível: badge fica oculto.
  }
}

function buildCompareRows() {
  const a = duelPlayers.a
  const b = duelPlayers.b

  const roundsA = (a.roundt || 0) + (a.roundct || 0)
  const roundsB = (b.roundt || 0) + (b.roundct || 0)
  const winsA = (a.wint || 0) + (a.winct || 0)
  const winsB = (b.wint || 0) + (b.winct || 0)

  return [
    { key: 'kills', labelKey: 'labels.kills', valueA: a.kills ?? 0, valueB: b.kills ?? 0, higherBetter: true },
    { key: 'deaths', labelKey: 'labels.deaths', valueA: a.deaths ?? 0, valueB: b.deaths ?? 0, higherBetter: false },
    { key: 'hs', labelKey: 'labels.hs', valueA: a.hs ?? 0, valueB: b.hs ?? 0, higherBetter: true },
    { key: 'hsRate', labelKey: 'labels.accuracy', valueA: pct(a.hs, a.kills), valueB: pct(b.hs, b.kills), format: pctFmt, higherBetter: true },
    { key: 'kd', labelKey: 'labels.kd', valueA: Number(kdRatio(a)), valueB: Number(kdRatio(b)), format: (v) => v.toFixed(2), higherBetter: true },
    { key: 'skill', labelKey: 'labels.skill', valueA: a.skill ?? 0, valueB: b.skill ?? 0, higherBetter: true },
    { key: 'assists', labelKey: 'labels.assists', valueA: a.assists ?? 0, valueB: b.assists ?? 0, higherBetter: true },
    { key: 'dmg', labelKey: 'labels.damage', valueA: a.dmg ?? 0, valueB: b.dmg ?? 0, higherBetter: true },
    { key: 'tk', labelKey: 'labels.tk', valueA: a.tks ?? 0, valueB: b.tks ?? 0, higherBetter: false },
    { key: 'rounds', labelKey: 'labels.rounds', valueA: roundsA, valueB: roundsB, higherBetter: true },
    { key: 'winrate', labelKey: 'labels.winrate', valueA: pct(winsA, roundsA), valueB: pct(winsB, roundsB), format: pctFmt, higherBetter: true },
    { key: 'winrateT', labelKey: 'labels.winrateT', valueA: pct(a.wint, a.roundt), valueB: pct(b.wint, b.roundt), format: pctFmt, higherBetter: true },
    { key: 'winrateCT', labelKey: 'labels.winrateCT', valueA: pct(a.winct, a.roundct), valueB: pct(b.winct, b.roundct), format: pctFmt, higherBetter: true },
    { key: 'bombplants', labelKey: 'labels.bombPlants', valueA: a.bombplants ?? 0, valueB: b.bombplants ?? 0, higherBetter: true },
    { key: 'bombdefused', labelKey: 'labels.bombDefused', valueA: a.bombdefused ?? 0, valueB: b.bombdefused ?? 0, higherBetter: true },
    { key: 'hours', labelKey: 'labels.hoursPlayed', valueA: a.connection_time ?? 0, valueB: b.connection_time ?? 0, format: formatHours, higherBetter: true }
  ]
}

function pctFmt(v) {
  return `${v.toFixed(1)}%`
}

function cellText(row, side) {
  const raw = row[`value${side === 'a' ? 'A' : 'B'}`]
  if (row.format) return row.format(raw)
  return Number(raw).toLocaleString('pt-BR')
}

function renderCompareTable() {
  const rows = buildCompareRows()
  const tbody = document.getElementById('duelTable')
  tbody.innerHTML = ''

  const fragment = document.createDocumentFragment()

  rows.forEach((row) => {
    const tr = document.createElement('tr')

    const label = document.createElement('td')
    label.textContent = i18nUtils.t(row.labelKey)
    tr.appendChild(label)

    const valueA = row.valueA
    const valueB = row.valueB

    const cellA = document.createElement('td')
    const cellB = document.createElement('td')
    cellA.textContent = cellText(row, 'a')
    cellB.textContent = cellText(row, 'b')

    if (valueA !== valueB) {
      const aWins = row.higherBetter ? valueA > valueB : valueA < valueB
      cellA.classList.add(aWins ? 'duel-win' : 'duel-lose')
      cellB.classList.add(aWins ? 'duel-lose' : 'duel-win')
    }

    tr.appendChild(cellA)
    tr.appendChild(cellB)
    fragment.appendChild(tr)
  })

  tbody.appendChild(fragment)
  animateTableUpdate(tbody)
}

function renderDuelChart() {
  const a = duelPlayers.a
  const b = duelPlayers.b
  const canvas = document.getElementById('duelChart')
  if (!canvas) return

  if (chartInstances.duelChart) {
    chartInstances.duelChart.destroy()
    chartInstances.duelChart = null
  }

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js não carregado para duelChart')
    const parent = canvas.parentElement
    const fallback = document.createElement('div')
    fallback.className = 'chart-fallback'
    fallback.textContent = i18nUtils.t('player.chartUnavailable')
    canvas.remove()
    parent.appendChild(fallback)
    return
  }

  const labels = [
    i18nUtils.t('labels.kills'),
    i18nUtils.t('labels.deaths'),
    i18nUtils.t('labels.hs'),
    i18nUtils.t('labels.assists'),
    i18nUtils.t('labels.damage')
  ]

  chartInstances.duelChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: a.name || a.steamid,
          data: [a.kills ?? 0, a.deaths ?? 0, a.hs ?? 0, a.assists ?? 0, a.dmg ?? 0],
          backgroundColor: 'rgba(251,146,60,0.75)',
          borderColor: '#fb923c',
          borderWidth: 1
        },
        {
          label: b.name || b.steamid,
          data: [b.kills ?? 0, b.deaths ?? 0, b.hs ?? 0, b.assists ?? 0, b.dmg ?? 0],
          backgroundColor: 'rgba(52,211,153,0.75)',
          borderColor: '#34d399',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          labels: { color: '#e5e7eb' }
        }
      },
      scales: {
        x: {
          ticks: { color: '#e5e7eb' },
          grid: { color: 'rgba(229, 231, 235, 0.08)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#e5e7eb' },
          grid: { color: 'rgba(229, 231, 235, 0.08)' }
        }
      }
    }
  })
}

async function loadSidePlayer(side, steamid) {
  const res = await fetchJson(`/player/${encodeURIComponent(steamid)}${serverQuery()}`)
  if (!res) throw new Error(i18nUtils.t('errors.playerNotFound'))
  duelPlayers[side] = res
  renderSideCard(side)
  await loadRankBadge(side)
}

async function loadDuel() {
  const hasA = !!steamA
  const hasB = !!steamB
  const compareSection = document.getElementById('duelCompareSection')
  const tableSection = document.getElementById('duelTableSection')
  const copyBtn = document.getElementById('duelCopyLink')

  duelPlayers.a = null
  duelPlayers.b = null
  renderSideCard('a')
  renderSideCard('b')

  copyBtn.disabled = !(hasA && hasB)
  compareSection.hidden = true
  tableSection.hidden = true

  if (!hasA && !hasB) {
    setStatus(i18nUtils.t('duel.empty'), 'info')
    return
  }

  setStatus(i18nUtils.t('status.loadingPlayer'))

  try {
    if (hasA && hasB) {
      await Promise.all([loadSidePlayer('a', steamA), loadSidePlayer('b', steamB)])
      clearStatus()
      renderCompareTable()
      renderDuelChart()
      compareSection.hidden = false
      tableSection.hidden = false
    } else if (hasA) {
      await loadSidePlayer('a', steamA)
      clearStatus()
      setStatus(i18nUtils.t('duel.empty'), 'info')
    } else {
      await loadSidePlayer('b', steamB)
      clearStatus()
      setStatus(i18nUtils.t('duel.empty'), 'info')
    }
  } catch (err) {
    console.error('Erro ao carregar duelo:', err)
    setStatus(`${i18nUtils.t('errors.loadPlayer')}: ${err.message}`, 'error')
  }
}

let sideSearchDebounce = null

function initSideSearch(side) {
  const cfg = SIDE_CONFIG[side]
  const input = document.getElementById(cfg.inputId)
  const results = document.getElementById(cfg.resultsId)

  input.placeholder = i18nUtils.t(`duel.search${side === 'a' ? 'A' : 'B'}`)

  input.addEventListener('input', () => {
    const q = input.value.trim()
    window.clearTimeout(sideSearchDebounce)
    if (!q) {
      results.classList.remove('visible')
      results.innerHTML = ''
      return
    }
    sideSearchDebounce = window.setTimeout(async () => {
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
            const item = document.createElement('a')
            item.href = '#'
            item.addEventListener('click', (e) => {
              e.preventDefault()
              input.value = ''
              results.classList.remove('visible')
              results.innerHTML = ''
              if (side === 'a') steamA = p.steamid
              else steamB = p.steamid
              updateUrl()
              loadDuel()
            })

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
            item.appendChild(name)
            item.appendChild(meta)
            results.appendChild(item)
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
    }, 300)
  })

  document.addEventListener('click', (e) => {
    const wrap = input.closest('.duel-search')
    if (wrap && !wrap.contains(e.target)) {
      results.classList.remove('visible')
    }
  })
}

function initDuelActions() {
  const swapBtn = document.getElementById('duelSwap')
  const copyBtn = document.getElementById('duelCopyLink')

  swapBtn.title = i18nUtils.t('duel.swap')
  swapBtn.textContent = i18nUtils.t('duel.swap')
  copyBtn.textContent = i18nUtils.t('duel.copyLink')

  swapBtn.addEventListener('click', () => {
    if (!steamA && !steamB) return
    const tmp = steamA
    steamA = steamB
    steamB = tmp
    updateUrl()
    loadDuel()
  })

  copyBtn.addEventListener('click', async () => {
    if (!steamA || !steamB) return
    const url = new URL(window.location.href)
    url.searchParams.set('p', steamA)
    url.searchParams.set('q', steamB)
    const server = getSelectedServer()
    if (server) url.searchParams.set('server', server)
    else url.searchParams.delete('server')

    try {
      await navigator.clipboard.writeText(url.toString())
      copyBtn.textContent = i18nUtils.t('duel.copied')
      window.setTimeout(() => {
        copyBtn.textContent = i18nUtils.t('duel.copyLink')
      }, 2000)
    } catch (err) {
      console.error('Erro ao copiar link:', err)
    }
  })
}

try {
  document.addEventListener('DOMContentLoaded', async () => {
    await serverParamValidated
    initSideSearch('a')
    initSideSearch('b')
    initDuelActions()
    loadDuel()
  })
} catch (err) {
  console.error('Erro ao inicializar duelo.js:', err)
}

document.addEventListener('server-change', () => {
  updateUrl()
  loadDuel()
})
