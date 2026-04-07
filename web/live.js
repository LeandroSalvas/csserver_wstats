let liveInitialized = false
let liveLastFetchFailed = false
let previousKills = []
const previousScoreboard = { T: new Map(), CT: new Map() }

function getWeaponEmoji(weapon) {
  const map = {
    p228: "🔫",
    scout: "🎯",
    hegrenade: "💣",
    xm1014: "💥",
    c4: "💣",
    mac10: "🔫",
    aug: "🔫",
    smokegrenade: "💨",
    elite: "🔫",
    fiveseven: "🔫",
    ump45: "🔫",
    sg550: "🎯",
    galil: "🔫",
    famas: "🔫",
    usp: "🔫",
    glock18: "🔫",
    awp: "🎯",
    mp5navy: "🔫",
    m249: "🔫",
    m3: "💥",
    m4a1: "🔫",
    tmp: "🔫",
    g3sg1: "🎯",
    flashbang: "💥",
    deagle: "🔫",
    sg552: "🔫",
    ak47: "🔫",
    knife: "🔪",
    p90: "🔫",
    world: "☠️",
    worldspawn: "☠️"
  }

  return map[(weapon || "").toLowerCase()] || "🔫"
}

function getHeadshotEmoji(isHeadshot) {
  return isHeadshot ? "🎯" : ""
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
    tbody.innerHTML = `
      <tr>
        <td colspan="5">${i18nUtils.t('labels.noPlayersThisTeam')}</td>
      </tr>
    `
    previousScoreboard[teamKey] = new Map()
    const table = tbody.closest('table')
    if (table) animateTableUpdate(table)
    return
  }

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

      tbody.innerHTML += `
        <tr>
          <td title="${nameAttr}">${name}</td>
          <td>
            <span class="sf-status-stack">
              <span class="sf-status-emoji" aria-hidden="true">${player.alive ? "🟢" : "🔴"}</span>
              <span class="sf-status-text">${player.alive ? i18nUtils.t('live.alive') : i18nUtils.t('live.dead')}</span>
            </span>
          </td>
          <td>${scoreHtml}</td>
          <td>${deathsHtml}</td>
          <td>${kdHtml}</td>
        </tr>
      `
    })

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
    <span class="kill-killer">${kill.killer}</span>
    <span class="kill-arrow">→</span>
    <span class="kill-victim">${kill.victim}</span>
    <span class="kill-weapon" title="${kill.weapon || "weapon"}">${weaponEmoji}</span>
    ${hsEmoji ? `<span class="kill-hs" title="Headshot">${hsEmoji}</span>` : ""}
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
    const data = await fetchJson('/live/state')
    liveInitialized = true
    liveLastFetchFailed = false
    clearStatus()

    const players = Array.isArray(data.players) ? data.players : []

    document.getElementById('liveHostname').innerText = data.hostname || i18nUtils.t('server.hostname')
    document.getElementById('liveMap').innerText = data.map || '-'
    document.getElementById('liveCount').innerText = players.length

    const tPlayers = players.filter((p) => p.team === 'T')
    const ctPlayers = players.filter((p) => p.team === 'CT')

    document.getElementById('tCount').innerText = `${tPlayers.length} ${i18nUtils.t('live.playersCount')}`
    document.getElementById('ctCount').innerText = `${ctPlayers.length} ${i18nUtils.t('live.playersCount')}`

    renderPlayers('tPlayers', tPlayers, 'T')
    renderPlayers('ctPlayers', ctPlayers, 'CT')
  } catch (err) {
    liveLastFetchFailed = true
    console.error('Erro ao carregar live panel:', err)
    setStatus(`${i18nUtils.t('errors.loadLive')}: ${err.message}`, 'error')

    document.getElementById('liveHostname').innerText = i18nUtils.t('status.offline')
    document.getElementById('liveMap').innerText = '-'
    document.getElementById('liveCount').innerText = '0'
    document.getElementById('tCount').innerText = `0 ${i18nUtils.t('live.playersCount')}`
    document.getElementById('ctCount').innerText = `0 ${i18nUtils.t('live.playersCount')}`

    renderPlayers('tPlayers', [], 'T')
    renderPlayers('ctPlayers', [], 'CT')
  }
}

async function loadKillFeed() {
  try {
    const data = await fetchJson('/live/killfeed')
    renderKillFeed(Array.isArray(data) ? data.slice(0, 5) : [])
  } catch (err) {
    console.error("Erro ao carregar kill feed:", err)
  }
}

loadLivePanel()
loadKillFeed()

setInterval(loadLivePanel, 5000)
setInterval(loadKillFeed, 2000)
