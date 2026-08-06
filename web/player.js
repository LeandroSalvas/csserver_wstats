const params = new URLSearchParams(window.location.search)
const steamid = params.get('steamid')
const serverFromUrl = params.get('server')
if (serverFromUrl) setSelectedServer(serverFromUrl)

const chartInstances = {}

function formatHours(seconds) {
  const total = Number(seconds) || 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatDate(value) {
  if (!value) return '-'
  const cleanDate = String(value).substring(0, 10)
  const [year, month, day] = cleanDate.split('-')
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

async function loadPlayer() {
  const res = await fetchJson(`/player/${encodeURIComponent(steamid)}${serverQuery()}`)
  const p = res

  if (!p) {
    throw new Error(i18nUtils.t('errors.playerNotFound'))
  }

  document.getElementById('playerName').innerText = p.name || '-'
  document.getElementById('steamid').innerText = p.steamid || '-'
  document.getElementById('kills').innerText = p.kills ?? 0
  document.getElementById('deaths').innerText = p.deaths ?? 0
  document.getElementById('hs').innerText = p.hs ?? 0
  document.getElementById('skill').innerText = p.skill ?? 0
  document.getElementById('kd').innerText = ((p.kills || 0) / ((p.deaths || 0) || 1)).toFixed(2)
  document.getElementById('accuracy').innerText = p.hs && p.kills
    ? `${((p.hs / p.kills) * 100).toFixed(2)}%`
    : '0.00%'
  document.getElementById('assists').innerText = p.assists ?? 0
  document.getElementById('tks').innerText = p.tks ?? 0
  document.getElementById('dmg').innerText = p.dmg ?? 0
  document.getElementById('bombplants').innerText = p.bombplants ?? 0
  document.getElementById('bombdefused').innerText = p.bombdefused ?? 0
  document.getElementById('hours').innerText = formatHours(p.connection_time)
  document.getElementById('connects').innerText = p.connects ?? 0
  document.getElementById('firstJoin').innerText = formatDate(p.first_join)
}

async function loadPlayerHistory() {
  const table = document.getElementById('historyTable')
  showSkeletonRows(table, 5, 4)

  const res = await fetchJson(`/player-history-daily/${encodeURIComponent(steamid)}${serverQuery()}`)
  const history = res

  const labels = []
  const killsData = []
  const skillData = []
  const kdData = []

  if (!Array.isArray(history) || history.length === 0) {
    showEmptyRow(table)
    return
  }

  const sorted = Array.from(history).sort((a, b) => (a.day || '').localeCompare(b.day || ''))

  sorted.forEach((row) => {
    const cleanDate = (row.day || '').substring(0, 10)
    const [year, month, day] = cleanDate.split('-')
    const date = `${day}/${month}/${year}`
    labels.push(date)
    killsData.push(row.kills ?? 0)
    skillData.push(row.skill ?? 0)
    kdData.push(Number((row.kills / ((row.deaths || 0) || 1)).toFixed(2)))
  })

  const fragment = document.createDocumentFragment()

  history.forEach((row) => {
    const cleanDate = (row.day || '').substring(0, 10)
    const [year, month, day] = cleanDate.split('-')
    const date = `${day}/${month}/${year}`

    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${date}</td>
      <td>${row.kills ?? 0}</td>
      <td>${row.deaths ?? 0}</td>
      <td>${row.hs ?? 0}</td>
      <td>${row.skill ?? 0}</td>
    `
    fragment.appendChild(tr)
  })

  table.innerHTML = ''
  table.appendChild(fragment)
  animateTableUpdate(table)
  renderChart('killsChart', labels, [
    {
      label: i18nUtils.t('labels.kills'),
      data: killsData,
      borderColor: '#60a5fa',
      backgroundColor: 'rgba(96,165,250,0.24)',
      fill: true
    }
  ])
  renderChart('skillKdChart', labels, [
    {
      label: i18nUtils.t('labels.skill'),
      data: skillData,
      borderColor: '#34d399',
      backgroundColor: 'rgba(52,211,153,0.18)',
      fill: false,
      yAxisID: 'y'
    },
    {
      label: i18nUtils.t('labels.kd'),
      data: kdData,
      borderColor: '#fbbf24',
      backgroundColor: 'rgba(251,191,36,0.15)',
      fill: false,
      yAxisID: 'y1'
    }
  ], {
    y1: {
      position: 'right',
      grid: { drawOnChartArea: false }
    }
  })
}

async function loadRankHistory() {
  const canvas = document.getElementById('rankChart')
  if (!canvas) return

  const res = await fetchJson(`/player-rank-history/${encodeURIComponent(steamid)}${serverQuery()}`)
  const history = res

  if (!Array.isArray(history) || history.length === 0) {
    return
  }

  const labels = history.map((row) => formatDate(row.day))
  const positions = history.map((row) => row.position)
  const totals = history.map((row) => row.total_players)

  renderChart('rankChart', labels, [
    {
      label: i18nUtils.t('labels.position'),
      data: positions,
      borderColor: '#f472b6',
      backgroundColor: 'rgba(244,114,182,0.18)',
      fill: true,
      tension: 0.25
    }
  ], {
    y: {
      reverse: true,
      suggestedMax: Math.max(...totals, 10)
    }
  })
}

async function loadLastMap() {
  const data = await fetchJson(`/player-last-map/${encodeURIComponent(steamid)}${serverQuery()}`)
  document.getElementById('lastMap').innerText = data?.map || '-'
}

async function loadPlayerData() {
  if (!steamid) {
    setStatus(i18nUtils.t('errors.steamidNotProvided'), 'error')
    return
  }

  setStatus(i18nUtils.t('status.loadingPlayer'))

  try {
    await Promise.all([loadPlayer(), loadPlayerHistory(), loadLastMap()])
    await loadRankHistory()
    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar player:', err)
    setStatus(`${i18nUtils.t('errors.loadPlayer')}: ${err.message}`, 'error')
  }
}

function renderChart(canvasId, labels, datasets, extraOptions = {}) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return

  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy()
  }

  if (typeof Chart === 'undefined') {
    console.error('Chart.js não carregado')
    return
  }

  const baseOptions = {
    responsive: true,
    plugins: {
      legend: {
        labels: {
          color: '#e5e7eb'
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#e5e7eb'
        },
        grid: {
          color: 'rgba(229, 231, 235, 0.08)'
        }
      },
      y: {
        ticks: {
          color: '#e5e7eb'
        },
        grid: {
          color: 'rgba(229, 231, 235, 0.08)'
        }
      }
    }
  }

  const scales = Object.keys(extraOptions).length
    ? { ...baseOptions.scales, ...extraOptions }
    : baseOptions.scales

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: {
      ...baseOptions,
      scales
    }
  })
}

try {
  document.addEventListener('DOMContentLoaded', () => {
    loadPlayerData()
  })
} catch (err) {
  console.error('Erro ao inicializar player.js:', err)
}

document.addEventListener('server-change', loadPlayerData)
