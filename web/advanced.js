function renderAdvancedRows(tableId, rows, columns, formatRow) {
  const tbody = document.getElementById(tableId)
  if (!tbody) return

  if (!Array.isArray(rows) || rows.length === 0) {
    showEmptyRow(tbody, columns, 'Nenhum dado disponível')
    return
  }

  tbody.innerHTML = ''
  const fragment = document.createDocumentFragment()

  rows.forEach((item, index) => {
    const row = document.createElement('tr')
    row.innerHTML = formatRow(item, index)
    fragment.appendChild(row)
  })

  tbody.appendChild(fragment)
}

async function loadAdvancedStats() {
  const headshotsTable = document.getElementById('headshotsTable')
  const accuracyTable = document.getElementById('accuracyTable')
  const streakTable = document.getElementById('streakTable')

  showSkeletonRows(headshotsTable, 7, 4)
  showSkeletonRows(accuracyTable, 7, 4)
  showSkeletonRows(streakTable, 3, 4)

  setStatus('Carregando estatísticas avançadas...')

  try {
    const [headshots, accuracy, streaks] = await Promise.all([
      fetchJson('/top-headshots'),
      fetchJson('/top-accuracy'),
      fetchJson('/top-killstreak')
    ])

    renderAdvancedRows('headshotsTable', headshots, 7, (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${item.name}</a></td>
      <td>${item.hs}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.accuracy.toFixed ? item.accuracy.toFixed(2) : item.accuracy}%</td>
      <td>${item.skill}</td>
    `)

    renderAdvancedRows('accuracyTable', accuracy, 7, (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${item.name}</a></td>
      <td>${item.accuracy.toFixed ? item.accuracy.toFixed(2) : item.accuracy}%</td>
      <td>${item.hs}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `)

    renderAdvancedRows('streakTable', streaks, 3, (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${item.name}</a></td>
      <td>${item.streak}</td>
    `)

    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar estatísticas avançadas:', err)
    setStatus(`Não foi possível carregar estatísticas avançadas: ${err.message}`, 'error')
    showEmptyRow(headshotsTable, 7, 'Falha ao carregar dados')
    showEmptyRow(accuracyTable, 7, 'Falha ao carregar dados')
    showEmptyRow(streakTable, 3, 'Falha ao carregar dados')
  }
}

loadAdvancedStats()
