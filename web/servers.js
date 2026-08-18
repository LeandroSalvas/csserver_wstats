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
const addCstv = document.getElementById('addCstv')
const addMode = document.getElementById('addMode')
const addServerBtn = document.getElementById('addServerBtn')
const cancelAddBtn = document.getElementById('cancelAddBtn')
const addStatus = document.getElementById('addStatus')

let actionInProgress = false

function t(key) {
  return i18nUtils.t(key)
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function csrfHeaders() {
  return { 'x-csrf-token': getCsrfToken() || '' }
}

function statusHtml(text) {
  return `<span class="spinner"></span>${escapeHtml(text)}`
}

function setAllButtonsDisabled(disabled) {
  serversBody.querySelectorAll('.admin-live-btn').forEach((btn) => {
    btn.disabled = disabled
  })
}

async function loadServers(silent = false) {
  serversBody.innerHTML = ''
  if (!silent) {
    showSkeletonRows(serversBody, 8, 3)
    serversStatus.textContent = t('serverManager.loading')
  }

  try {
    const res = await fetch(`${API}/admin/servers`, { credentials: 'include', cache: 'no-store' })
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
      return false
    }
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    renderServers(data.servers || [])
    serversStatus.textContent = ''
    return true
  } catch (err) {
    console.error(err)
    if (!silent) {
      serversStatus.textContent = t('serverManager.actionError')
    }
    return false
  }
}

function pollLoadServers(maxTries = 30, onGiveUp) {
  let tries = 0
  serversStatus.innerHTML = statusHtml(t('serverManager.actionWait'))
  const attempt = async () => {
    if (await loadServers(true)) return
    tries += 1
    if (tries >= maxTries) {
      if (onGiveUp) onGiveUp()
      return
    }
    serversStatus.innerHTML = statusHtml(t('serverManager.actionWait'))
    window.setTimeout(attempt, 3000)
  }
  attempt()
}

function statusLabel(state) {
  if (state === 'running') return { text: t('serverManager.running'), cls: 'status-ok' }
  if (state === 'exited' || state === 'created' || state === 'restarting') return { text: t('serverManager.stopped'), cls: 'status-error' }
  return { text: t('serverManager.notFound'), cls: 'status-pending' }
}

function renderServers(servers) {
  if (!servers.length) {
    showEmptyRow(serversBody, 8, t('serverManager.noServers'))
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
    playersCell.textContent = s.online ? (s.players != null ? s.players : '-') : '-'

    const slotsCell = document.createElement('td')
    slotsCell.textContent = s.maxplayers || '-'

    const modeCell = document.createElement('td')
    const modeLabel = t(`serverManager.mode${capitalize(s.mode || 'standard')}`)
    modeCell.textContent = modeLabel || s.mode || 'standard'

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

    tr.append(nameCell, mapCell, playersCell, slotsCell, modeCell, portCell, statusCell, actionsCell)
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

function actionMessage(action) {
  const map = {
    start: 'serverManager.actionStart',
    stop: 'serverManager.actionStop',
    restart: 'serverManager.actionRestart',
    remove: 'serverManager.actionRemove'
  }
  return t(map[action] || 'serverManager.provisioning')
}

async function runServerAction(action, id) {
  if (actionInProgress) return
  actionInProgress = true

  serversStatus.innerHTML = statusHtml(actionMessage(action))
  setAllButtonsDisabled(true)

  try {
    const isRemove = action === 'remove'
    const url = isRemove
      ? `${API}/admin/servers/${encodeURIComponent(id)}`
      : `${API}/admin/servers/${encodeURIComponent(id)}/${action}`
    const res = await fetch(url, {
      method: isRemove ? 'DELETE' : 'POST',
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
    if (isRemove) {
      showSkeletonRows(serversBody, 8, 3)
    }
    setTimeout(loadServers, 800)
  } catch (err) {
    console.error(err)
    showSkeletonRows(serversBody, 8, 3)
    pollLoadServers(30, () => { serversStatus.textContent = t('serverManager.actionError') })
  } finally {
    actionInProgress = false
    setAllButtonsDisabled(false)
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
  addName.disabled = busy
  addSlots.disabled = busy
  addMap.disabled = busy
  addRotate.disabled = busy
  addCstv.disabled = busy
  addMode.disabled = busy
  cancelAddBtn.disabled = busy
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
      body: JSON.stringify({ name, slots, map, rotate: addRotate.checked ? 'yes' : 'no', cstv: addCstv.checked, mode: addMode.value })
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
    pollLoadServers(30, () => {
      addStatus.textContent = t('serverManager.actionError')
    })
  } finally {
    setAddBusy(false)
  }
}

refreshBtn.addEventListener('click', async () => {
  if (!(await loadServers())) {
    serversStatus.textContent = t('serverManager.actionError')
  }
})
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

addMode.addEventListener('change', () => {
  const isZombies = addMode.value === 'zombies'
  if (isZombies) addCstv.checked = false
  addCstv.disabled = isZombies
  const hint = document.getElementById('addCstvHint')
  if (hint) hint.style.display = isZombies ? '' : 'none'
})

document.addEventListener('DOMContentLoaded', async () => {
  await window.authSessionPromise
  if (!isActiveAdmin(getCurrentUser())) return
  loadServers()
  loadMaps()
})
