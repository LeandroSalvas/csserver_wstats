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

let advancedLimit = 10

function setAdvancedLimit(limit) {
  advancedLimit = limit
  const note = document.getElementById('advancedNote')
  const toggle = document.getElementById('advancedToggle')
  if (note) note.textContent = i18nUtils.t(limit === 50 ? 'advanced.note50' : 'advanced.note10')
  if (toggle) {
    toggle.textContent = i18nUtils.t(limit === 50 ? 'advanced.viewTop' : 'advanced.viewAll')
    toggle.setAttribute('aria-pressed', limit === 50 ? 'true' : 'false')
  }
}

async function loadAdvancedStats() {
  const tables = {
    headshotsTable: { endpoint: '/top-headshots', columns: 7 },
    accuracyTable: { endpoint: '/top-accuracy', columns: 7 },
    streakTable: { endpoint: '/top-killstreak', columns: 3 },
    skillTable: { endpoint: '/topskill', columns: 3 },
    kdTable: { endpoint: '/topkd', columns: 6 },
    assistsTable: { endpoint: '/top-assists', columns: 6 },
    damageTable: { endpoint: '/top-damage', columns: 6 },
    tkTable: { endpoint: '/top-tk', columns: 6 },
    bombTable: { endpoint: '/top-bomb', columns: 7 },
    connectTimeTable: { endpoint: '/top-connect-time', columns: 6 }
  }

  Object.entries(tables).forEach(([tableId, { columns }]) => {
    showSkeletonRows(document.getElementById(tableId), columns, 4)
  })

  setStatus(i18nUtils.t('status.loadingAdvanced'))

  try {
    const fetchAll = Object.entries(tables).map(async ([tableId, { endpoint }]) => {
      try {
        const rows = await fetchJson(`${endpoint}?limit=${advancedLimit}${serverParam()}`)
        return { tableId, rows }
      } catch (err) {
        throw { tableId, error: err }
      }
    })
    const results = await Promise.allSettled(fetchAll)

    let anyFailed = false
    results.forEach(({ status, value, reason }) => {
      if (status === 'rejected') {
        anyFailed = true
        const failedTableId = reason.tableId || ''
        console.error(`Erro ao carregar ${failedTableId}:`, reason.error || reason)
        showEmptyRow(document.getElementById(failedTableId), 6, i18nUtils.t('errors.failToLoad'))
        return
      }
      renderAdvancedTable(value.tableId, value.rows)
    })
    addExportButtons()

    if (anyFailed) {
      setStatus(i18nUtils.t('errors.partialAdvanced'), 'warning')
    } else {
      clearStatus()
    }
  } catch (err) {
    console.error('Erro ao carregar estatísticas avançadas:', err)
    setStatus(`${i18nUtils.t('errors.loadAdvanced')}: ${err.message}`, 'error')
    Object.entries(tables).forEach(([tableId, { columns }]) => {
      showEmptyRow(document.getElementById(tableId), columns, i18nUtils.t('errors.failToLoad'))
    })
  }
}

function renderAdvancedTable(tableId, rows) {
  const columns = {
    headshotsTable: 7,
    accuracyTable: 7,
    streakTable: 3,
    skillTable: 3,
    kdTable: 6,
    assistsTable: 6,
    damageTable: 6,
    tkTable: 6,
    bombTable: 7,
    connectTimeTable: 6
  }[tableId]

  const renderers = {
    headshotsTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.hs}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${formatNum(item.accuracy)}%</td>
      <td>${item.skill}</td>
    `,
    accuracyTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${formatNum(item.accuracy)}%</td>
      <td>${item.hs}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `,
    streakTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.streak}</td>
    `,
    skillTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.skill}</td>
    `,
    kdTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${formatNum(item.kd)}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `,
    assistsTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.assists}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `,
    damageTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.dmg.toLocaleString('pt-BR')}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `,
    tkTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.tks}</td>
      <td>${item.kills}</td>
      <td>${item.deaths}</td>
      <td>${item.skill}</td>
    `,
    bombTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${item.bombplants}</td>
      <td>${item.bombdefused}</td>
      <td>${item.bombdef}</td>
      <td>${item.bombexplosions}</td>
      <td>${item.skill}</td>
    `,
    connectTimeTable: (item, index) => `
      <td>${index + 1}</td>
      <td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}${serverParam()}">${escapeHtml(item.name)}</a></td>
      <td>${formatHours(item.connection_time)}</td>
      <td>${item.connects}</td>
      <td>${item.kills}</td>
      <td>${item.skill}</td>
    `
  }

  renderAdvancedRows(tableId, rows, columns, renderers[tableId])
}

function formatNum(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num.toFixed(2) : '-'
}

function formatHours(seconds) {
  const total = Number(seconds) || 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function addExportButtons() {
  document.querySelectorAll('.card').forEach((card) => {
    if (card.querySelector('.export-btn')) return

    const table = card.querySelector('table')
    const title = card.querySelector('h2')
    if (!table || !title) return

    const btn = document.createElement('button')
    btn.className = 'export-btn'
    btn.textContent = i18nUtils.t('labels.exportCsv')
    btn.addEventListener('click', () => {
      const name = title.textContent.trim().replace(/\s+/g, '-').toLowerCase() || 'advanced'
      exportTableCsv(table, `${name}.csv`)
    })

    const header = document.createElement('div')
    header.className = 'card-header'
    card.insertBefore(header, title)
    header.appendChild(title)
    header.appendChild(btn)
  })
}

document.addEventListener('DOMContentLoaded', () => {
  setAdvancedLimit(10)
  const toggle = document.getElementById('advancedToggle')
  if (toggle) {
    toggle.addEventListener('click', () => {
      setAdvancedLimit(advancedLimit === 10 ? 50 : 10)
      loadAdvancedStats()
    })
  }
  loadAdvancedStats()
})

document.addEventListener('i18n applied', () => {
  setAdvancedLimit(advancedLimit)
})

document.addEventListener('server-change', loadAdvancedStats)
