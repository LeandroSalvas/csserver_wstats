async function loadRanking(period) {
  const title = document.getElementById('rankingTitle')
  const table = document.getElementById('rankingTable')

  setStatus('Carregando ranking...')
  showSkeletonRows(table, 7, 4)

  try {
    const players = await fetchJson(`/ranking/${period}`)
    title.innerText = period === 'weekly' ? 'Ranking semanal' : 'Ranking mensal'
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
        <td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}">${p.name}</a></td>
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
    setStatus(`Erro ao carregar ranking: ${err.message}`, 'error')
    showEmptyRow(table)
  }
}

loadRanking('weekly')
