let liveInitialized = false
let liveLastFetchFailed = false
let previousKills = []
let sseActive = false
const previousScoreboard = { T: new Map(), CT: new Map() }

function getWeaponEmoji(weapon) {
  const map = {
    p228: "\u{1F52B}",
    scout: "\u{1F3AF}",
    hegrenade: "\u{1F4A3}",
    xm1014: "\u{1F4A5}",
    c4: "\u{1F4A3}",
    mac10: "\u{1F52B}",
    aug: "\u{1F52B}",
    smokegrenade: "\u{1F4A8}",
    elite: "\u{1F52B}",
    fiveseven: "\u{1F52B}",
    ump45: "\u{1F52B}",
    sg550: "\u{1F3AF}",
    galil: "\u{1F52B}",
    famas: "\u{1F52B}",
    usp: "\u{1F52B}",
    glock18: "\u{1F52B}",
    awp: "\u{1F3AF}",
    mp5navy: "\u{1F52B}",
    m249: "\u{1F52B}",
    m3: "\u{1F4A5}",
    m4a1: "\u{1F52B}",
    tmp: "\u{1F52B}",
    g3sg1: "\u{1F3AF}",
    flashbang: "\u{1F4A5}",
    deagle: "\u{1F52B}",
    sg552: "\u{1F52B}",
    ak47: "\u{1F52B}",
    knife: "\u{1F52A}",
    p90: "\u{1F52B}",
    world: "\u2620\uFE0F",
    worldspawn: "\u2620\uFE0F"
  }

  return map[(weapon || "").toLowerCase()] || "\u{1F52B}"
}

function getHeadshotEmoji(isHeadshot) {
  return isHeadshot ? "\u{1F3AF}" : ""
}

function killKey(kill, index) {
  return `${kill.killer}|${kill.victim}|${kill.weapon}|${kill.headshot}|${index}`
}

function escapeHtmlText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function renderFlapDigitsInt(value, prev, staggerMs) {
  const str = String(value)
  const prevStr = prev !== undefined && prev !== null ? String(prev) : null

  if (prevStr !== null && prevStr === str) {
    return escapeHtmlText(str)
  }

  const chars = [...str]
  const prevChars = prevStr ? [...prevStr] : []

  return chars
    .map((ch, i) => {
      const pch = prevChars[i]
      const sameLen = prevStr !== null && prevStr.length === str.length
      const same = sameLen && pch === ch
      const delay = staggerMs + i * 44
      if (same) {
        return `<span class="sf-ch">${escapeHtmlText(ch)}</span>`
      }
      return `<span class="sf-ch sf-ch--flip" style="animation-delay:${delay}ms">${escapeHtmlText(ch)}</span>`
    })
    .join("")
}

function renderFlapNumericCell(value, prev, staggerMs) {
  const str = String(value)
  const prevStr = prev !== undefined && prev !== null ? String(prev) : null
  const changed = prevStr === null || prevStr !== str

  if (!changed) {
    return escapeHtmlText(str)
  }
  return `<span class="sf-val sf-val--tick" style="animation-delay:${staggerMs}ms">${escapeHtmlText(str)}</span>`
}

function renderPlayers(elementId, players, teamKey) {
  const tbody = document.getElementById(elementId)
  const prevMap = previousScoreboard[teamKey] || new Map()
  const nextMap = new Map()
  tbody.innerHTML = ""

  if (!players.length) {
    tbody.innerHTML = ''
    previousScoreboard[teamKey] = new Map()
    return
  }

  const rows = []
  players
    .sort((a, b) => b.score - a.score)
    .forEach((player, rowIdx) => {
      const kd = (player.score / Math.max(player.deaths, 1)).toFixed(2)
      const prev = prevMap.get(player.name)

      const name = escapeHtmlText(player.name)
      const nameAttr = escapeAttr(player.name)
      const baseDelay = rowIdx * 72

      const scoreHtml = renderFlapDigitsInt(player.score, prev?.score, baseDelay)
      const deathsHtml = renderFlapDigitsInt(player.deaths, prev?.deaths, baseDelay + 38)
      const kdHtml = renderFlapNumericCell(kd, prev?.kd, baseDelay + 76)

      nextMap.set(player.name, { score: player.score, deaths: player.deaths, kd })

      rows.push(`
        <tr>
          <td title="${nameAttr}">${name}</td>
          <td>
            <span class="sf-status-stack">
              <span class="sf-status-emoji" aria-hidden="true">${player.alive ? "\u{1F7E2}" : "\u{1F534}"}</span>
              <span class="sf-status-text">${player.alive ? i18nUtils.t('live.alive') : i18nUtils.t('live.dead')}</span>
            </span>
          </td>
          <td>${scoreHtml}</td>
          <td>${deathsHtml}</td>
          <td>${kdHtml}</td>
        </tr>
      `)
    })

  tbody.innerHTML = rows.join('')

  previousScoreboard[teamKey] = nextMap

  const table = tbody.closest('table')
  if (table) animateTableUpdate(table)
}

function createKillFeedItem(kill, index) {
  const item = document.createElement("div")
  item.className = "kill-feed-item entering"
  item.dataset.key = killKey(kill, index)

  const weaponEmoji = getWeaponEmoji(kill.weapon)
  const hsEmoji = getHeadshotEmoji(kill.headshot)

  item.innerHTML = `
    <span class="kill-killer">${escapeHtmlText(kill.killer)}</span>
    <span class="kill-arrow">\u2192</span>
    <span class="kill-victim">${escapeHtmlText(kill.victim)}</span>
    <span class="kill-weapon" title="${escapeAttr(kill.weapon || 'weapon')}">${weaponEmoji}</span>
    ${hsEmoji ? `<span class="kill-hs" title="Headshot">${hsEmoji}</span>` : ''}
  `

  requestAnimationFrame(() => {
    item.classList.remove("entering")
    item.classList.add("visible")
  })

  return item
}

function renderKillFeed(kills) {
  const container = document.getElementById("killFeed")
  const newKills = Array.isArray(kills) ? kills.slice(0, 5) : []

  if (!newKills.length) {
    previousKills = []
    container.innerHTML = `<div class="kill-feed-empty">${i18nUtils.t('labels.noRecentKills')}</div>`
    return
  }

  const newKeys = newKills.map((kill, index) => killKey(kill, index))

  if (container.querySelector(".kill-feed-empty")) {
    container.innerHTML = ""
  }

  const existingItems = Array.from(container.querySelectorAll(".kill-feed-item"))

  existingItems.forEach((item) => {
    const key = item.dataset.key
    if (!newKeys.includes(key)) {
      item.classList.remove("visible")
      item.classList.add("leaving")

      setTimeout(() => {
        if (item.parentNode) {
          item.remove()
        }
      }, 300)
    }
  })

  newKills.forEach((kill, index) => {
    const key = killKey(kill, index)
    let existing = container.querySelector(`.kill-feed-item[data-key="${CSS.escape(key)}"]`)

    if (!existing) {
      existing = createKillFeedItem(kill, index)

      if (index >= container.children.length) {
        container.appendChild(existing)
      } else {
        container.insertBefore(existing, container.children[index])
      }
    } else {
      const currentChild = container.children[index]
      if (currentChild !== existing) {
        container.insertBefore(existing, currentChild || null)
      }
    }
  })

  previousKills = newKills
}

function applyLiveState(data) {
  liveInitialized = true
  liveLastFetchFailed = false
  clearStatus()

  const players = Array.isArray(data.players) ? data.players : []

  document.getElementById('liveHostname').innerText = data.hostname || i18nUtils.t('server.hostname')
  document.getElementById('liveMap').innerText = data.map || '-'
  document.getElementById('liveCount').innerText = players.length

  const roundT = Number.isFinite(Number(data.round_t)) ? Number(data.round_t) : 0
  const roundCT = Number.isFinite(Number(data.round_ct)) ? Number(data.round_ct) : 0
  document.getElementById('liveScoreT').innerText = roundT
  document.getElementById('liveScoreCT').innerText = roundCT

  const tPlayers = players.filter((p) => p.team === 'T')
  const ctPlayers = players.filter((p) => p.team === 'CT')

  const tCount = document.getElementById('tCount')
  const ctCount = document.getElementById('ctCount')
  if (tCount) {
    tCount.hidden = tPlayers.length === 0
    if (tPlayers.length > 0) tCount.innerText = `${tPlayers.length} ${i18nUtils.t('live.playersCount')}`
  }
  if (ctCount) {
    ctCount.hidden = ctPlayers.length === 0
    if (ctPlayers.length > 0) ctCount.innerText = `${ctPlayers.length} ${i18nUtils.t('live.playersCount')}`
  }

  renderPlayers('tPlayers', tPlayers, 'T')
  renderPlayers('ctPlayers', ctPlayers, 'CT')

  const liveScoreAnnounce = document.getElementById('liveScoreAnnounce')
  if (liveScoreAnnounce) {
    liveScoreAnnounce.textContent = `${data.hostname || ''} — ${i18nUtils.t('live.score')} ${roundT} a ${roundCT}`
  }
}

function handleLiveError() {
  liveLastFetchFailed = true
  console.error('Erro ao carregar live panel')
  setStatus(i18nUtils.t('errors.loadLive'), 'error')

  document.getElementById('liveHostname').innerText = i18nUtils.t('status.offline')
  document.getElementById('liveMap').innerText = '-'
  document.getElementById('liveCount').innerText = '0'
  document.getElementById('liveScoreT').innerText = '0'
  document.getElementById('liveScoreCT').innerText = '0'
  const tCount = document.getElementById('tCount')
  const ctCount = document.getElementById('ctCount')
  if (tCount) tCount.hidden = true
  if (ctCount) ctCount.hidden = true

  renderPlayers('tPlayers', [], 'T')
  renderPlayers('ctPlayers', [], 'CT')
}

async function loadLivePanel() {
  const tBody = document.getElementById('tPlayers')
  const ctBody = document.getElementById('ctPlayers')

  const showLoadingUi = !liveInitialized || liveLastFetchFailed
  if (showLoadingUi) {
    setStatus(i18nUtils.t('status.loadingLive'))
    showSkeletonRows(tBody, 5, 3)
    showSkeletonRows(ctBody, 5, 3)
  }

  try {
    const data = await fetchJson(`/live/state${serverQuery()}`)
    applyLiveState(data)
  } catch (err) {
    handleLiveError()
  }
}

async function loadKillFeed() {
  try {
    const data = await fetchJson(`/live/killfeed${serverQuery()}`)
    renderKillFeed(Array.isArray(data) ? data.slice(0, 5) : [])
  } catch (err) {
    console.error("Erro ao carregar kill feed:", err)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadLivePanel()
  loadKillFeed()
  initLiveSse()
})

setInterval(() => {
  if (!sseActive) loadLivePanel()
}, 5000)

setInterval(() => {
  if (!sseActive) loadKillFeed()
}, 2000)

let liveEventSource = null

function initLiveSse() {
  if (typeof EventSource === 'undefined') return
  if (liveEventSource) liveEventSource.close()

  liveEventSource = new EventSource(`${API}/live/events${serverQuery()}`)

  liveEventSource.addEventListener('scoreboard', (event) => {
    sseActive = true
    try {
      applyLiveState(JSON.parse(event.data))
    } catch (err) {
      console.error('Erro ao processar SSE scoreboard:', err)
    }
  })

  liveEventSource.addEventListener('killfeed', (event) => {
    sseActive = true
    try {
      const data = JSON.parse(event.data)
      renderKillFeed(Array.isArray(data) ? data.slice(0, 5) : [])
    } catch (err) {
      console.error('Erro ao processar SSE killfeed:', err)
    }
  })

  liveEventSource.onerror = () => {
    sseActive = false
    if (liveEventSource) {
      liveEventSource.close()
      liveEventSource = null
    }
  }
}

function resetLiveState() {
  previousKills = []
  previousScoreboard.T = new Map()
  previousScoreboard.CT = new Map()
  const killFeed = document.getElementById('killFeed')
  if (killFeed) {
    killFeed.innerHTML = `<div class="kill-feed-empty">${i18nUtils.t('labels.noRecentKills')}</div>`
  }
}

document.addEventListener('server-change', () => {
  resetLiveState()
  loadLivePanel()
  loadKillFeed()
  initLiveSse()
})
