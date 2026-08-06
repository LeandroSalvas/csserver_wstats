let matchesPage = 1
const MATCHES_LIMIT = 20

async function loadMatches(page = 1) {
  const tbody = document.getElementById('matchesTable')
  if (!tbody) return

  matchesPage = page
  showSkeletonRows(tbody, 6, 4)
  setStatus(i18nUtils.t('status.loadingMatches'))

  try {
    const rows = await fetchJson(`/matches?limit=${MATCHES_LIMIT}&page=${page}${serverParam()}`)
    renderMatches(tbody, rows)
    updateMatchesPagination(rows.length)
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

  tbody.innerHTML = ''
  const fragment = document.createDocumentFragment()

  rows.forEach((item, index) => {
    const row = document.createElement('tr')
    row.innerHTML = `
      <td>${((matchesPage - 1) * MATCHES_LIMIT) + index + 1}</td>
      <td>${escapeHtml(item.map)}</td>
      <td><span class="match-score match-score-t">${item.round_t}</span> : <span class="match-score match-score-ct">${item.round_ct}</span></td>
      <td>${winnerLabel(item)}</td>
      <td>${formatMatchDuration(item.duration_sec)}</td>
      <td>${formatMatchDate(item.ended_at)}</td>
    `
    fragment.appendChild(row)
  })

  tbody.appendChild(fragment)
}

function winnerLabel(item) {
  if (item.winner === 'T') return 'T'
  if (item.winner === 'CT') return 'CT'
  return i18nUtils.t('matches.draw')
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

function updateMatchesPagination(rowsCount) {
  const pageInfo = document.getElementById('pageInfo')
  const prevBtn = document.getElementById('prevPage')
  const nextBtn = document.getElementById('nextPage')
  if (!pageInfo || !prevBtn || !nextBtn) return

  pageInfo.textContent = matchesPage
  prevBtn.disabled = matchesPage <= 1
  nextBtn.disabled = rowsCount < MATCHES_LIMIT
}

function initMatchesPage() {
  document.getElementById('prevPage').addEventListener('click', () => {
    if (matchesPage > 1) loadMatches(matchesPage - 1)
  })
  document.getElementById('nextPage').addEventListener('click', () => {
    loadMatches(matchesPage + 1)
  })
  loadMatches()
}

document.addEventListener('server-change', () => {
  loadMatches(1)
})

document.addEventListener('DOMContentLoaded', initMatchesPage)
