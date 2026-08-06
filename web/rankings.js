let currentPeriod = 'weekly'
let currentPage = 1
const PAGE_SIZE = 20

async function loadRanking(period, page = 1) {
  const title = document.getElementById('rankingTitle')
  const table = document.getElementById('rankingTable')
  const pageInfo = document.getElementById('pageInfo')

  setStatus(i18nUtils.t('status.loadingRanking'))
  showSkeletonRows(table, 7, 4)

  try {
    const players = await fetchJson(`/ranking/${period}?limit=${PAGE_SIZE}&page=${page}${serverParam()}`)
    title.innerText = period === 'weekly'
      ? i18nUtils.t('labels.rankingWeekly')
      : i18nUtils.t('labels.rankingMonthly')
    clearStatus()

    if (pageInfo) pageInfo.textContent = page
    updatePagination(players.length >= PAGE_SIZE, page)

    if (!Array.isArray(players) || players.length === 0) {
      showEmptyRow(table)
      return
    }

    const fragment = document.createDocumentFragment()
    players.forEach((p, i) => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${(page - 1) * PAGE_SIZE + i + 1}</td>
        <td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}${serverParam()}">${escapeHtml(p.name)}</a></td>
        <td>${p.kills}</td>
        <td>${p.deaths}</td>
        <td>${p.hs}</td>
        <td>${p.kd}</td>
        <td>${p.skill}</td>
      `
      fragment.appendChild(row)
    })

    table.innerHTML = ''
    table.appendChild(fragment)
    animateTableUpdate(table)
  } catch (err) {
    console.error('Erro ao carregar ranking:', err)
    setStatus(`${i18nUtils.t('errors.loadRanking')}: ${err.message}`, 'error')
    showEmptyRow(table)
  }
}

function updatePagination(hasMore, page) {
  const btnPrev = document.getElementById('btnPrev')
  const btnNext = document.getElementById('btnNext')
  if (btnPrev) btnPrev.disabled = page <= 1
  if (btnNext) btnNext.disabled = !hasMore
}

document.addEventListener('DOMContentLoaded', () => {
  const btnWeekly = document.getElementById('btnWeekly')
  const btnMonthly = document.getElementById('btnMonthly')
  const btnPrev = document.getElementById('btnPrev')
  const btnNext = document.getElementById('btnNext')

  if (btnWeekly) btnWeekly.addEventListener('click', () => {
    currentPeriod = 'weekly'
    currentPage = 1
    loadRanking(currentPeriod, currentPage)
  })
  if (btnMonthly) btnMonthly.addEventListener('click', () => {
    currentPeriod = 'monthly'
    currentPage = 1
    loadRanking(currentPeriod, currentPage)
  })
  if (btnPrev) btnPrev.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1
      loadRanking(currentPeriod, currentPage)
    }
  })
  if (btnNext) btnNext.addEventListener('click', () => {
    currentPage += 1
    loadRanking(currentPeriod, currentPage)
  })

  const btnExportCsv = document.getElementById('btnExportCsv')
  if (btnExportCsv) btnExportCsv.addEventListener('click', () => {
    const filename = `ranking-${currentPeriod}-p${currentPage}.csv`
    exportTableCsv(document.getElementById('rankingTable'), filename)
  })

  loadRanking(currentPeriod, currentPage)
})

document.addEventListener('server-change', () => {
  currentPage = 1
  loadRanking(currentPeriod, currentPage)
})
