function renderAdvancedRows(tableId, rows, columns, formatRow) {
  const tbody = document.getElementById(tableId)
  if (!tbody) return

  if (!Array.isArray(rows) || rows.length === 0) {
    showEmptyRow(tbody, columns, i18nUtils.t('labels.noData'))
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

  setStatus(i18nUtils.t('status.loadingAdvanced'))

  try {
    const [headshots, accuracy, streaks] = await Promise.all([
      fetchJson('/top-headshots'),
      fetchJson('/top-accuracy'),
      fetchJson('/top-killstreak')
    ])

    renderAdvancedRows('headshotsTable', headshots, 7, (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${escapeHtml(item.name)}</a></td>
      <td>${item.hs}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.accuracy.toFixed ? item.accuracy.toFixed(2) : item.accuracy}%</td>
      <td>${item.skill}</td>
    `)

    renderAdvancedRows('accuracyTable', accuracy, 7, (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${escapeHtml(item.name)}</a></td>
      <td>${item.accuracy.toFixed ? item.accuracy.toFixed(2) : item.accuracy}%</td>
      <td>${item.hs}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `)

    renderAdvancedRows('streakTable', streaks, 3, (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${escapeHtml(item.name)}</a></td>
      <td>${item.streak}</td>
    `)

    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar estatísticas avançadas:', err)
    setStatus(`${i18nUtils.t('errors.loadAdvanced')}: ${err.message}`, 'error')
    showEmptyRow(headshotsTable, 7, i18nUtils.t('errors.failToLoad'))
    showEmptyRow(accuracyTable, 7, i18nUtils.t('errors.failToLoad'))
    showEmptyRow(streakTable, 3, i18nUtils.t('errors.failToLoad'))
  }
}

document.addEventListener('DOMContentLoaded', loadAdvancedStats)
