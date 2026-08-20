const urlParams = new URLSearchParams(window.location.search)
const MAPS_PAGE_SIZE = 10
let mapsPage = Math.max(1, Number.parseInt(urlParams.get('page') || '1', 10) || 1)

function updateMapsUrl() {
  const url = new URL(window.location.href)
  if (mapsPage > 1) url.searchParams.set('page', String(mapsPage))
  else url.searchParams.delete('page')
  window.history.replaceState(null, '', url.toString())
}

async function loadMaps(page = 1) {
  const table = document.getElementById('mapsTable')
  if (!table) return
  mapsPage = page
  setStatus(i18nUtils.t('status.loadingMaps'))
  showSkeletonRows(table, 3, 3)

  try {
    const result = await fetchJson(`/maps?limit=${MAPS_PAGE_SIZE}&page=${page}${serverQuery()}`)
    const maps = result.maps || []
    const total = result.total || 0
    clearStatus()

    if (!Array.isArray(maps) || maps.length === 0) {
      showEmptyRow(table, 3, i18nUtils.t('labels.noMaps'))
      updateMapsPagination(0, total)
      return
    }

    renderRows(table, maps, (m, i) => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${((mapsPage - 1) * MAPS_PAGE_SIZE) + i + 1}</td>
        <td><a href="/mapa/${encodeURIComponent(m.map)}">${escapeHtml(m.map)}</a></td>
        <td>${m.snapshots}</td>
      `
      return row
    })
    updateMapsPagination(maps.length, total)
  } catch (err) {
    console.error('Erro ao carregar mapas:', err)
    setStatus(`${i18nUtils.t('errors.loadMaps')}: ${err.message}`, 'error')
    showEmptyRow(table, 3, i18nUtils.t('labels.failLoadMaps'))
  }
}

function updateMapsPagination(rowsCount, total) {
  const pageInfo = document.getElementById('mapsPageInfo')
  const prevBtn = document.getElementById('mapsPrevPage')
  const nextBtn = document.getElementById('mapsNextPage')
  if (!pageInfo || !prevBtn || !nextBtn) return

  const totalPages = Math.max(1, Math.ceil(total / MAPS_PAGE_SIZE))
  pageInfo.textContent = `${mapsPage} / ${totalPages}`
  prevBtn.disabled = mapsPage <= 1
  nextBtn.disabled = mapsPage >= totalPages
}

function initMapsPage() {
  document.getElementById('mapsPrevPage').addEventListener('click', () => {
    if (mapsPage > 1) {
      loadMaps(mapsPage - 1)
      updateMapsUrl()
    }
  })
  document.getElementById('mapsNextPage').addEventListener('click', () => {
    loadMaps(mapsPage + 1)
    updateMapsUrl()
  })
  loadMaps()
}

document.addEventListener('DOMContentLoaded', initMapsPage)
document.addEventListener('server-change', () => loadMaps(1))
