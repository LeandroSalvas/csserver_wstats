# MEMÓRIA DE IMPLANTAÇÃO — UI/UX + Arquitetura

**Ordem de execução:** Parte 1 (frontend UI/UX) → Parte 2 (api/arquitetura) → Validação final.
**Commit/push:** somente após validação e aprovação do usuário.

---

## PARTE 1 — UI/UX (frontend)

### Bloco 1A — Atrito de UX
- [x] **1A1. Home sem flash de status a cada 15s** — `web/app.js`
- [x] **1A2. Paginação com URL state** — `web/rankings.js`, `web/matches.js`
- [x] **1A3. Duelo: `<a href="#">` → `<button>`** — `web/duelo.js`
- [x] **1A4. Live: renderização por diff** — `web/live.js`
- [x] **1A5. Estado vazio nos gráficos** — `web/player.js`
- [x] **1A6. Admin: inline styles → classes CSS** — `web/admin.html` (+ `style.css`)
- [x] **1A7. `<noscript>`** nas 14 páginas (`web/*.html`)
- [x] **1A8. Combobox da busca** — `web/common.js` + `web/duelo.js`

### Bloco 1B — Design system
- [x] **1B1. Remover `@import` do Google Fonts** — `web/style.css`
- [x] **1B2. Tokens novos** — `style.css :root` + refatorar status/top/botões
- [x] **1B3. Nav em 2 níveis** — `web/common.js` + `style.css` + `translations.js` (linha utilitária separada: busca/Assistir/idioma)

### Bloco 1C — Acessibilidade WCAG
- [x] **1C1. Gráficos com `role="img"` + `aria-label`** — `web/player.html`, `web/duelo.html`
- [x] **1C2. Séries distinguíveis por padrão, não só cor** — `web/player.js`
- [x] **1C3. Duelo: indicador não-cor** — `web/duelo.js`
- [x] **1C4. Skip link + landmarks** — `web/*.html` + `style.css`

### Bloco 1D — Código/layout práticos
- [x] **1D1. Helper `renderRows()`** — `web/common.js` + refatorar páginas
- [x] **1D2. Cache-busting `?v=3`** — `web/*.html`
- [x] **1D3. Chave duplicada `live.score`** — `web/i18n/translations.js`

## PARTE 2 — Arquitetura (api/)

### Bloco 2A — Performance
- [ ] **2A1. CTE com filtro de data no scan** — `api/index.js` (ranking weekly/monthly, map-ranking, player-history-daily, player-rank-history, collectDbStats)
- [ ] **2A2. Cache nos `top*`** — `api/index.js`

### Bloco 2B — Segurança
- [ ] **2B1. Proteger `/metrics`** — Basic Auth (env `METRICS_USER`/`METRICS_PASS`)
- [ ] **2B2. CSP + Permissions-Policy** — `web/nginx.conf`
- [ ] **2B3. Cookie secure configurável** — `api/index.js`
- [ ] **2B4. `/health` sem `err.message`** — `api/index.js`

### Bloco 2C — Robustez/Erros
- [ ] **2C1. SSE guardado + limite** — `api/index.js`
- [ ] **2C2. `trackedQuery()`** — `api/index.js`
- [ ] **2C3. `ensureSchema` com retry/backoff** — `api/index.js`
- [ ] **2C4. `handleError` com contexto consistente** — `api/index.js`

### Bloco 2D — Estrutura (split)
- [ ] **2D1. Quebrar `api/index.js` em módulos** — config/db/cache/security/metrics/middleware/routes/services

## VALIDAÇÃO
- [ ] JS: `node --check` em todos os arquivos (docker node:26)
- [ ] HTML: bem-formação + contagens (type=button, captions, aria-hidden, noscript)
- [ ] API: `./scripts/smoke-test.sh`
- [ ] Deploy: `docker compose restart web` + `docker compose up -d --build api`
- [ ] Revisão visual final
