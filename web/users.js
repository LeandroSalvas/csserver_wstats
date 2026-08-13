// users.js — Gestão de administradores e aprovações (somente superadmin).

const usersBody = document.getElementById('usersBody')
const usersStatus = document.getElementById('usersStatus')
const refreshBtn = document.getElementById('refreshBtn')

function t(key) {
  return i18nUtils.t(key)
}

function csrfHeaders() {
  return { 'x-csrf-token': getCsrfToken() || '' }
}

const STATUS_KEYS = {
  active: 'adminUsers.statusActive',
  pending: 'adminUsers.statusPending',
  rejected: 'adminUsers.statusRejected',
  disabled: 'adminUsers.statusDisabled'
}

const STATUS_CLASSES = {
  active: 'status-ok',
  pending: 'status-pending',
  rejected: 'status-error',
  disabled: 'status-error'
}

const PROVIDER_KEYS = {
  local: 'adminUsers.providerLocal',
  steam: 'adminUsers.providerSteam',
  google: 'adminUsers.providerGoogle'
}

function fmtDate(value) {
  if (!value) return t('adminUsers.never')
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return t('adminUsers.never')
  return d.toLocaleString()
}

async function loadUsers() {
  usersBody.innerHTML = ''
  showSkeletonRows(usersBody, 7, 3)
  usersStatus.textContent = t('status.loading')

  try {
    const res = await fetch(`${API}/admin/users`, { credentials: 'include', cache: 'no-store' })
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
      return
    }
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    renderUsers(data.users || [])
    usersStatus.textContent = ''
  } catch (err) {
    console.error(err)
    usersStatus.textContent = t('adminUsers.error')
    showEmptyRow(usersBody, 7, t('adminUsers.error'))
  }
}

function renderUsers(users) {
  if (!users.length) {
    showEmptyRow(usersBody, 7, t('adminUsers.empty'))
    return
  }

  const fragment = document.createDocumentFragment()
  const me = getCurrentUser()

  users.forEach((u) => {
    const tr = document.createElement('tr')
    const isMe = me && me.id === u.id

    const userCell = document.createElement('td')
    const nameWrap = document.createElement('div')
    nameWrap.className = 'users-name'
    if (u.avatar_url) {
      const img = document.createElement('img')
      img.className = 'users-avatar'
      img.src = u.avatar_url
      img.alt = ''
      img.referrerPolicy = 'no-referrer'
      nameWrap.appendChild(img)
    }
    const nameStrong = document.createElement('strong')
    nameStrong.textContent = u.display_name || u.username || u.provider_id || String(u.id)
    nameWrap.appendChild(nameStrong)
    userCell.appendChild(nameWrap)
    if (isMe) {
      const meBadge = document.createElement('span')
      meBadge.className = 'danger-badge'
      meBadge.textContent = 'você'
      userCell.appendChild(meBadge)
    }

    const providerCell = document.createElement('td')
    providerCell.textContent = t(PROVIDER_KEYS[u.provider] || u.provider)

    const emailCell = document.createElement('td')
    emailCell.textContent = u.email || '-'

    const roleCell = document.createElement('td')
    const roleSelect = document.createElement('select')
    roleSelect.className = 'server-selector'
    ;['admin', 'superadmin'].forEach((role) => {
      const opt = document.createElement('option')
      opt.value = role
      opt.textContent = role === 'superadmin' ? 'Superadmin' : 'Admin'
      opt.selected = u.role === role
      roleSelect.appendChild(opt)
    })
    roleSelect.disabled = isMe
    roleSelect.addEventListener('change', () => runUserAction('role', u.id, { role: roleSelect.value }))
    roleCell.appendChild(roleSelect)

    const statusCell = document.createElement('td')
    const pill = document.createElement('span')
    pill.className = `status-pill ${STATUS_CLASSES[u.status] || 'status-pending'}`
    pill.textContent = t(STATUS_KEYS[u.status] || u.status)
    statusCell.appendChild(pill)

    const lastLoginCell = document.createElement('td')
    lastLoginCell.textContent = fmtDate(u.last_login_at)

    const actionsCell = document.createElement('td')
    const actionWrap = document.createElement('div')
    actionWrap.className = 'servers-actions'

    if (u.status === 'pending') {
      actionWrap.appendChild(makeActionBtn(t('adminUsers.approve'), 'approve', u.id))
      actionWrap.appendChild(makeActionBtn(t('adminUsers.reject'), 'reject', u.id, 'danger'))
    } else if (u.status === 'rejected' || u.status === 'disabled') {
      actionWrap.appendChild(makeActionBtn(t('adminUsers.approve'), 'approve', u.id))
    }

    if (!isMe) {
      actionWrap.appendChild(makeActionBtn(t('adminUsers.remove'), 'remove', u.id, 'danger', true, u.display_name || u.username || u.id))
    }

    actionsCell.appendChild(actionWrap)

    tr.append(userCell, providerCell, emailCell, roleCell, statusCell, lastLoginCell, actionsCell)
    fragment.appendChild(tr)
  })

  usersBody.innerHTML = ''
  usersBody.appendChild(fragment)
}

function makeActionBtn(label, action, id, cls = '', isRemove = false, name = '') {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `admin-live-btn${cls ? ' ' + cls : ''}`
  btn.textContent = label
  btn.addEventListener('click', () => {
    if (isRemove) {
      const confirmed = window.confirm(t('adminUsers.removeConfirm').replace('{name}', name))
      if (!confirmed) return
    }
    runUserAction(action, id)
  })
  return btn
}

async function runUserAction(action, id, extra) {
  usersStatus.textContent = ''
  try {
    let res
    if (action === 'remove') {
      res = await fetch(`${API}/admin/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: csrfHeaders(),
        credentials: 'include'
      })
    } else {
      res = await fetch(`${API}/admin/users/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        credentials: 'include',
        body: JSON.stringify(extra || {})
      })
    }
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/login?next=' + encodeURIComponent(window.location.pathname))
      return
    }
    const data = await res.json()
    if (!res.ok || !data.success) {
      usersStatus.textContent = data.error || t('adminUsers.error')
      return
    }
    usersStatus.textContent = action === 'approve'
      ? t('adminUsers.approveOk')
      : action === 'reject'
        ? t('adminUsers.rejectOk')
        : action === 'role'
          ? t('adminUsers.roleOk')
          : t('adminUsers.removeOk')
    loadUsers()
  } catch (err) {
    console.error(err)
    usersStatus.textContent = t('adminUsers.error')
  }
}

refreshBtn.addEventListener('click', loadUsers)

document.addEventListener('DOMContentLoaded', () => {
  if (!isActiveAdmin(getCurrentUser())) return
  loadUsers()
})
