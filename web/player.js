const params = new URLSearchParams(window.location.search)
const steamid = params.get('steamid')

let chartInstance = null

async function loadPlayer() {
  const res = await fetchJson(`/player/${encodeURIComponent(steamid)}`)
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
}

async function loadPlayerHistory() {
  const table = document.getElementById('historyTable')
  showSkeletonRows(table, 6, 4)

  const res = await fetchJson(`/player-history-daily/${encodeURIComponent(steamid)}`)
  const history = res

  if (Array.isArray(history) && history.length > 0) {
    document.getElementById('lastMap').innerText = history[history.length - 1].map || '-'
  }

  const labels = []
  const killsData = []

  if (!Array.isArray(history) || history.length === 0) {
    showEmptyRow(table)
    return
  }

  const fragment = document.createDocumentFragment()

  history.forEach((row) => {
    const cleanDate = (row.day || '').substring(0, 10)
    const [year, month, day] = cleanDate.split('-')
    const date = `${day}/${month}/${year}`
    labels.push(date)
    killsData.push(row.kills ?? 0)

    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${date}</td>
      <td>${row.map || '-'}</td>
      <td>${row.kills ?? 0}</td>
      <td>${row.deaths ?? 0}</td>
      <td>${row.hs ?? 0}</td>
      <td>${row.skill ?? 0}</td>
    `
    fragment.appendChild(tr)
  })

  table.appendChild(fragment)
  animateTableUpdate(table)
  renderChart(labels, killsData)
}

async function loadLastMap() {
  const data = await fetchJson(`/player-last-map/${encodeURIComponent(steamid)}`)
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
    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar player:', err)
    setStatus(`${i18nUtils.t('errors.loadPlayer')}: ${err.message}`, 'error')
  }
}

function renderChart(labels, killsData) {
  const ctx = document.getElementById('killsChart')

  if (chartInstance) {
    chartInstance.destroy()
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: i18nUtils.t('labels.kills'),
        data: killsData,
        tension: 0.25,
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.24)',
        fill: true
      }]
    },
    options: {
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
  })
}

loadPlayerData()
