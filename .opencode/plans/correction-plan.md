# Plano de Correção — CS Server Stats

Gerado em: 2026-04-30
Total de correções: 35

---

## 1. `api/index.js` — Correções Múltiplas

### 1.1 Adicionar CORS middleware (Fix #4)

**Substituir linhas 1-12 por:**
```javascript
const express = require('express')
const mysql = require('mysql2/promise')
const session = require('express-session')
const { createClient } = require('redis')
const { RedisStore } = require('connect-redis')
const rateLimit = require('express-rate-limit')
const crypto = require('crypto')
const Rcon = require('rcon')
const fs = require('fs')
const cors = require('cors')

const app = express()
app.use(express.json())

const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:8080', 'http://192.168.15.54:8080']

app.use(cors({
  origin: corsOrigins,
  credentials: true
}))
```

### 1.2 Simplificar connect-redis resolution (Fix #30)

**Substituir linhas 68-78 por:**
```javascript
if (sessionStoreType === 'redis') {
```

### 1.3 Validar session secret (Fix #8)

**Substituir linha 66 por:**
```javascript
const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  console.error('SESSION_SECRET não configurado. Defina uma string longa e aleatória.')
  process.exit(1)
}
```

### 1.4 Secure cookie baseado no ambiente (Fix #7)

**Substituir `secure: false` (linhas 113 e 125) por:**
```javascript
secure: process.env.NODE_ENV === 'production',
```
(Ambos os blocos de session — Redis e fallback)

### 1.5 Environment vars para Gamedig (Fix #11)

**Substituir `getCurrentMap()` (linhas 137-156):**
```javascript
const GAMEDIG_HOST = process.env.GAMEDIG_HOST || 'cs16'
const GAMEDIG_PORT = parseInt(process.env.GAMEDIG_PORT || '27015', 10)

async function getCurrentMap() {
  try {
    const state = await Gamedig.query({
      type: 'cs16',
      host: GAMEDIG_HOST,
      port: GAMEDIG_PORT
    })
    return state.map
  } catch (err) {
    console.error('Erro ao obter mapa:', err.message)
    return 'unknown'
  }
}
```

**Substituir rota `/server` (linhas 691-719):**
```javascript
app.get('/server', async (req, res) => {
  try {
    const state = await Gamedig.query({
      type: 'cs16',
      host: GAMEDIG_HOST,
      port: GAMEDIG_PORT
    })
    res.json({
      map: state.map,
      players: state.players.length,
      maxplayers: state.maxplayers,
      hostname: state.name
    })
  } catch (err) {
    res.json({
      map: 'unknown',
      players: 0,
      maxplayers: 0,
      hostname: 'offline'
    })
  }
})
```

### 1.6 Try/catch em `/map/:map` (Fix #1)

**Substituir linhas 511-530:**
```javascript
app.get('/map/:map', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        name,
        steamid,
        MAX(kills) as kills,
        MAX(deaths) as deaths,
        MAX(hs) as hs,
        MAX(skill) as skill
      FROM csstats_snapshots
      WHERE map = ?
      GROUP BY steamid
      ORDER BY kills DESC
      LIMIT 10
    `, [req.params.map])
    res.json(rows)
  } catch (err) {
    console.error('Error fetching map data:', err)
    res.status(500).json({ error: err.message })
  }
})
```

### 1.7 Try/catch em snapshot() e saveSnapshot() (Fix #2) + Batch inserts (Fix #17) + lastState cleanup (Fix #13)

**Substituir funções snapshot e saveSnapshot (linhas 355-434):**
```javascript
const SNAPSHOT_STALE_MS = 10 * 60 * 1000

async function saveSnapshotBatch(players, map) {
  if (!players.length) return

  const values = players.map(p => [p.steamid, p.name, map, p.kills, p.deaths, p.hs, p.skill])
  const placeholders = values.map(() => '(?,?,?,?,?,?,?)').join(',')
  const flatValues = values.flat()

  await db.query(
    `INSERT INTO csstats_snapshots (steamid,name,map,kills,deaths,hs,skill) VALUES ${placeholders}`,
    flatValues
  )
  console.log(`snapshot salvo: ${players.length} jogadores (${map})`)
}

function pruneLastState() {
  const now = Date.now()
  for (const [steamid, entry] of Object.entries(lastState)) {
    if (!entry._lastUpdated || (now - entry._lastUpdated) > SNAPSHOT_STALE_MS) {
      delete lastState[steamid]
    }
  }
}

async function snapshot() {
  try {
    const map = await getCurrentMap()
    const [players] = await db.query(`
      SELECT steamid, name, kills, deaths, hs, skill
      FROM csstats
    `)

    if (lastMap !== map) {
      console.log('Mapa mudou:', map)
      await saveSnapshotBatch(players, map)
      for (const p of players) {
        p._lastUpdated = Date.now()
        lastState[p.steamid] = p
      }
      lastMap = map
      pruneLastState()
      return
    }

    const changedPlayers = []
    for (const p of players) {
      const prev = lastState[p.steamid]

      if (!prev) {
        changedPlayers.push(p)
        p._lastUpdated = Date.now()
        lastState[p.steamid] = p
        continue
      }

      const changed =
        p.kills !== prev.kills ||
        p.deaths !== prev.deaths ||
        p.hs !== prev.hs ||
        p.skill !== prev.skill

      if (changed) {
        changedPlayers.push(p)
        p._lastUpdated = Date.now()
        lastState[p.steamid] = p
      }
    }

    if (changedPlayers.length) {
      await saveSnapshotBatch(changedPlayers, map)
    }

    pruneLastState()
  } catch (err) {
    console.error('Erro no snapshot:', err)
  }
}

setInterval(snapshot, 60000)
```

### 1.8 Rate limiting em `/admin/command` (Fix #19)

**Adicionar após o `loginLimiter` (após linha 20):**
```javascript
const commandLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitos comandos. Tente novamente em 1 minuto.' }
})
```

**Adicionar `commandLimiter` na rota `/admin/command` (linha 824):**
```javascript
app.post('/admin/command', commandLimiter, requireAdmin, async (req, res) => {
```

### 1.9 Log nos catch vazios do RCON (Fix #33)

**Substituir linhas 738 e 746:**
```javascript
try { client.disconnect() } catch (e) { console.error('RCON disconnect error:', e.message) }
```
(Ambas as ocorrências em `finishOk` e `finishErr`)

### 1.10 Remover código comentado morto (Fix #25)

**Remover linha 178:** `//io.emit("update")`
**Remover linhas 338-340 e 346:**
```javascript
//const [[sessions]] = await db.query(
//  "SELECT COUNT(*) total FROM csstats_snapshots"
//)
```
e `//sessions: sessions.total`

---

## 2. `web/common.js` — Correções

### 2.1 Adicionar `escapeHtml` e lazy statusEl (Fix #5, #9)

**Substituir linhas 15-16:**
```javascript
const API = '/api'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getStatusEl() {
  return document.getElementById('statusMessage')
}
```

**Substituir funções `setStatus` e `clearStatus`:**
```javascript
function setStatus(message, type = 'info') {
  const el = getStatusEl()
  if (!el) return
  el.textContent = message
  el.className = `status-message visible ${type}`
}

function clearStatus() {
  const el = getStatusEl()
  if (!el) return
  el.textContent = ''
  el.className = 'status-message'
}
```

### 2.2 Escapar texto em `showEmptyRow` (Fix #5)

**Substituir linha 143:**
```javascript
table.innerHTML = `\n    <tr class="empty-row">\n      <td colspan="${columns}">${escapeHtml(emptyText)}</td>\n    </tr>\n  `
```

---

## 3. `web/app.js` — Correções

### 3.1 XSS: escapar nome do jogador (Fix #3)

**Substituir linha 86:**
```javascript
<td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}">${escapeHtml(p.name)}</a></td>
```

### 3.2 Debounce no focus handler (Fix #35)

**Substituir linhas 149-152:**
```javascript
let focusDebounceTimer = null
window.addEventListener('focus', () => {
  if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
  focusDebounceTimer = setTimeout(refreshAll, 500)
})
setInterval(refreshAll, 15000)

refreshAll()
```

---

## 4. `web/player.js` — Correções

### 4.1 Remover referência ao campo `map` inexistente (Fix #6, #23)

**Substituir linha 31:**
```javascript
// removed: lastMap é carregado corretamente por loadLastMap()
```
(Literalmente remover a linha `document.getElementById('lastMap').innerText = history[history.length - 1].map || '-'`)

**Substituir linha 54 (remover coluna de mapa da tabela):**
```javascript
    tr.innerHTML = `
      <td>${date}</td>
      <td>${row.kills ?? 0}</td>
      <td>${row.deaths ?? 0}</td>
      <td>${row.hs ?? 0}</td>
      <td>${row.skill ?? 0}</td>
    `
```

**Atualizar `showSkeletonRows` para 5 colunas (era 6):**
```javascript
showSkeletonRows(table, 5, 4)
```

### 4.2 Guard para Chart.js (Fix #10)

**Substituir linha 97:**
```javascript
if (typeof Chart === 'undefined') {
  console.error('Chart.js não carregado')
  return
}

chartInstance = new Chart(ctx, {
```

---

## 5. `web/maps.js` — Correções

### 5.1 XSS: escapar nome do mapa (Fix #3)

**Substituir linha 20:**
```javascript
<td><a href="map.html?map=${encodeURIComponent(m.map)}">${escapeHtml(m.map)}</a></td>
```

---

## 6. `web/map.js` — Correções

### 6.1 XSS: escapar nome do jogador (Fix #3)

**Substituir linha 31:**
```javascript
<td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}">${escapeHtml(p.name)}</a></td>
```

---

## 7. `web/rankings.js` — Correções

### 7.1 XSS: escapar nome do jogador (Fix #3)

**Substituir linha 25:**
```javascript
<td><a href="player.html?steamid=${encodeURIComponent(p.steamid)}">${escapeHtml(p.name)}</a></td>
```

---

## 8. `web/advanced.js` — Correções

### 8.1 XSS: escapar nome do jogador (Fix #3)

**Substituir linhas 42, 52, 60:**
```javascript
// Linha 42:
<td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${escapeHtml(item.name)}</a></td>

// Linha 52:
<td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${escapeHtml(item.name)}</a></td>

// Linha 60:
<td><a href="player.html?steamid=${encodeURIComponent(item.steamid)}">${escapeHtml(item.name)}</a></td>
```

---

## 9. `web/live.js` — Correções

### 9.1 XSS: escapar nomes no kill feed (Fix #15, #16)

**Substituir linhas 167-173:**
```javascript
item.innerHTML = `
  <span class="kill-killer">${escapeHtmlText(kill.killer)}</span>
  <span class="kill-arrow">→</span>
  <span class="kill-victim">${escapeHtmlText(kill.victim)}</span>
  <span class="kill-weapon" title="${escapeAttr(kill.weapon || 'weapon')}">${weaponEmoji}</span>
  ${hsEmoji ? `<span class="kill-hs" title="Headshot">${hsEmoji}</span>` : ''}
`
```

### 9.2 Otimizar innerHTML no loop de renderPlayers (Fix #14)

**Substituir linhas 137-150:**
```javascript
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
            <span class="sf-status-emoji" aria-hidden="true">${player.alive ? '🟢' : '🔴'}</span>
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
```

---

## 10. `api/Dockerfile` — Upgrade Node.js (Fix #20)

**Substituir linha 1:**
```dockerfile
FROM node:20
```

---

## 11. `web/nginx.conf` — Security Headers (Fix #21)

**Adicionar no bloco `server { listen 80 default_server;` após `gzip_min_length 256;`:**
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

Adicionar também no segundo server block (linhas 8-14), após `gzip_min_length 256;` na linha 55.

---

## 12. `web/index.html` — Lang attribute (Fix #28)

**Substituir linha 2:**
```html
<html lang="pt-BR">
```

---

## 13. `.gitignore` — Remover AGENTS.md (Fix #31)

**Remover linha 6:** `AGENTS.md`

---

## 14. `web/rankings.html` — Remover onclick inline (Fix #32)

**Substituir linhas 22-25:**
```html
<div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
  <button id="btnWeekly" data-i18n="labels.weekly">Semanal</button>
  <button id="btnMonthly" data-i18n="labels.monthly">Mensal</button>
</div>
```

**Adicionar em `rankings.js` (antes de `loadRanking('weekly')`):**
```javascript
document.addEventListener('DOMContentLoaded', () => {
  const btnWeekly = document.getElementById('btnWeekly')
  const btnMonthly = document.getElementById('btnMonthly')
  if (btnWeekly) btnWeekly.addEventListener('click', () => loadRanking('weekly'))
  if (btnMonthly) btnMonthly.addEventListener('click', () => loadRanking('monthly'))
})
```

---

## 15. `api/package.json` — Adicionar cors (Fix #4)

**Adicionar em dependencies:**
```json
"cors": "^2.8.5",
```

---

## 16. `docker-compose.yml` — Health check com curl (Fix #22)

**Substituir linhas 68-73:**
```yaml
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
```

---

## 17. `.env.example` — Adicionar GAMEDIG vars

**Adicionar após `RCON_PASSWORD`:**
```
# --- Game Server Connection ---
GAMEDIG_HOST=cs16
GAMEDIG_PORT=27015
```

---

## Resumo de execução

1. Instalar novo pacote: `cd api && npm install cors`
2. Aplicar todas as edições listadas acima
3. Reconstruir: `docker compose up --build`
4. Testar: acessar http://localhost:8080 e verificar funcionalidade
