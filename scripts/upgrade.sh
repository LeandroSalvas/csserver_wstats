#!/bin/bash
# upgrade.sh — aplica upgrades da API (cs16-wstats) com smoke-test e rollback.
#
# Uso:
#   upgrade.sh --fase a            Aplica Fase A (Node 26 + Express 5 + rate-limit 8 + gamedig 5 + robustez)
#   upgrade.sh --fase b            Aplica Fase B (Redis 6 + connect-redis 10) — requer Node 26 (Fase A)
#   upgrade.sh --fase a --no-auto-rollback   Pára após falha no smoke para inspeção manual
#   upgrade.sh rollback [tag]      Reverte imagem (rollback-<tag>, default: último) + código e revalida
#   upgrade.sh list                Lista snapshots de rollback disponíveis
#   upgrade.sh -h                  Ajuda
#
# O fluxo de uma fase: snapshot → aplica mudanças → npm install (lockfile) →
# node --check → build → up -d api → health gate → smoke-test.sh --fase <a|b>.
# Se o smoke falhar e o auto-rollback estiver ativo, restaura imagem+código e
# revalida com smoke-test.sh --rollback. Nada além do serviço api é tocado.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_DIR="${ROOT}/api"
STATE_FILE="${ROOT}/.rollback-state"
API_IMAGE="csserver_wstats-api"
API_CONTAINER="cs16-api"

ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }

AUTO_ROLLBACK=1

# --- Helpers -----------------------------------------------------------------

cmd() { docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.servers.yml" "$@"; }

git_dirty() {
  ! git -C "${ROOT}" diff --quiet HEAD
}

wait_api_healthy() {
  local deadline=$((SECONDS + 90)) status="starting"
  while [ $SECONDS -lt "$deadline" ]; do
    status="$(docker inspect "${API_CONTAINER}" --format '{{.State.Health.Status}}' 2>/dev/null)"
    [ "$status" = "healthy" ] && { ok "api healthy"; return 0; }
    sleep 2
  done
  err "api não ficou healthy em 90s (status=${status})"
  return 1
}

# npm dentro de um container node:26 (o host não tem Node).
run_in_node26() {
  docker run --rm -v "${API_DIR}:/app" -w /app node:26 "$@"
}

snapshot() {
  local ts="$1"
  if docker image inspect "${API_IMAGE}" >/dev/null 2>&1; then
    docker tag "${API_IMAGE}" "${API_IMAGE}:rollback-${ts}"
    info "snapshot: ${API_IMAGE}:rollback-${ts}"
  else
    err "Imagem ${API_IMAGE} não existe — abortando snapshot"
    return 1
  fi
}

record_state() {
  printf '%s\n' "${TS}|${PHASE}|$(git -C "${ROOT}" rev-parse HEAD)" >> "${STATE_FILE}"
}

# --- Fases -------------------------------------------------------------------

apply_phase_a() {
  local f="${API_DIR}/Dockerfile" pkg="${API_DIR}/package.json" idx="${API_DIR}/index.js" changed=0

  if grep -q '^FROM node:20$' "$f"; then
    sed -i 's/^FROM node:20$/FROM node:26/' "$f" && changed=1
  fi
  if grep -q '^RUN npm install --omit=dev$' "$f"; then
    sed -i 's/^RUN npm install --omit=dev$/RUN npm ci --omit=dev/' "$f" && changed=1
  fi

  if grep -q '"express": "\^4\.18\.2"' "$pkg"; then
    sed -i 's/"express": "\^4\.18\.2"/"express": "^5.2.1"/' "$pkg" && changed=1
  fi
  if grep -q '"express-rate-limit": "\^7\.0\.0"' "$pkg"; then
    sed -i 's/"express-rate-limit": "\^7\.0\.0"/"express-rate-limit": "^8.6.0"/' "$pkg" && changed=1
  fi
  if grep -q '"gamedig": "\^4\.0\.6"' "$pkg"; then
    sed -i 's/"gamedig": "\^4\.0\.6"/"gamedig": "^5.3.3"/' "$pkg" && changed=1
  fi

  # express-rate-limit v8 removeu a opção `max` em favor de `limit`.
  if grep -qE '^[[:space:]]*max: [0-9]+,$' "$idx"; then
    sed -i -E 's/^([[:space:]]*)max: ([0-9]+),$/\1limit: \2,/' "$idx" && changed=1
  fi

  # Substitui o fim do index.js (marcador // INICIALIZA SERVIDOR em diante) pelo
  # bloco de robustez: error handler global + graceful shutdown + process.on.
  if grep -q '^// INICIALIZA SERVIDOR$' "$idx"; then
    awk '{ if ($0 == "// INICIALIZA SERVIDOR") exit; print }' "$idx" > "${idx}.new"
    cat >> "${idx}.new" <<'TAIL'
// Tratador global de erros (Express 5 encaminha rejeições async para cá).
function errorHandler(err, req, res, next) {
  console.error('Erro não tratado:', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: 'Erro interno do servidor' })
}
app.use(errorHandler)

// INICIALIZA SERVIDOR
async function start() {
  try {
    await ensureSchema()
  } catch (err) {
    console.error('Falha ao garantir schema do banco:', err.message)
  }
  await setupSession()

  const server = app.listen(3000, '0.0.0.0', () => {
    console.log('API rodando na porta 3000')
    startSsePolling()
    setInterval(checkServerAlerts, 30000)
    checkServerAlerts()
  })
  return server
}

const serverPromise = start()
serverPromise.then((srv) => {
  setupGracefulShutdown(srv)
}).catch((err) => {
  console.error('Falha ao inicializar API:', err)
  process.exit(1)
})

// Encerramento gracioso: para de aceitar conexões, desconecta clientes SSE,
// fecha o pool MySQL e o Redis, e encerra com exit 0.
function setupGracefulShutdown(srv) {
  const shutdown = () => {
    console.log('Encerrando com graça (SIGTERM/SIGINT)...')

    for (const client of sseClients) client.res.end()
    sseClients.clear()

    const forceExit = setTimeout(() => {
      console.error('Shutdown excedeu 10s; forçando saída')
      process.exit(1)
    }, 10000)
    forceExit.unref()

    srv.close(async () => {
      const closes = [db.end()]
      if (redisClient) closes.push(withTimeout(redisClient.quit(), 3000).catch(() => {}))
      await Promise.allSettled(closes)
      clearTimeout(forceExit)
      console.log('API encerrada')
      process.exit(0)
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason)
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err)
  process.exit(1)
})
TAIL
    mv "${idx}.new" "$idx" && changed=1
  fi

  [ "$changed" -eq 1 ] || warn "Fase A já aplicada (nada a mudar)"
}

apply_phase_b() {
  local pkg="${API_DIR}/package.json" changed=0

  if grep -q '"redis": "\^4\.7\.1"' "$pkg"; then
    sed -i 's/"redis": "\^4\.7\.1"/"redis": "^6.2.0"/' "$pkg" && changed=1
  fi
  if grep -q '"connect-redis": "\^8\.0\.3"' "$pkg"; then
    sed -i 's/"connect-redis": "\^8\.0\.3"/"connect-redis": "^10.0.0"/' "$pkg" && changed=1
  fi

  [ "$changed" -eq 1 ] || warn "Fase B já aplicada (nada a mudar)"
}

# --- Fluxo da fase -----------------------------------------------------------

run_phase() {
  local phase="$1"

  git_dirty && { err "Working tree com mudanças pendentes — faça commit antes de rodar a fase."; return 1; }
  [ -f "${ROOT}/docker-compose.servers.yml" ] || { err "override ausente — rode 'scripts/servers.sh compose' antes."; return 1; }

  TS="$(date +%Y%m%d%H%M%S)"
  PHASE="$phase"

  info "== Fase ${phase} — snapshot =="
  snapshot "$TS" || return 1
  record_state

  info "== Aplicando mudanças (Fase ${phase}) =="
  if [ "$phase" = "a" ]; then
    apply_phase_a
  else
    apply_phase_b
  fi

  info "== npm install (lockfile) em node:26 =="
  run_in_node26 npm install --package-lock-only || { err "npm install falhou"; return 1; }

  info "== node --check (index.js) =="
  run_in_node26 node --check index.js || { err "syntax check falhou"; return 1; }

  info "== docker compose build api =="
  cmd build api || { err "build falhou"; return 1; }

  info "== up -d api =="
  cmd up -d --no-deps api || { err "up falhou"; return 1; }

  info "== health gate =="
  wait_api_healthy || return 1

  info "== smoke-test.sh --fase ${phase} =="
  local smoke_rc
  "${SCRIPT_DIR}/smoke-test.sh" --fase "$phase"
  smoke_rc=$?

  if [ "$smoke_rc" -eq 0 ]; then
    ok "Smoke test passou — commitando a Fase ${phase}"
    commit_phase "$phase"
    return 0
  fi

  err "Smoke test falhou na Fase ${phase}."
  if [ "$AUTO_ROLLBACK" -eq 1 ]; then
    info "Executando rollback automático..."
    do_rollback "$TS"
    return $?
  fi
  err "Auto-rollback desativado. Corrija os arquivos ou rode: upgrade.sh rollback ${TS}"
  return 1
}

commit_phase() {
  local phase="$1" msg files
  case "$phase" in
    a)
      msg="Upgrade API (Fase A): Node 26, Express 5, rate-limit 8, gamedig 5, robustez"
      files=(api/Dockerfile api/package.json api/package-lock.json api/index.js \
             scripts/smoke-test.sh scripts/upgrade.sh AGENTS.md .gitignore)
      ;;
    b)
      msg="Upgrade API (Fase B): Redis 6 + connect-redis 10"
      files=(api/package.json api/package-lock.json)
      ;;
  esac

  git -C "${ROOT}" add "${files[@]}"
  git -C "${ROOT}" commit -m "$msg" || { err "commit falhou"; return 1; }
  ok "commit: $msg"
  if git -C "${ROOT}" remote get-url origin >/dev/null 2>&1; then
    git -C "${ROOT}" push origin "$(git -C "${ROOT}" branch --show-current)"
    ok "push origin"
  else
    warn "sem remote 'origin' — commit local apenas"
  fi
}

# --- Rollback ----------------------------------------------------------------

do_rollback() {
  local ts="${1:-}" entry head
  if [ -z "$ts" ]; then
    ts="$(tail -1 "${STATE_FILE}" 2>/dev/null | cut -d'|' -f1)"
  fi
  entry="$(grep -F "${ts}|" "${STATE_FILE}" 2>/dev/null | tail -1)"
  if [ -z "$entry" ]; then
    err "rollback: sem estado para tag '${ts}' (${STATE_FILE})"
    return 1
  fi
  head="$(cut -d'|' -f3 <<< "$entry")"

  warn "Rollback para imagem rollback-${ts} e código ${head}"
  docker tag "${API_IMAGE}:rollback-${ts}" "${API_IMAGE}" || { err "imagem rollback-${ts} não existe"; return 1; }
  git -C "${ROOT}" reset --hard "$head" || return 1

  info "== up -d --force-recreate api =="
  cmd up -d --force-recreate --no-deps api || return 1

  info "== health gate =="
  wait_api_healthy || return 1

  info "== smoke-test.sh --rollback =="
  "${SCRIPT_DIR}/smoke-test.sh" --rollback
}

list_snapshots() {
  [ -f "${STATE_FILE}" ] || { info "sem snapshots (${STATE_FILE})"; return 0; }
  while IFS='|' read -r ts phase head; do
    printf '%-16s fase=%s commit=%s\n' "$ts" "$phase" "$head"
  done < "${STATE_FILE}"
}

usage() {
  sed -n '2,13p' "${BASH_SOURCE[0]}"
}

# --- CLI ---------------------------------------------------------------------

case "${1:-}" in
  --fase)
    [ $# -ge 2 ] || { err "Uso: upgrade.sh --fase a|b [--no-auto-rollback]"; exit 1; }
    case "$2" in
      a|b) ;;
      *) err "Uso: upgrade.sh --fase a|b [--no-auto-rollback]"; exit 1 ;;
    esac
    if [ $# -ge 3 ] && [ "$3" = "--no-auto-rollback" ]; then
      AUTO_ROLLBACK=0
      warn "auto-rollback desativado"
    fi
    run_phase "$2"
    ;;
  rollback)
    do_rollback "${2:-}"
    ;;
  list) list_snapshots ;;
  -h|--help|help) usage ;;
  *)
    err "Opção desconhecida: ${1:-}"
    usage
    exit 1
    ;;
esac
