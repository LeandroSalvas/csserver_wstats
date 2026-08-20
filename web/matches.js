const urlParams = new URLSearchParams(window.location.search)
let matchesPage = Math.max(1, Number.parseInt(urlParams.get('page') || '1', 10) || 1)
const MATCHES_LIMIT = 10

function updateUrl() {
  const url = new URL(window.location.href)
  if (matchesPage > 1) url.searchParams.set('page', String(matchesPage))
  else url.searchParams.delete('page')
  window.history.replaceState(null, '', url.toString())
}

async function loadMatches(page = 1) {
  const tbody = document.getElementById('matchesTable')
  if (!tbody) return

  matchesPage = page
  showSkeletonRows(tbody, 6, 4)
  setStatus(i18nUtils.t('status.loadingMatches'))

  try {
    const { matches: rows, total } = await fetchJson(`/matches?limit=${MATCHES_LIMIT}&page=${page}${serverParam()}`)
    renderMatches(tbody, rows)
    updateMatchesPagination(rows.length, total)
    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar partidas:', err)
    showEmptyRow(tbody, 6, i18nUtils.t('errors.loadMatches'))
    setStatus(`${i18nUtils.t('errors.loadMatches')}: ${err.message}`, 'error')
  }
}

function renderMatches(tbody, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    showEmptyRow(tbody, 6, i18nUtils.t('labels.noData'))
    return
  }

  renderRows(tbody, rows, (item, index) => {
    const row = document.createElement('tr')
    row.innerHTML = `
      <td>${((matchesPage - 1) * MATCHES_LIMIT) + index + 1}</td>
      <td><a href="/mapa/${encodeURIComponent(item.map)}">${escapeHtml(item.map)}</a></td>
      <td><span class="match-score match-score-t">${item.round_t}</span> : <span class="match-score match-score-ct">${item.round_ct}</span></td>
      <td>${winnerLabel(item)}</td>
      <td>${formatMatchDuration(item.duration_sec)}</td>
      <td>${formatMatchDate(item.ended_at)}</td>
      <td><a class="match-details-link" href="/partida/${item.id}" title="${escapeHtml(i18nUtils.t('matches.details'))}">${escapeHtml(i18nUtils.t('matches.details'))} ↗</a></td>
    `
    return row
  })
}

function winnerLabel(item) {
  if (item.winner === 'T') return '<span class="winner-t">T</span>'
  if (item.winner === 'CT') return '<span class="winner-ct">CT</span>'
  return `<span class="winner-draw">${escapeHtml(i18nUtils.t('matches.draw'))}</span>`
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

function updateMatchesPagination(rowsCount, total) {
  const pageInfo = document.getElementById('pageInfo')
  const prevBtn = document.getElementById('prevPage')
  const nextBtn = document.getElementById('nextPage')
  if (!pageInfo || !prevBtn || !nextBtn) return

  const totalPages = Math.max(1, Math.ceil((total || 0) / MATCHES_LIMIT))
  pageInfo.textContent = `${matchesPage} / ${totalPages}`
  prevBtn.disabled = matchesPage <= 1
  nextBtn.disabled = matchesPage >= totalPages
}

function initMatchesPage() {
  document.getElementById('prevPage').addEventListener('click', () => {
    if (matchesPage > 1) {
      loadMatches(matchesPage - 1)
      updateUrl()
    }
  })
  document.getElementById('nextPage').addEventListener('click', () => {
    loadMatches(matchesPage + 1)
    updateUrl()
  })
  loadMatches()
}

document.addEventListener('server-change', () => {
  loadMatches(1)
})

document.addEventListener('DOMContentLoaded', initMatchesPage)
