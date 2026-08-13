const urlParams = new URLSearchParams(window.location.search)
const PAGE_SIZE = 20
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

let currentPeriod = urlParams.get('period') === 'monthly' ? 'monthly' : 'weekly'
let customFrom = ''
let customTo = ''

if (urlParams.get('period') === 'custom') {
  const urlFrom = urlParams.get('from')
  const urlTo = urlParams.get('to')
  if (DATE_RE.test(urlFrom) && DATE_RE.test(urlTo) && urlFrom <= urlTo) {
    currentPeriod = 'custom'
    customFrom = urlFrom
    customTo = urlTo
  }
}

let currentPage = Math.max(1, Number.parseInt(urlParams.get('page') || '1', 10) || 1)

// --- Calendário (período customizado) ---
let calYear = 0
let calMonth = 0
let pendingFrom = ''
let pendingTo = ''

function langTag() {
  return i18nUtils.currentLang === 'pt' ? 'pt-BR' : 'en'
}

function dateFromStr(s) {
  return new Date(`${s}T00:00:00`)
}

function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayStr() {
  return toDateStr(new Date())
}

function addDaysStr(s, days) {
  const d = dateFromStr(s)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

function fmtDate(s) {
  if (!DATE_RE.test(s)) return ''
  return dateFromStr(s).toLocaleDateString(langTag(), { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtRange(from, to) {
  if (!from || !to) return ''
  return `${fmtDate(from)} – ${fmtDate(to)}`
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(month, year) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function dateToInput(s) {
  if (!DATE_RE.test(s)) return ''
  return `${s.slice(8)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

function parseInputDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim())
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(month, year)) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function maskDateInput(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 8)
  if (digits.length > 4) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return digits
}

function syncInputsFromPending() {
  const f = document.getElementById('periodFrom')
  const t = document.getElementById('periodTo')
  if (f) { f.value = pendingFrom ? dateToInput(pendingFrom) : ''; f.classList.remove('is-invalid') }
  if (t) { t.value = pendingTo ? dateToInput(pendingTo) : ''; t.classList.remove('is-invalid') }
}

function syncInputsFromCommitted() {
  const f = document.getElementById('periodFrom')
  const t = document.getElementById('periodTo')
  if (f) f.value = customFrom ? dateToInput(customFrom) : ''
  if (t) t.value = customTo ? dateToInput(customTo) : ''
}

function handleDateInputChange() {
  const f = document.getElementById('periodFrom')
  const t = document.getElementById('periodTo')
  const fromInput = parseInputDate(f.value)
  const toInput = parseInputDate(t.value)
  const today = todayStr()
  let invalid = false

  if (f.value.trim() && !fromInput) { f.classList.add('is-invalid'); invalid = true }
  if (t.value.trim() && !toInput) { t.classList.add('is-invalid'); invalid = true }
  if (invalid) {
    setStatus(i18nUtils.t('labels.invalidRange'), 'error')
    return
  }

  if (fromInput && toInput) {
    if (fromInput > toInput) {
      f.classList.add('is-invalid')
      t.classList.add('is-invalid')
      setStatus(i18nUtils.t('labels.invalidRange'), 'error')
      return
    }
    if (toInput > today) {
      t.classList.add('is-invalid')
      setStatus(i18nUtils.t('labels.invalidRange'), 'error')
      return
    }
    pendingFrom = fromInput
    pendingTo = toInput
    customFrom = fromInput
    customTo = toInput
    currentPeriod = 'custom'
    currentPage = 1
    setActivePeriod('custom')
    updateUrl()
    renderCalendar()
    updateRangeLabel()
    loadRanking(currentPeriod, currentPage)
    return
  }

  if (fromInput) {
    pendingFrom = fromInput
    if (!pendingTo || pendingTo < pendingFrom) pendingTo = ''
  } else if (toInput) {
    pendingTo = toInput
    if (!pendingFrom || pendingFrom > pendingTo) pendingFrom = ''
  }
  renderCalendar()
  updateRangeLabel()
}

function clearPendingSelection() {
  pendingFrom = ''
  pendingTo = ''
  syncInputsFromPending()
  renderCalendar()
  updateRangeLabel()
}

function updateUrl() {
  const url = new URL(window.location.href)
  if (currentPeriod === 'custom') {
    url.searchParams.set('period', 'custom')
    if (customFrom) url.searchParams.set('from', customFrom)
    else url.searchParams.delete('from')
    if (customTo) url.searchParams.set('to', customTo)
    else url.searchParams.delete('to')
  } else {
    url.searchParams.delete('period')
    url.searchParams.delete('from')
    url.searchParams.delete('to')
  }
  if (currentPage > 1) url.searchParams.set('page', String(currentPage))
  else url.searchParams.delete('page')
  window.history.replaceState(null, '', url.toString())
}

async function loadRanking(period, page = 1) {
  const title = document.getElementById('rankingTitle')
  const table = document.getElementById('rankingTable')
  const pageInfo = document.getElementById('pageInfo')

  setStatus(i18nUtils.t('status.loadingRanking'))
  showSkeletonRows(table, 7, 4)

  try {
    const isCustom = period === 'custom'
    const url = isCustom
      ? `/ranking/period?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}&limit=${PAGE_SIZE}&page=${page}${serverParam()}`
      : `/ranking/${period}?limit=${PAGE_SIZE}&page=${page}${serverParam()}`
    const players = await fetchJson(url)

    if (isCustom) {
      title.innerText = `${i18nUtils.t('labels.ranking')}: ${fmtRange(customFrom, customTo)}`
    } else {
      title.innerText = period === 'weekly'
        ? i18nUtils.t('labels.rankingWeekly')
        : i18nUtils.t('labels.rankingMonthly')
    }
    clearStatus()

    if (pageInfo) pageInfo.textContent = page
    updatePagination(players.length >= PAGE_SIZE, page)

    if (!Array.isArray(players) || players.length === 0) {
      showEmptyRow(table)
      return
    }

    renderRows(table, players, (p, i) => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${(page - 1) * PAGE_SIZE + i + 1}</td>
        <td><a href="/jogador/${encodeURIComponent(p.steamid)}">${escapeHtml(p.name)}</a></td>
        <td>${p.kills}</td>
        <td>${p.deaths}</td>
        <td>${p.hs}</td>
        <td>${p.kd}</td>
        <td>${p.skill}</td>
      `
      return row
    })
    animateTableUpdate(table)
  } catch (err) {
    console.error('Erro ao carregar ranking:', err)
    setStatus(`${i18nUtils.t('errors.loadRanking')}: ${err.message}`, 'error')
    showEmptyRow(table)
  }
}

function updatePagination(hasMore, page) {
  const btnPrev = document.getElementById('btnPrev')
  const btnNext = document.getElementById('btnNext')
  if (btnPrev) btnPrev.disabled = page <= 1
  if (btnNext) btnNext.disabled = !hasMore
}

function setActivePeriod(period) {
  const btnWeekly = document.getElementById('btnWeekly')
  const btnMonthly = document.getElementById('btnMonthly')
  const btnPeriod = document.getElementById('btnPeriod')
  btnWeekly.classList.toggle('active', period === 'weekly')
  btnMonthly.classList.toggle('active', period === 'monthly')
  btnPeriod.classList.toggle('active', period === 'custom')
  btnWeekly.setAttribute('aria-pressed', period === 'weekly' ? 'true' : 'false')
  btnMonthly.setAttribute('aria-pressed', period === 'monthly' ? 'true' : 'false')
  btnPeriod.setAttribute('aria-pressed', period === 'custom' ? 'true' : 'false')
}

// --- Calendário: grid + seleção de intervalo ---

function openPopover() {
  const popover = document.getElementById('periodPopover')
  if (currentPeriod === 'custom') {
    pendingFrom = customFrom
    pendingTo = customTo
  }
  const anchor = pendingFrom ? dateFromStr(pendingFrom) : new Date()
  calYear = anchor.getFullYear()
  calMonth = anchor.getMonth()
  renderCalendar()
  updateRangeLabel()
  popover.hidden = false
}

function closePopover() {
  const popover = document.getElementById('periodPopover')
  popover.hidden = true
}

function togglePopover() {
  const popover = document.getElementById('periodPopover')
  if (popover.hidden) openPopover()
  else closePopover()
}

function renderCalendar() {
  const label = document.getElementById('calMonthLabel')
  const weekdays = document.getElementById('calWeekdays')
  const grid = document.getElementById('calGrid')
  const lang = langTag()

  label.textContent = new Date(calYear, calMonth, 1).toLocaleString(lang, { month: 'long', year: 'numeric' })

  const wkStart = new Date(2026, 0, 4)
  weekdays.innerHTML = ''
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(wkStart)
    d.setDate(wkStart.getDate() + i)
    const el = document.createElement('div')
    el.className = 'cal-wd'
    el.textContent = d.toLocaleDateString(lang, { weekday: 'narrow' })
    weekdays.appendChild(el)
  }

  grid.innerHTML = ''
  const firstOffset = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const today = todayStr()
  const futureStr = today

  for (let i = 0; i < firstOffset; i += 1) {
    const el = document.createElement('div')
    el.className = 'cal-day cal-empty'
    grid.appendChild(el)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'cal-day'
    el.textContent = String(day)
    el.dataset.date = dateStr

    if (dateStr === today) el.classList.add('is-today')
    if (dateStr > futureStr) el.classList.add('is-disabled')
    if (dateStr === pendingFrom || dateStr === pendingTo) el.classList.add('is-selected')
    if (pendingFrom && pendingTo && dateStr > pendingFrom && dateStr < pendingTo) el.classList.add('is-range')

    el.addEventListener('click', () => {
      if (el.classList.contains('is-disabled')) return
      handleDayClick(dateStr)
    })
    grid.appendChild(el)
  }
}

function handleDayClick(dateStr) {
  if (!pendingFrom || (pendingFrom && pendingTo)) {
    pendingFrom = dateStr
    pendingTo = ''
  } else if (dateStr < pendingFrom) {
    pendingTo = pendingFrom
    pendingFrom = dateStr
  } else {
    pendingTo = dateStr
  }
  renderCalendar()
  updateRangeLabel()
  syncInputsFromPending()
}

function setPendingRange(from, to) {
  pendingFrom = from
  pendingTo = to
  const anchor = dateFromStr(from)
  calYear = anchor.getFullYear()
  calMonth = anchor.getMonth()
  renderCalendar()
  updateRangeLabel()
  syncInputsFromPending()
}

function updateRangeLabel() {
  const el = document.getElementById('calRangeLabel')
  if (pendingFrom && pendingTo) {
    el.textContent = `${i18nUtils.t('labels.from')} ${fmtDate(pendingFrom)} ${i18nUtils.t('labels.to')} ${fmtDate(pendingTo)}`
  } else if (pendingFrom) {
    el.textContent = `${i18nUtils.t('labels.from')} ${fmtDate(pendingFrom)}`
  } else {
    el.textContent = ''
  }
}

function applyPeriod() {
  if (!pendingFrom || !pendingTo) {
    setStatus(i18nUtils.t('labels.invalidRange'), 'error')
    return
  }
  customFrom = pendingFrom
  customTo = pendingTo
  currentPeriod = 'custom'
  currentPage = 1
  setActivePeriod(currentPeriod)
  updateUrl()
  syncInputsFromPending()
  closePopover()
  loadRanking(currentPeriod, currentPage)
}

function clearPending() {
  clearPendingSelection()
}

document.addEventListener('DOMContentLoaded', () => {
  const btnWeekly = document.getElementById('btnWeekly')
  const btnMonthly = document.getElementById('btnMonthly')
  const btnPeriod = document.getElementById('btnPeriod')
  const btnPrev = document.getElementById('btnPrev')
  const btnNext = document.getElementById('btnNext')

  if (btnWeekly) btnWeekly.addEventListener('click', () => {
    currentPeriod = 'weekly'
    currentPage = 1
    setActivePeriod(currentPeriod)
    updateUrl()
    clearPendingSelection()
    loadRanking(currentPeriod, currentPage)
  })
  if (btnMonthly) btnMonthly.addEventListener('click', () => {
    currentPeriod = 'monthly'
    currentPage = 1
    setActivePeriod(currentPeriod)
    updateUrl()
    clearPendingSelection()
    loadRanking(currentPeriod, currentPage)
  })
  if (btnPrev) btnPrev.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage -= 1
      updateUrl()
      loadRanking(currentPeriod, currentPage)
    }
  })
  if (btnNext) btnNext.addEventListener('click', () => {
    currentPage += 1
    updateUrl()
    loadRanking(currentPeriod, currentPage)
  })

  const btnExportCsv = document.getElementById('btnExportCsv')
  if (btnExportCsv) btnExportCsv.addEventListener('click', () => {
    const filename = currentPeriod === 'custom'
      ? `ranking-custom-${customFrom}-${customTo}-p${currentPage}.csv`
      : `ranking-${currentPeriod}-p${currentPage}.csv`
    exportTableCsv(document.getElementById('rankingTable'), filename)
  })

  // Calendário
  if (btnPeriod) {
    btnPeriod.addEventListener('click', togglePopover)
    document.getElementById('btnPeriodApply').addEventListener('click', applyPeriod)
    document.getElementById('btnPeriodClear').addEventListener('click', clearPending)
    document.getElementById('calPrev').addEventListener('click', () => {
      calMonth -= 1
      if (calMonth < 0) { calMonth = 11; calYear -= 1 }
      renderCalendar()
    })
    document.getElementById('calNext').addEventListener('click', () => {
      calMonth += 1
      if (calMonth > 11) { calMonth = 0; calYear += 1 }
      renderCalendar()
    })
    document.querySelectorAll('.period-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = Number.parseInt(btn.dataset.days, 10) || 7
        setPendingRange(addDaysStr(todayStr(), -(days - 1)), todayStr())
      })
    })
    // Captura: verifica a contenção antes de o handler do dia re-renderizar o
    // grid e desanexar o elemento clicado do DOM (senão todo clique num dia
    // pareceria "clique fora" e fecharia o popover).
    document.addEventListener('click', (e) => {
      const picker = document.querySelector('.period-picker')
      if (picker && !picker.contains(e.target)) closePopover()
    }, true)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePopover()
    })
  }

  // Campos de data (máscara DD/MM/AAAA + regras de mês/dia/ano bissexto)
  const periodFrom = document.getElementById('periodFrom')
  const periodTo = document.getElementById('periodTo')
  if (periodFrom && periodTo) {
    ;[periodFrom, periodTo].forEach((el) => {
      el.addEventListener('input', () => {
        const masked = maskDateInput(el.value)
        if (masked !== el.value) el.value = masked
        el.classList.remove('is-invalid')
      })
      el.addEventListener('change', handleDateInputChange)
    })
    if (currentPeriod === 'custom') {
      syncInputsFromCommitted()
      pendingFrom = customFrom
      pendingTo = customTo
    }
  }

  setActivePeriod(currentPeriod)
  loadRanking(currentPeriod, currentPage)
})

document.addEventListener('server-change', () => {
  currentPage = 1
  updateUrl()
  loadRanking(currentPeriod, currentPage)
})
