async function loadMaps() {
  const table = document.getElementById('mapsTable')
  setStatus('Carregando mapas...')
  showSkeletonRows(table, 3, 4)

  try {
    const maps = await fetchJson('/maps')
    clearStatus()

    if (!Array.isArray(maps) || maps.length === 0) {
      showEmptyRow(table, 3, 'Nenhum mapa encontrado')
      return
    }

    const fragment = document.createDocumentFragment()
    maps.forEach((m, i) => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${i + 1}</td>
        <td><a href="map.html?map=${encodeURIComponent(m.map)}">${m.map}</a></td>
        <td>${m.snapshots}</td>
      `
      fragment.appendChild(row)
    })

    table.innerHTML = ''
    table.appendChild(fragment)
    animateTableUpdate(table)
  } catch (err) {
    console.error('Erro ao carregar mapas:', err)
    setStatus(`Erro ao carregar mapas: ${err.message}`, 'error')
    showEmptyRow(table, 3, 'Falha ao carregar mapas')
  }
}

loadMaps()
