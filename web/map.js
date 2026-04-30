const params = new URLSearchParams(window.location.search)
const mapName = params.get('map')

async function loadMapRanking() {
  const title = document.getElementById('mapTitle')
  const table = document.getElementById('mapRanking')
  setStatus(i18nUtils.t('status.loadingMap'))
  showSkeletonRows(table, 7, 4)

  if (!mapName) {
    setStatus(i18nUtils.t('errors.mapNotProvided'), 'error')
    showEmptyRow(table)
    return
  }

  try {
    title.innerText = `${i18nUtils.t('labels.rankingMap')}: ${mapName}`
    const players = await fetchJson(`/map-ranking/${encodeURIComponent(mapName)}`)
    clearStatus()

    if (!Array.isArray(players) || players.length === 0) {
      showEmptyRow(table)
      return
    }

    const fragment = document.createDocumentFragment()
    players.forEach((p, i) => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${i + 1}</td>
        <td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}">${escapeHtml(p.name)}</a></td>
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
    console.error('Erro ao carregar ranking do mapa:', err)
    setStatus(`${i18nUtils.t('errors.loadMap')}: ${err.message}`, 'error')
    showEmptyRow(table)
  }
}

document.addEventListener('DOMContentLoaded', loadMapRanking)
