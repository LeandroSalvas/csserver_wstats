const loginCard = document.getElementById("loginCard")
const commandCard = document.getElementById("commandCard")
const loginBtn = document.getElementById("loginBtn")
const logoutBtn = document.getElementById("logoutBtn")
const sendBtn = document.getElementById("sendBtn")
const loginStatus = document.getElementById("loginStatus")
const passwordInput = document.getElementById("rconPassword")
const commandInput = document.getElementById("rconCommand")
const output = document.getElementById("rconOutput")
const historyList = document.getElementById("commandHistory")
const commandSearch = document.getElementById("commandSearch")
const commandReferenceContainer = document.getElementById("commandReference")

let commandHistory = []

const commandReference = [
  { category: "Servidor", command: "status", description: "Mostra status do servidor" },
  { category: "Servidor", command: "users", description: "Lista jogadores conectados" },
  { category: "Servidor", command: "stats", description: "Mostra estatísticas básicas do servidor" },
  { category: "Servidor", command: "version", description: "Mostra versão do servidor" },
  { category: "Servidor", command: 'hostname "LeandroSalvas\'s Server"', description: "Altera o nome do servidor" },

  { category: "Mapa", command: "changelevel de_dust2", description: "Troca imediatamente para de_dust2" },
  { category: "Mapa", command: "changelevel de_inferno", description: "Troca imediatamente para de_inferno" },
  { category: "Mapa", command: "changelevel de_nuke", description: "Troca imediatamente para de_nuke" },
  { category: "Mapa", command: "map de_dust2", description: "Inicia o mapa de_dust2" },

  { category: "Gameplay", command: "mp_timelimit 20", description: "Tempo do mapa" },
  { category: "Gameplay", command: "mp_roundtime 3", description: "Tempo de round" },
  { category: "Gameplay", command: "mp_freezetime 3", description: "Freeze time" },
  { category: "Gameplay", command: "mp_buytime 0.5", description: "Tempo de compra" },
  { category: "Gameplay", command: "mp_startmoney 800", description: "Dinheiro inicial" },
  { category: "Gameplay", command: "mp_c4timer 35", description: "Tempo da bomba" },
  { category: "Gameplay", command: "mp_friendlyfire 0", description: "Liga/desliga friendly fire" },
  { category: "Gameplay", command: "mp_autoteambalance 1", description: "Balanceamento automático" },
  { category: "Gameplay", command: "mp_limitteams 2", description: "Limite de diferença entre times" },
  { category: "Gameplay", command: "sv_restart 1", description: "Reinicia a rodada" },

  { category: "Mensagens", command: "say Mensagem do servidor", description: "Mensagem no chat do servidor" },
  { category: "Mensagens", command: "echo Mensagem", description: "Mensagem no console" },

  { category: "AMX", command: "amx_map de_inferno", description: "Troca mapa via AMX" },
  { category: "AMX", command: "amx_say Mensagem do admin", description: "Mensagem global do admin" },
  { category: "AMX", command: "amx_csay Mensagem central", description: "Mensagem central na tela" },
  { category: "AMX", command: "amx_chat Mensagem para admins", description: "Chat entre admins" },
  { category: "AMX", command: "amx_kick nick motivo", description: "Kicka jogador" },
  { category: "AMX", command: "amx_ban nick 30 motivo", description: "Bane jogador por 30 min" },
  { category: "AMX", command: "amx_slap nick 0", description: "Dá slap em jogador" },
  { category: "AMX", command: "amx_slay nick", description: "Mata jogador" },
  { category: "AMX", command: "amx_who", description: "Lista admins online" },
  { category: "AMX", command: "amx_plugins", description: "Lista plugins carregados" },
  { category: "AMX", command: "amx_modules", description: "Lista módulos carregados" },
  { category: "AMX", command: "amx_reloadadmins", description: "Recarrega admins" },

  { category: "PodBod", command: "pb add 50", description: "Adiciona 1 bote com nível 50 de dificuldade" },
  { category: "PodBod", command: "pb remove <id>", description: "Remove o bot PodBod especificado" },
  { category: "PodBod", command: "pb removebots", description: "Remove todos os bots PodBod" },
  { category: "PodBod", command: "pb killbots", description: "Mata todos os bots PodBod" },
  { category: "PodBod", command: "pb fillserver", description: "Preenche o servidor com bots" },
  { category: "PodBod", command: "pb help", description: "Mostra a lista de comandos do PodBod" },
  { category: "PodBod", command: "pb weaponmode 1", description: "Define o modo de arma do PodBod" },
  

  //{ category: "Perigosos", command: "quit", description: "Encerra o servidor", danger: true },
  { category: "Perigosos", command: "restart", description: "Reinicia o servidor", danger: true },
  //{ category: "Perigosos", command: "sv_cheats 1", description: "Ativa cheats", danger: true },
  { category: "Perigosos", command: "exec server.cfg", description: "Executa arquivo de config", danger: true },
  //{ category: "Perigosos", command: "rcon_password nova_senha", description: "Altera a senha do RCON", danger: true }
]

async function checkSession() {
  try {
    const res = await fetch(`${API}/admin/session`, {
      credentials: "include"
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
  loginCard.style.display = "block"
  commandCard.style.display = "none"
}

function showConsole() {
  loginCard.style.display = "none"
  commandCard.style.display = "block"
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
  historyList.innerHTML = ""

  commandHistory.forEach((cmd) => {
    const item = document.createElement("button")
    item.className = "history-item"
    item.innerText = cmd
    item.onclick = () => {
      commandInput.value = cmd
      commandInput.focus()
    }
    historyList.appendChild(item)
  })
}

function renderCommandReference(filter = "") {
  const search = filter.trim().toLowerCase()
  commandReferenceContainer.innerHTML = ""

  const grouped = {}

  commandReference.forEach((item) => {
    const matches =
      item.command.toLowerCase().includes(search) ||
      item.description.toLowerCase().includes(search) ||
      item.category.toLowerCase().includes(search)

    if (!matches) return

    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  })

  Object.keys(grouped).forEach((category) => {
    const section = document.createElement("div")
    section.className = "cmd-category"

    const title = document.createElement("h3")
    title.className = "cmd-category-title"
    title.innerText = category
    section.appendChild(title)

    const list = document.createElement("div")
    list.className = "cmd-ref-list"

    grouped[category].forEach((item) => {
      const btn = document.createElement("button")
      btn.className = `cmd-ref-item${item.danger ? " danger" : ""}`

      btn.innerHTML = `
        <div class="cmd-ref-top">
          <strong>${item.command}</strong>
          ${item.danger ? '<span class="danger-badge">Perigoso</span>' : ""}
        </div>
        <div class="cmd-ref-desc">${item.description}</div>
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
    loginStatus.innerText = "Informe a senha RCON."
    return
  }

  loginStatus.innerText = "Conectando..."

  try {
    const res = await fetch(`${API}/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ password })
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      loginStatus.innerText = data.error || "Falha ao autenticar."
      return
    }

    loginStatus.innerText = "Autenticado com sucesso."
    showConsole()
    renderCommandReference()
    output.textContent = data.response || "Conectado."
    passwordInput.value = ""
  } catch (err) {
    console.error(err)
    loginStatus.innerText = "Erro ao autenticar."
  }
}

async function sendCommand(customCommand) {
  const command = (customCommand || commandInput.value).trim()

  if (!command) return

  output.textContent = `> ${command}\n\nExecutando...`

  try {
    const res = await fetch(`${API}/admin/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ command })
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      output.textContent = data.error || "Falha ao executar comando."
      return
    }

    addToHistory(command)
    output.textContent = `> ${data.command}\n\n${data.response || "(sem retorno textual)"}`
    commandInput.value = ""
  } catch (err) {
    console.error(err)
    output.textContent = "Erro ao executar comando."
  }
}

async function logout() {
  try {
    await fetch(`${API}/admin/logout`, {
      method: "POST",
      credentials: "include"
    })
  } catch (err) {
    console.error(err)
  }

  output.textContent = ""
  loginStatus.innerText = ""
  commandHistory = []
  renderHistory()
  showLogin()
}

loginBtn.addEventListener("click", login)
logoutBtn.addEventListener("click", logout)
sendBtn.addEventListener("click", () => sendCommand())

passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login()
})

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendCommand()
})

document.querySelectorAll(".quick-cmd").forEach((btn) => {
  btn.addEventListener("click", () => {
    sendCommand(btn.dataset.cmd)
  })
})

commandSearch.addEventListener("input", (e) => {
  renderCommandReference(e.target.value)
})

checkSession()
renderCommandReference()
