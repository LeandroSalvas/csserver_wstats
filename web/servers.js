// servers.js — Gerenciamento de servidores CS (admin).

const serversBody = document.getElementById('serversBody')
const serversStatus = document.getElementById('serversStatus')
const refreshBtn = document.getElementById('refreshBtn')
const addToggleBtn = document.getElementById('addToggleBtn')
const addForm = document.getElementById('addForm')
const addName = document.getElementById('addName')
const addSlots = document.getElementById('addSlots')
const addMap = document.getElementById('addMap')
const mapsList = document.getElementById('mapsList')
const addRotate = document.getElementById('addRotate')
const addServerBtn = document.getElementById('addServerBtn')
const cancelAddBtn = document.getElementById('cancelAddBtn')
const addStatus = document.getElementById('addStatus')

function t(key) {
  return i18nUtils.t(key)
}

function csrfHeaders() {
  return { 'x-csrf-token': getCsrfToken() || '' }
}

async function loadServers() {
  serversBody.innerHTML = ''
  showSkeletonRows(serversBody, 7, 3)
  serversStatus.textContent = t('serverManager.loading')

  try {
    const res = await fetch(`${API}/admin/servers`, { credentials: 'include', cache: 'no-store' })
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
      return
    }
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    renderServers(data.servers || [])
    serversStatus.textContent = ''
  } catch (err) {
    console.error(err)
    serversStatus.textContent = t('serverManager.actionError')
    showEmptyRow(serversBody, 7, t('serverManager.actionError'))
  }
}

function statusLabel(state) {
  if (state === 'running') return { text: t('serverManager.running'), cls: 'status-ok' }
  if (state === 'exited' || state === 'created' || state === 'restarting') return { text: t('serverManager.stopped'), cls: 'status-error' }
  return { text: t('serverManager.notFound'), cls: 'status-pending' }
}

function renderServers(servers) {
  if (!servers.length) {
    showEmptyRow(serversBody, 7, t('serverManager.noServers'))
    return
  }

  const fragment = document.createDocumentFragment()

  servers.forEach((s) => {
    const tr = document.createElement('tr')
    const st = statusLabel(s.containerState)
    const isRunning = s.containerState === 'running'

    const nameCell = document.createElement('td')
    const nameStrong = document.createElement('strong')
    nameStrong.textContent = s.name
    nameCell.appendChild(nameStrong)
    if (s.context) {
      const ctx = document.createElement('div')
      ctx.className = 'servers-context'
      ctx.textContent = `/${s.context}/`
      nameCell.appendChild(ctx)
    }
    if (s.id === 'main') {
      const badge = document.createElement('span')
      badge.className = 'danger-badge'
      badge.textContent = t('server.primary')
      nameCell.appendChild(badge)
    }

    const mapCell = document.createElement('td')
    mapCell.textContent = s.map || '-'

    const playersCell = document.createElement('td')
    playersCell.textContent = s.online ? (s.players != null ? `${s.players}/${s.maxplayers}` : '-') : '-'

    const slotsCell = document.createElement('td')
    slotsCell.textContent = s.maxplayers || '-'

    const portCell = document.createElement('td')
    portCell.textContent = s.hostPort || '-'

    const statusCell = document.createElement('td')
    const pill = document.createElement('span')
    pill.className = `status-pill ${st.cls}`
    pill.textContent = st.text
    if (s.containerStatus) pill.title = s.containerStatus
    statusCell.appendChild(pill)

    const actionsCell = document.createElement('td')
    const actionWrap = document.createElement('div')
    actionWrap.className = 'servers-actions'

    if (isRunning) {
      actionWrap.appendChild(makeActionBtn(t('serverManager.stop'), 'stop', s.id, 'danger', s.name))
      actionWrap.appendChild(makeActionBtn(t('serverManager.restart'), 'restart', s.id, '', s.name))
    } else {
      actionWrap.appendChild(makeActionBtn(t('serverManager.start'), 'start', s.id, '', s.name))
    }
    if (s.id !== 'main') {
      actionWrap.appendChild(makeActionBtn(t('serverManager.remove'), 'remove', s.id, 'danger', s.name, true))
    }
    actionsCell.appendChild(actionWrap)

    tr.append(nameCell, mapCell, playersCell, slotsCell, portCell, statusCell, actionsCell)
    fragment.appendChild(tr)
  })

  serversBody.innerHTML = ''
  serversBody.appendChild(fragment)
}

function makeActionBtn(label, action, id, cls = '', serverName = '', isRemove = false) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `admin-live-btn${cls ? ' ' + cls : ''}`
  btn.textContent = label
  btn.addEventListener('click', () => {
    if (isRemove) {
      const confirmed = window.confirm(t('serverManager.confirmRemove').replace('{name}', serverName))
      if (!confirmed) return
    }
    runServerAction(action, id)
  })
  return btn
}

async function runServerAction(action, id) {
  serversStatus.textContent = t('serverManager.provisioning')
  try {
    const res = await fetch(`${API}/admin/servers/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: csrfHeaders(),
      credentials: 'include'
    })
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
      return
    }
    const data = await res.json()
    if (!res.ok || !data.success) {
      serversStatus.textContent = data.error || t('serverManager.actionError')
      return
    }
    serversStatus.textContent = t('serverManager.actionOk')
    setTimeout(loadServers, 800)
  } catch (err) {
    console.error(err)
    serversStatus.textContent = t('serverManager.actionRestarting')
    setTimeout(loadServers, 800)
  }
}

async function loadMaps() {
  try {
    const res = await fetch(`${API}/admin/servers/maps`, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    mapsList.innerHTML = (data.maps || [])
      .slice(0, 200)
      .map((m) => `<option value="${escapeHtml(m)}"></option>`)
      .join('')
  } catch (err) {
    console.error('Erro ao carregar mapas:', err)
  }
}

function setAddBusy(busy) {
  addServerBtn.disabled = busy
  addServerBtn.textContent = busy ? t('serverManager.provisioning') : t('serverManager.addConfirm')
}

async function addServer() {
  addStatus.textContent = ''
  const name = addName.value.trim()
  const slots = parseInt(addSlots.value, 10)
  const map = addMap.value.trim() || 'de_dust2'

  if (!name) {
    addStatus.textContent = t('serverManager.addError')
    return
  }

  setAddBusy(true)
  try {
    const res = await fetch(`${API}/admin/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders()
      },
      credentials: 'include',
      body: JSON.stringify({ name, slots, map, rotate: addRotate.checked ? 'yes' : 'no' })
    })
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
      return
    }
    const data = await res.json()
    if (!res.ok || !data.success) {
      addStatus.textContent = data.error || t('serverManager.addError')
      return
    }
    addStatus.textContent = t('serverManager.addOk')
    addForm.hidden = true
    addToggleBtn.hidden = false
    addName.value = ''
    addMap.value = ''
    loadServers()
  } catch (err) {
    console.error(err)
    addStatus.textContent = t('serverManager.addProvisioning')
    addForm.hidden = true
    addToggleBtn.hidden = false
    loadServers()
  } finally {
    setAddBusy(false)
  }
}

refreshBtn.addEventListener('click', loadServers)
addToggleBtn.addEventListener('click', () => {
  addForm.hidden = !addForm.hidden
  addToggleBtn.hidden = !addForm.hidden
  if (!addForm.hidden) {
    addName.focus()
    loadMaps()
  }
})
cancelAddBtn.addEventListener('click', () => {
  addForm.hidden = true
  addToggleBtn.hidden = false
})
addServerBtn.addEventListener('click', addServer)
addMap.addEventListener('focus', loadMaps)

document.addEventListener('DOMContentLoaded', async () => {
  // Aguarda a sessão para que isActiveAdmin() veja o usuário logado de verdade
  // (senão o load é pulado e só o botão Atualizar carregava os dados).
  await window.authSessionPromise
  if (!isActiveAdmin(getCurrentUser())) return
  loadServers()
  loadMaps()
})
