const commandReference = [
  { category: 'server', command: 'status', descriptionKey: 'cmd.status' },
  { category: 'server', command: 'users', descriptionKey: 'cmd.users' },
  { category: 'server', command: 'stats', descriptionKey: 'cmd.stats' },
  { category: 'server', command: 'version', descriptionKey: 'cmd.version' },
  { category: 'server', command: 'hostname "LeandroSalvas\'s Server"', descriptionKey: 'cmd.hostname', danger: true },

  { category: 'map', command: 'changelevel de_dust2', descriptionKey: 'cmd.changelevelDust2' },
  { category: 'map', command: 'changelevel de_inferno', descriptionKey: 'cmd.changelevelInferno' },
  { category: 'map', command: 'changelevel de_nuke', descriptionKey: 'cmd.changelevelNuke' },
  { category: 'map', command: 'map de_dust2', descriptionKey: 'cmd.mapDust2' },

  { category: 'gameplay', command: 'mp_timelimit 20', descriptionKey: 'cmd.timelimit' },
  { category: 'gameplay', command: 'mp_roundtime 3', descriptionKey: 'cmd.roundtime' },
  { category: 'gameplay', command: 'mp_freezetime 3', descriptionKey: 'cmd.freezetime' },
  { category: 'gameplay', command: 'mp_buytime 0.5', descriptionKey: 'cmd.buytime' },
  { category: 'gameplay', command: 'mp_startmoney 800', descriptionKey: 'cmd.startmoney' },
  { category: 'gameplay', command: 'mp_c4timer 35', descriptionKey: 'cmd.c4timer' },
  { category: 'gameplay', command: 'mp_friendlyfire 0', descriptionKey: 'cmd.friendlyfire' },
  { category: 'gameplay', command: 'mp_autoteambalance 1', descriptionKey: 'cmd.autoteambalance' },
  { category: 'gameplay', command: 'mp_limitteams 2', descriptionKey: 'cmd.limitteams' },
  { category: 'gameplay', command: 'sv_restart 1', descriptionKey: 'cmd.restart' },

  { category: 'messages', command: 'say Mensagem do servidor', descriptionKey: 'cmd.say' },
  { category: 'messages', command: 'echo Mensagem', descriptionKey: 'cmd.echo' },

  { category: 'amx', command: 'amx_map de_inferno', descriptionKey: 'cmd.amxMap' },
  { category: 'amx', command: 'amx_say Mensagem do admin', descriptionKey: 'cmd.amxSay' },
  { category: 'amx', command: 'amx_csay Mensagem central', descriptionKey: 'cmd.amxCsay' },
  { category: 'amx', command: 'amx_chat Mensagem para admins', descriptionKey: 'cmd.amxChat' },
  { category: 'amx', command: 'amx_kick nick motivo', descriptionKey: 'cmd.amxKick' },
  { category: 'amx', command: 'amx_ban nick 30 motivo', descriptionKey: 'cmd.amxBan' },
  { category: 'amx', command: 'amx_slap nick 0', descriptionKey: 'cmd.amxSlap' },
  { category: 'amx', command: 'amx_slay nick', descriptionKey: 'cmd.amxSlay' },
  { category: 'amx', command: 'amx_who', descriptionKey: 'cmd.amxWho' },
  { category: 'amx', command: 'amx_plugins', descriptionKey: 'cmd.amxPlugins' },
  { category: 'amx', command: 'amx_modules', descriptionKey: 'cmd.amxModules' },
  { category: 'amx', command: 'amx_reloadadmins', descriptionKey: 'cmd.amxReloadadmins' },

  { category: 'podbod', command: 'pb add 50', descriptionKey: 'cmd.pbAdd' },
  { category: 'podbod', command: 'pb remove <id>', descriptionKey: 'cmd.pbRemove' },
  { category: 'podbod', command: 'pb removebots', descriptionKey: 'cmd.pbRemovebots' },
  { category: 'podbod', command: 'pb killbots', descriptionKey: 'cmd.pbKillbots' },
  { category: 'podbod', command: 'pb fillserver', descriptionKey: 'cmd.pbFillserver' },
  { category: 'podbod', command: 'pb help', descriptionKey: 'cmd.pbHelp' },
  { category: 'podbod', command: 'pb weaponmode 1', descriptionKey: 'cmd.pbWeaponmode' },

  { category: 'dangerous', command: 'restart', descriptionKey: 'cmd.restartDanger', danger: true },
  { category: 'dangerous', command: 'exec server.cfg', descriptionKey: 'cmd.execDanger', danger: true }
]

const commandCategories = {
  server: 'cmd.categoryServer',
  map: 'cmd.categoryMap',
  gameplay: 'cmd.categoryGameplay',
  messages: 'cmd.categoryMessages',
  amx: 'cmd.categoryAmx',
  podbod: 'cmd.categoryPodbod',
  dangerous: 'cmd.categoryDangerous'
}

const commandCard = document.getElementById('commandCard')
const logoutBtn = document.getElementById('logoutBtn')
const sendBtn = document.getElementById('sendBtn')
const rconStatus = document.getElementById('rconStatus')
const commandInput = document.getElementById('rconCommand')
const output = document.getElementById('rconOutput')
const historyList = document.getElementById('commandHistory')
const commandSearch = document.getElementById('commandSearch')
const commandReferenceContainer = document.getElementById('commandReference')
const livePlayersTbody = document.getElementById('livePlayers')

let commandHistory = []

// Neutraliza nomes de jogador dentro de comandos RCON (impede injeção via aspas/ponto-e-vírgula).
function rconSafeName(name) {
  return String(name ?? '')
    .replace(/"/g, "'")
    .replace(/[;\r\n]/g, ' ')
    .trim()
}

async function checkSession() {
  // A sessão já foi carregada pelo common.js (getCurrentUser/getCsrfToken).
  // Se não houver admin ativo, o guardPage() redirecionou para /login.
  if (!isActiveAdmin(getCurrentUser())) {
    if (output) output.textContent = ''
    if (rconStatus) rconStatus.textContent = i18nUtils.t('admin.disconnected')
    return
  }

  if (rconStatus) rconStatus.textContent = i18nUtils.t('admin.connected')
  startLivePlayers()
}

function addToHistory(command) {
  if (!command) return

  commandHistory = commandHistory.filter((c) => c !== command)
  commandHistory.unshift(command)

  if (commandHistory.length > 20) {
    commandHistory = commandHistory.slice(0, 20)
  }

  renderHistory()
}

function renderHistory() {
  historyList.innerHTML = ''

  commandHistory.forEach((cmd) => {
    const item = document.createElement('button')
    item.className = 'history-item'
    item.innerText = cmd
    item.onclick = () => {
      commandInput.value = cmd
      commandInput.focus()
    }
    historyList.appendChild(item)
  })
}

function renderCommandReference(filter = '') {
  const search = filter.trim().toLowerCase()
  commandReferenceContainer.innerHTML = ''

  const grouped = {}

  commandReference.forEach((item) => {
    const descText = i18nUtils.t(item.descriptionKey) || item.descriptionKey
    const matches =
      item.command.toLowerCase().includes(search) ||
      descText.toLowerCase().includes(search) ||
      i18nUtils.t(commandCategories[item.category]).toLowerCase().includes(search)

    if (!matches) return

    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  })

  Object.keys(grouped).forEach((category) => {
    const section = document.createElement('div')
    section.className = 'cmd-category'

    const title = document.createElement('h3')
    title.className = 'cmd-category-title'
    title.textContent = i18nUtils.t(commandCategories[category]) || category
    section.appendChild(title)

    const list = document.createElement('div')
    list.className = 'cmd-ref-list'

    grouped[category].forEach((item) => {
      const btn = document.createElement('button')
      btn.className = `cmd-ref-item${item.danger ? ' danger' : ''}`

      btn.innerHTML = `
        <div class="cmd-ref-top">
          <strong>${item.command}</strong>
          ${item.danger ? '<span class="danger-badge">Perigoso</span>' : ''}
        </div>
        <div class="cmd-ref-desc">${i18nUtils.t(item.descriptionKey)}</div>
      `

      btn.onclick = () => {
        if (item.danger) {
          const confirmed = window.confirm(`⚠️ ${i18nUtils.t(item.descriptionKey)} — ${item.command}?`)
          if (!confirmed) return
        }
        commandInput.value = item.command
        commandInput.focus()
      }

      list.appendChild(btn)
    })

    section.appendChild(list)
    commandReferenceContainer.appendChild(section)
  })
}

async function sendCommand(customCommand) {
  const command = (customCommand || commandInput.value).trim()

  if (!command) return

  output.textContent = `> ${command}\n\n${i18nUtils.t('errors.executing')}`

  try {
    const body = { command }
    const server = getSelectedServer()
    if (server) body.server = server

    const res = await fetch(`${API}/admin/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': getCsrfToken() || ''
      },
      credentials: 'include',
      body: JSON.stringify(body)
    })

    if (res.status === 401) {
      handleSessionExpired()
      return
    }

    const data = await res.json()

    if (!res.ok || !data.success) {
      output.textContent = data.error || i18nUtils.t('admin.errorExecute')
      return
    }

    addToHistory(command)
    output.textContent = `> ${data.command}\n\n${data.response || i18nUtils.t('errors.noReturnText')}`
    commandInput.value = ''
  } catch (err) {
    console.error(err)
    output.textContent = i18nUtils.t('admin.errorExecute')
  }
}

function handleSessionExpired() {
  stopLivePlayers()
  output.textContent = ''
  window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
}

async function logout() {
  try {
    await fetch(`${API}/admin/logout`, {
      method: 'POST',
      headers: {
        'x-csrf-token': getCsrfToken() || ''
      },
      credentials: 'include'
    })
  } catch (err) {
    console.error(err)
  }

  stopLivePlayers()
  commandHistory = []
  renderHistory()
  window.location.href = '/login'
}

let livePlayersTimer = null

function startLivePlayers() {
  stopLivePlayers()
  loadLivePlayers()
  livePlayersTimer = setInterval(loadLivePlayers, 5000)
}

function stopLivePlayers() {
  if (livePlayersTimer) {
    clearInterval(livePlayersTimer)
    livePlayersTimer = null
  }
}

async function loadLivePlayers() {
  if (!livePlayersTbody) return

  try {
    const data = await fetchJson(`/live/state${serverQuery()}`)
    const players = Array.isArray(data.players) ? data.players : []
    renderLivePlayers(players)
  } catch (err) {
    console.error('Erro ao carregar jogadores live:', err)
  }
}

function renderLivePlayers(players) {
  if (!livePlayersTbody) return

  if (!players.length) {
    livePlayersTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">${i18nUtils.t('labels.noPlayersThisTeam')}</td>
      </tr>
    `
    return
  }

  const fragment = document.createDocumentFragment()

  players
    .sort((a, b) => b.score - a.score)
    .forEach((p) => {
      const tr = document.createElement('tr')
      const name = escapeHtml(p.name)
      const steamidAttr = escapeHtml(p.steamid || '')
      const kd = (p.score / Math.max(p.deaths, 1)).toFixed(2)

      tr.innerHTML = `
        <td>${name}</td>
        <td title="${steamidAttr}">${steamidAttr || '-'}</td>
        <td>${p.team || '-'}</td>
        <td>${p.score} / ${p.deaths} (${kd})</td>
        <td>
          <button class="admin-live-btn" data-action="kick" data-name="${escapeHtml(p.name)}" title="${i18nUtils.t('admin.kick')}">${i18nUtils.t('admin.kick')}</button>
          <button class="admin-live-btn danger" data-action="ban" data-name="${escapeHtml(p.name)}" title="${i18nUtils.t('admin.ban')}">${i18nUtils.t('admin.ban')}</button>
        </td>
      `

      tr.querySelector('[data-action="kick"]').addEventListener('click', () => {
        sendCommand(`amx_kick "${rconSafeName(p.name)}"`)
      })

      tr.querySelector('[data-action="ban"]').addEventListener('click', () => {
        const confirmed = window.confirm(`⚠️ ${i18nUtils.t('admin.ban')}: ${p.name}? (30 min)`)
        if (!confirmed) return
        sendCommand(`amx_ban "${rconSafeName(p.name)}" 30`)
      })

      fragment.appendChild(tr)
    })

  livePlayersTbody.innerHTML = ''
  livePlayersTbody.appendChild(fragment)
}

logoutBtn.addEventListener('click', logout)
sendBtn.addEventListener('click', () => sendCommand())

document.addEventListener('server-change', () => {
  if (livePlayersTbody) loadLivePlayers()
})

commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCommand()
})

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.quick-cmd').forEach((btn) => {
    btn.addEventListener('click', () => {
      sendCommand(btn.dataset.cmd)
    })
  })

  commandSearch.addEventListener('input', (e) => {
    renderCommandReference(e.target.value)
  })

  checkSession()
  renderCommandReference()
})
