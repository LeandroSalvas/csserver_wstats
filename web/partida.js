const pathMatch = window.location.pathname.match(/^\/partida\/(.+)$/)
const params = new URLSearchParams(window.location.search)
const matchId = params.get('id') || (pathMatch ? decodeURIComponent(pathMatch[1]) : null)

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

function isBot(p) {
  return !p.steamid || /^BOT/i.test(p.steamid)
}

function winnerLabel(match) {
  if (match.winner === 'T') return '<span class="winner-t">T</span>'
  if (match.winner === 'CT') return '<span class="winner-ct">CT</span>'
  return `<span class="winner-draw">${escapeHtml(i18nUtils.t('matches.draw'))}</span>`
}

function playerNameCell(p) {
  if (isBot(p)) return escapeHtml(p.name || 'BOT')
  return `<a href="/jogador/${encodeURIComponent(p.steamid)}">${escapeHtml(p.name || p.steamid)}</a>`
}

function renderSummary(match) {
  const el = document.getElementById('matchSummary')
  if (!el) return

  const scoreHtml = `<span class="match-score match-score-t">${match.round_t}</span> : <span class="match-score match-score-ct">${match.round_ct}</span>`

  const rows = [
    [i18nUtils.t('match.map'), `<a href="/mapa/${encodeURIComponent(match.map)}">${escapeHtml(match.map)}</a>`],
    [i18nUtils.t('match.score'), scoreHtml],
    [i18nUtils.t('match.winner'), winnerLabel(match)],
    [i18nUtils.t('match.duration'), formatMatchDuration(match.duration_sec)],
    [i18nUtils.t('match.date'), formatMatchDate(match.ended_at)],
    [i18nUtils.t('match.server'), escapeHtml(match.server || 'main')]
  ]

  el.innerHTML = rows
    .map(([label, value]) => `<div class="match-summary-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join('')
}

function renderTeam(team, players, tbodyId, countId) {
  const tbody = document.getElementById(tbodyId)
  const list = players.filter((p) => p.team === team)

  document.getElementById(countId).textContent = list.length

  const fragment = document.createDocumentFragment()

  list.forEach((p) => {
    const kills = Number(p.kills) || 0
    const deaths = Number(p.deaths) || 0
    const kd = (kills / (deaths || 1)).toFixed(2)

    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${playerNameCell(p)}</td>
      <td>${kills}</td>
      <td>${deaths}</td>
      <td>${Number(p.hs) || 0}</td>
      <td>${kd}</td>
    `
    fragment.appendChild(tr)
  })

  tbody.innerHTML = ''
  tbody.appendChild(fragment)
}

function renderSpecs(specs) {
  const section = document.getElementById('specsSection')
  const tbody = document.getElementById('specPlayers')

  section.hidden = false

  const fragment = document.createDocumentFragment()

  specs.forEach((p) => {
    const kills = Number(p.kills) || 0
    const deaths = Number(p.deaths) || 0
    const kd = (kills / (deaths || 1)).toFixed(2)

    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${playerNameCell(p)}</td>
      <td>${kills}</td>
      <td>${deaths}</td>
      <td>${Number(p.hs) || 0}</td>
      <td>${kd}</td>
    `
    fragment.appendChild(tr)
  })

  tbody.innerHTML = ''
  tbody.appendChild(fragment)
}

async function loadPlayers() {
  const players = await fetchJson(`/matches/${encodeURIComponent(matchId)}/players`)
  const card = document.getElementById('playersCard')
  const noPlayers = document.getElementById('noPlayers')

  if (!Array.isArray(players) || players.length === 0) {
    noPlayers.hidden = false
    noPlayers.textContent = i18nUtils.t('match.noPlayers')
    return
  }

  card.hidden = false
  renderTeam('T', players, 'tPlayers', 'tCount')
  renderTeam('CT', players, 'ctPlayers', 'ctCount')

  const specs = players.filter((p) => p.team !== 'T' && p.team !== 'CT')
  if (specs.length) renderSpecs(specs)
}

async function loadMatch() {
  if (!matchId) {
    setStatus(i18nUtils.t('match.noData'), 'error')
    return
  }

  setStatus(i18nUtils.t('status.loadingMatches'))

  try {
    const match = await fetchJson(`/matches/${encodeURIComponent(matchId)}`)
    if (!match) throw new Error(i18nUtils.t('match.noData'))
    renderSummary(match)
    await loadPlayers()
    clearStatus()
  } catch (err) {
    console.error('Erro ao carregar partida:', err)
    setStatus(`${i18nUtils.t('errors.loadMatches')}: ${err.message}`, 'error')
  }
}

document.addEventListener('DOMContentLoaded', loadMatch)
