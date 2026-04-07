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

const loginCard = document.getElementById('loginCard')
const commandCard = document.getElementById('commandCard')
const loginBtn = document.getElementById('loginBtn')
const logoutBtn = document.getElementById('logoutBtn')
const sendBtn = document.getElementById('sendBtn')
const loginStatus = document.getElementById('loginStatus')
const passwordInput = document.getElementById('rconPassword')
const commandInput = document.getElementById('rconCommand')
const output = document.getElementById('rconOutput')
const historyList = document.getElementById('commandHistory')
const commandSearch = document.getElementById('commandSearch')
const commandReferenceContainer = document.getElementById('commandReference')

let commandHistory = []

async function checkSession() {
  try {
    const res = await fetch(`${API}/admin/session`, {
      credentials: 'include'
    })
    const data = await res.json()

    if (data.authenticated) {
      showConsole()
    } else {
      showLogin()
    }
  } catch (err) {
    console.error(err)
    showLogin()
  }
}

function showLogin() {
  loginCard.style.display = 'block'
  commandCard.style.display = 'none'
}

function showConsole() {
  loginCard.style.display = 'none'
  commandCard.style.display = 'block'
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
        commandInput.value = item.command
        commandInput.focus()
      }

      list.appendChild(btn)
    })

    section.appendChild(list)
    commandReferenceContainer.appendChild(section)
  })
}

async function login() {
  const password = passwordInput.value.trim()

  if (!password) {
    loginStatus.innerText = i18nUtils.t('errors.passwordRequired')
    return
  }

  loginStatus.innerText = i18nUtils.t('admin.connecting')

  try {
    const res = await fetch(`${API}/admin/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ password })
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      loginStatus.innerText = data.error || i18nUtils.t('admin.errorAuth')
      return
    }

    loginStatus.innerText = i18nUtils.t('admin.authSuccess')
    showConsole()
    renderCommandReference()
    output.textContent = data.response || i18nUtils.t('errors.noReturnText')
    passwordInput.value = ''
  } catch (err) {
    console.error(err)
    loginStatus.innerText = i18nUtils.t('admin.errorAuth')
  }
}

async function sendCommand(customCommand) {
  const command = (customCommand || commandInput.value).trim()

  if (!command) return

  output.textContent = `> ${command}\n\n${i18nUtils.t('errors.executing')}`

  try {
    const res = await fetch(`${API}/admin/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ command })
    })

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

async function logout() {
  try {
    await fetch(`${API}/admin/logout`, {
      method: 'POST',
      credentials: 'include'
    })
  } catch (err) {
    console.error(err)
  }

  output.textContent = ''
  loginStatus.innerText = ''
  commandHistory = []
  renderHistory()
  showLogin()
}

loginBtn.addEventListener('click', login)
logoutBtn.addEventListener('click', logout)
sendBtn.addEventListener('click', () => sendCommand())

passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login()
})

commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCommand()
})

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
