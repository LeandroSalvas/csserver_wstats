#!/bin/bash
# smoke-test.sh — valida a API cs16-wstats (usado por upgrade.sh e manualmente).
#
# Uso:
#   smoke-test.sh            Blocos 1-3 (composição + funcional + redis/sessão)
#   smoke-test.sh --fase a   Blocos 1-2 (composição + funcional)
#   smoke-test.sh --fase b   Blocos 1-3
#   smoke-test.sh --rollback Pula os testes sensíveis (rate-limit 429 e SIGTERM)
#   smoke-test.sh -h         Ajuda
#
# Exit 0 = tudo saudável (gatilho de sucesso); != 0 = gatilho de rollback.
#
# Ajustáveis por ambiente:
#   EXPECT_NODE_MAJOR=26 EXPECT_EXPRESS='express@5.' EXPECT_RATE_LIMIT='express-rate-limit@8'
#   EXPECT_GAMEDIG='gamedig@5' EXPECT_REDIS='redis@6' EXPECT_CONNECT_REDIS='connect-redis@10'
#   API_BASE='http://localhost:8080/api'  RCON_PASSWORD vindo do .env automaticamente

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PHASE="all"
ROLLBACK_MODE=0
for arg in "$@"; do
  case "$arg" in
    --fase) PHASE="next" ;;  # valor vem no próximo arg
    a|b) PHASE="$arg" ;;
    --rollback) ROLLBACK_MODE=1 ;;
    -h|--help|help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) err "Opção desconhecida: $arg"; exit 1 ;;
  esac
done

if [ "$PHASE" = "next" ]; then
  err "Uso: smoke-test.sh --fase a|b"
  exit 1
fi

API_BASE="${API_BASE:-http://localhost:8080/api}"
API_CONTAINER="${API_CONTAINER:-cs16-api}"
REDIS_CONTAINER="${REDIS_CONTAINER:-csserver_wstats-redis-1}"

# Expectativas derivadas da fonte atual (Dockerfile/package.json) — vale tanto
# para validar um upgrade quanto um rollback (a fonte reflete o estado restaurado).
# Overrides explícitos por ambiente (EXPECT_*) têm precedência.
derive_expectations() {
  local df="${ROOT}/api/Dockerfile" pkg="${ROOT}/api/package.json" v
  local node_major
  node_major="$(grep -oE '^FROM node:[0-9]+' "$df" | grep -oE '[0-9]+$')"
  EXPECT_NODE_MAJOR="${EXPECT_NODE_MAJOR:-${node_major:-26}}"

  v="$(grep -oE '"express": "\^[0-9]+\.' "$pkg" | grep -oE '[0-9]+' | head -1)"
  EXPECT_EXPRESS="${EXPECT_EXPRESS:-express@${v}.}"
  v="$(grep -oE '"express-rate-limit": "\^[0-9]+\.' "$pkg" | grep -oE '[0-9]+' | head -1)"
  EXPECT_RATE_LIMIT="${EXPECT_RATE_LIMIT:-express-rate-limit@${v}}"
  v="$(grep -oE '"gamedig": "\^[0-9]+\.' "$pkg" | grep -oE '[0-9]+' | head -1)"
  EXPECT_GAMEDIG="${EXPECT_GAMEDIG:-gamedig@${v}}"
  v="$(grep -oE '"redis": "\^[0-9]+\.' "$pkg" | grep -oE '[0-9]+' | head -1)"
  EXPECT_REDIS="${EXPECT_REDIS:-redis@${v}}"
  v="$(grep -oE '"connect-redis": "\^[0-9]+\.' "$pkg" | grep -oE '[0-9]+' | head -1)"
  EXPECT_CONNECT_REDIS="${EXPECT_CONNECT_REDIS:-connect-redis@${v}}"
}
derive_expectations

get_rcon_password() {
  grep -E '^RCON_PASSWORD=' "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
RCON_PASSWORD="${RCON_PASSWORD:-$(get_rcon_password)}"

TOTAL=0 PASS=0 FAIL=0
FAILED=()

info() { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✖\033[0m %s\n' "$*" >&2; }
note() { printf '  \033[36m•\033[0m %s\n' "$*"; }

pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); ok "$*"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); FAILED+=("$*"); err "✖ $*"; }

# http_status <url> [data] — imprime o código HTTP (000 em timeout/conexão).
http_status() {
  local url="$1" data="${2:-}" opts=(-s -o /dev/null -w '%{http_code}' --max-time 10)
  if [ -n "$data" ]; then
    curl "${opts[@]}" -X POST -H 'Content-Type: application/json' -d "$data" "$url"
  else
    curl "${opts[@]}" "$url"
  fi
}

assert_status() {
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    pass "$name (http $got)"
  else
    fail "$name — esperava http $want, obteve $got"
  fi
}

section() {
  info ""
  info "=== $1 ==="
}

run_block_composition() {
  section "Bloco 1 — Composição (Node + deps + robustez + shutdown)"

  local node_v node_major
  node_v="$(docker exec "${API_CONTAINER}" node -v 2>/dev/null)"
  node_major="$(printf '%s' "$node_v" | sed 's/^v//; s/\..*$//')"
  if [ "$node_major" = "$EXPECT_NODE_MAJOR" ]; then
    pass "Node ${node_v} (major ${node_major})"
  else
    fail "Node v${EXPECT_NODE_MAJOR}.x esperado, encontrado ${node_v:-ausente}"
  fi

  # Deps da Fase A sempre; redis/connect-redis só na Fase B (ou full).
  local deps_out pat deps=("$EXPECT_EXPRESS" "$EXPECT_RATE_LIMIT" "$EXPECT_GAMEDIG")
  if [ "$PHASE" = "all" ] || [ "$PHASE" = "b" ]; then
    deps+=("$EXPECT_REDIS" "$EXPECT_CONNECT_REDIS")
  fi
  deps_out="$(docker exec "${API_CONTAINER}" npm ls --depth=0 2>/dev/null)"
  for pat in "${deps[@]}"; do
    if printf '%s\n' "$deps_out" | grep -qF "$pat"; then
      pass "dep ${pat}"
    else
      fail "dep ${pat} não instalada (npm ls no container)"
    fi
  done

  if [ "$ROLLBACK_MODE" -eq 1 ]; then
    note "pulando robustez + graceful shutdown (--rollback)"
    return
  fi

  local src="${ROOT}/api/index.js"
  local pats=("err, req, res, next" "process.on('unhandledRejection'" "process.on('uncaughtException'" "SIGTERM" "SIGINT" "srv.close")
  local p
  for p in "${pats[@]}"; do
    if grep -qF "$p" "$src"; then
      pass "robustez: ${p}"
    else
      fail "robustez: '${p}' não encontrado em api/index.js"
    fi
  done

  test_graceful_shutdown
}

test_graceful_shutdown() {
  local img net name cid
  img="$(docker inspect "${API_CONTAINER}" --format '{{.Config.Image}}' 2>/dev/null)"
  net="$(docker inspect "${API_CONTAINER}" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null | awk '{print $1}')"
  name="cs16-grace-$$"
  if [ -z "$img" ] || [ -z "$net" ]; then
    fail "graceful shutdown — não foi possível inspecionar ${API_CONTAINER} (imagem/rede)"
    return
  fi

  docker rm -f "$name" >/dev/null 2>&1
  cid="$(docker run -d --name "$name" --restart no --network "$net" \
    -e SESSION_SECRET=smoke-secret \
    -e SESSION_STORE=memory \
    -e DB_HOST=db -e REDIS_HOST=redis \
    "$img")"
  if [ -z "$cid" ]; then
    fail "graceful shutdown — falha ao subir container descartável"
    return
  fi

  local i code=000
  for i in $(seq 1 20); do
    code="$(docker exec "$name" wget -q -O /dev/null -T 2 http://localhost:3000/health 2>/dev/null && echo 200 || echo 000)"
    [ "$code" = "200" ] && break
    sleep 1
  done
  if [ "$code" != "200" ]; then
    fail "graceful shutdown — container descartável não respondeu /health (http $code)"
    docker rm -f "$name" >/dev/null 2>&1
    return
  fi

  docker kill -s TERM "$name" >/dev/null 2>&1
  local rc
  rc="$(timeout 15 docker wait "$name" 2>/dev/null)"
  docker rm -f "$name" >/dev/null 2>&1

  if [ "$rc" = "0" ]; then
    pass "graceful shutdown (SIGTERM → exit 0)"
  else
    fail "graceful shutdown — exit code ${rc:-timeout} (esperado 0)"
  fi
}

run_block_functional() {
  section "Bloco 2 — Funcional (API)"

  local code body

  code="$(http_status "${API_BASE}/health")"
  assert_status "/health responde 200" 200 "$code"
  body="$(curl -s --max-time 10 "${API_BASE}/health")"
  if printf '%s' "$body" | jq -e '.status == "ok" and .db == "ok"' >/dev/null 2>&1; then
    pass "/health status ok + db ok"
  else
    fail "/health payload inesperado: ${body}"
  fi

  code="$(http_status "${API_BASE}/servers")"
  assert_status "/servers responde 200" 200 "$code"
  body="$(curl -s --max-time 10 "${API_BASE}/servers")"
  if printf '%s' "$body" | jq -e 'type == "array" and length >= 1' >/dev/null 2>&1; then
    pass "/servers é array com ≥1 servidor"
  else
    fail "/servers payload inesperado: ${body}"
  fi

  code="$(http_status "${API_BASE}/top10")"
  assert_status "/top10 responde 200" 200 "$code"
  body="$(curl -s --max-time 10 "${API_BASE}/top10")"
  if printf '%s' "$body" | jq -e 'type == "array"' >/dev/null 2>&1; then
    pass "/top10 é array"
  else
    fail "/top10 payload inesperado: ${body}"
  fi

  local steamid=""
  steamid="$(printf '%s' "$body" | jq -r '.[0].steamid // empty' 2>/dev/null)"
  if [ -n "$steamid" ]; then
    code="$(http_status "${API_BASE}/player/${steamid}")"
    assert_status "/player/<steamid> responde 200" 200 "$code"
  else
    note "/player/<steamid> pulado (top10 vazio)"
  fi

  local map="de_dust2"
  map="$(curl -s --max-time 10 "${API_BASE}/servers" | jq -r '[.[] | select(.online == true) | .map][0] // "de_dust2"' 2>/dev/null)"
  code="$(http_status "${API_BASE}/map-ranking/${map}")"
  assert_status "/map-ranking/${map} responde 200" 200 "$code"

  code="$(http_status "${API_BASE}/server/nao-existe-xyz")"
  assert_status "400 para /server/nao-existe-xyz" 400 "$code"
  code="$(http_status "${API_BASE}/top10?server=nao-existe-xyz")"
  assert_status "400 para /top10?server=inválido" 400 "$code"
  code="$(http_status "${API_BASE}/live/events?server=nao-existe-xyz")"
  assert_status "400 para /live/events?server=inválido" 400 "$code"
  code="$(http_status "${API_BASE}/rota-inexistente-xyz")"
  assert_status "404 para rota desconhecida" 404 "$code"

  get_metrics_creds() {
    grep -E '^METRICS_USER=' "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
  }
  get_metrics_pass() {
    grep -E '^METRICS_PASS=' "${ROOT}/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
  }
  local muser mpass
  muser="$(get_metrics_creds)"
  mpass="$(get_metrics_pass)"

  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -u "${muser}:${mpass}" "${API_BASE}/metrics")"
  assert_status "/metrics responde 200" 200 "$code"
  body="$(curl -s --max-time 10 -u "${muser}:${mpass}" "${API_BASE}/metrics")"
  if printf '%s' "$body" | grep -q 'cs16_'; then
    pass "/metrics expõe métricas cs16_"
  else
    fail "/metrics sem métricas cs16_"
  fi
  if [ -n "$muser" ] && [ -n "$mpass" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${API_BASE}/metrics")"
    assert_status "/metrics sem auth → 401" 401 "$code"
  fi

  local sse_out
  sse_out="$(timeout 6 curl -sN --max-time 6 "${API_BASE}/live/events" 2>/dev/null)"
  if printf '%s' "$sse_out" | grep -q '^: ping'; then
    pass "SSE entrega heartbeat ': ping' (≤6s)"
  else
    fail "SSE não entregou ': ping' em 6s"
  fi

  test_admin_flow
}

test_admin_flow() {
  local jar csrf code body

  [ -n "$RCON_PASSWORD" ] || { fail "RCON_PASSWORD ausente no .env — fluxo admin pulado"; return; }

  jar="$(mktemp)"
  body="$(curl -s -c "$jar" --max-time 10 "${API_BASE}/admin/session")"
  csrf="$(printf '%s' "$body" | jq -r '.csrfToken // empty')"
  if [ -z "$csrf" ]; then
    fail "admin/session não retornou csrfToken: ${body}"
    rm -f "$jar"
    return
  fi
  pass "admin/session retorna csrfToken"

  code="$(curl -s -b "$jar" -c "$jar" -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST -H "x-csrf-token: ${csrf}" -H 'Content-Type: application/json' \
    -d '{"password":"senha-errada-para-teste"}' "${API_BASE}/admin/login")"
  assert_status "login com senha errada → 401" 401 "$code"

  body="$(curl -s -b "$jar" -c "$jar" --max-time 10 \
    -X POST -H "x-csrf-token: ${csrf}" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg p "$RCON_PASSWORD" '{password:$p}')" "${API_BASE}/admin/login")"
  if printf '%s' "$body" | jq -e '.success == true' >/dev/null 2>&1; then
    pass "login com RCON_PASSWORD → success true"
  else
    fail "login correto falhou: ${body}"
  fi
  csrf="$(printf '%s' "$body" | jq -r '.csrfToken // empty')"

  body="$(curl -s -b "$jar" --max-time 10 "${API_BASE}/admin/session")"
  if printf '%s' "$body" | jq -e '.authenticated == true' >/dev/null 2>&1; then
    pass "admin/session authenticated == true"
  else
    fail "sessão não autenticada após login: ${body}"
  fi

  if [ "$ROLLBACK_MODE" -eq 1 ]; then
    note "pulando logout + rate-limit (--rollback)"
  else
    code="$(curl -s -b "$jar" -c "$jar" -o /dev/null -w '%{http_code}' --max-time 10 \
      -X POST -H "x-csrf-token: ${csrf}" "${API_BASE}/admin/logout")"
    assert_status "logout → 200" 200 "$code"
    body="$(curl -s -b "$jar" --max-time 10 "${API_BASE}/admin/session")"
    if printf '%s' "$body" | jq -e '.authenticated == false' >/dev/null 2>&1; then
      pass "admin/session authenticated == false após logout"
    else
      fail "sessão ainda autenticada após logout: ${body}"
    fi

    test_login_rate_limit "$jar"
  fi

  rm -f "$jar"
}

# O loginLimiter (máx 5/min) conta por IP; via host todas as tentativas vêm de
# 127.0.0.1. O fluxo admin já consumiu 2 (errada + correta): a 6ª → 429.
test_login_rate_limit() {
  local jar="$1" body csrf i code
  body="$(curl -s -b "$jar" -c "$jar" --max-time 10 "${API_BASE}/admin/session")"
  csrf="$(printf '%s' "$body" | jq -r '.csrfToken // empty')"
  for i in 3 4 5 6; do
    code="$(curl -s -b "$jar" -c "$jar" -o /dev/null -w '%{http_code}' --max-time 10 \
      -X POST -H "x-csrf-token: ${csrf}" -H 'Content-Type: application/json' \
      -d '{"password":"senha-errada-para-teste"}' "${API_BASE}/admin/login")"
    if [ "$i" -eq 6 ]; then
      assert_status "6ª tentativa de login → 429 (rate limit)" 429 "$code"
    fi
  done
}

# Login do bloco 3: o teste de rate-limit do bloco 2 pode ter exaurido a janela
# de 60s do loginLimiter — re-tenta até a janela passar (máx ~80s).
block3_login() {
  local jar="$1" body csrf i=0
  body="$(curl -s -c "$jar" --max-time 10 "${API_BASE}/admin/session")"
  csrf="$(printf '%s' "$body" | jq -r '.csrfToken // empty')"
  while [ "$i" -lt 16 ]; do
    body="$(curl -s -b "$jar" -c "$jar" --max-time 10 \
      -X POST -H "x-csrf-token: ${csrf}" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg p "$RCON_PASSWORD" '{password:$p}')" "${API_BASE}/admin/login")"
    printf '%s' "$body" | jq -e '.success == true' >/dev/null 2>&1 && return 0
    i=$((i + 1))
    sleep 5
  done
  err "block3: login falhou após retries: ${body}"
  return 1
}

run_block_redis() {
  section "Bloco 3 — Redis/sessão"

  local jar

  [ -n "$RCON_PASSWORD" ] || { fail "RCON_PASSWORD ausente no .env — bloco redis pulado"; return; }

  jar="$(mktemp)"
  local before after
  before="$(docker exec "${REDIS_CONTAINER}" redis-cli keys 'sess:*' 2>/dev/null | wc -l)"
  if block3_login "$jar"; then
    pass "block3: login ok"
  else
    fail "block3: login não obteve sucesso (rate limit não expirou?)"
    rm -f "$jar"
    return
  fi

  after="$(docker exec "${REDIS_CONTAINER}" redis-cli keys 'sess:*' 2>/dev/null | wc -l)"
  if [ "$after" -gt "$before" ]; then
    pass "sessão criada no Redis (${before} → ${after} chaves sess:*)"
  else
    fail "nenhuma sessão sess:* nova no Redis após login (${before} → ${after})"
  fi

  docker restart "${API_CONTAINER}" >/dev/null 2>&1
  local i code=000
  for i in $(seq 1 30); do
    code="$(docker inspect "${API_CONTAINER}" --format '{{.State.Health.Status}}' 2>/dev/null)"
    [ "$code" = "healthy" ] && break
    sleep 2
  done
  if [ "$code" != "healthy" ]; then
    fail "api não ficou healthy após restart (${code})"
    rm -f "$jar"
    return
  fi
  pass "api voltou a healthy após restart"

  body="$(curl -s -b "$jar" --max-time 10 "${API_BASE}/admin/session")"
  if printf '%s' "$body" | jq -e '.authenticated == true' >/dev/null 2>&1; then
    pass "sessão sobreviveu ao restart do api"
  else
    fail "sessão perdida após restart: ${body}"
  fi
  rm -f "$jar"

  note "teste de degradação (redis parado) ..."
  docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.servers.yml" stop redis >/dev/null 2>&1
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${API_BASE}/servers")"
  assert_status "/servers segue 200 com redis parado" 200 "$code"
  local hbody
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "${API_BASE}/health")"
  hbody="$(curl -s --max-time 4 "${API_BASE}/health")"
  if [ "$code" = "200" ] \
     && printf '%s' "$hbody" | grep -q '"status":"degraded"' \
     && printf '%s' "$hbody" | grep -q '"redis":"down"'; then
    pass "/health degraded + redis down com redis parado"
  else
    fail "/health inesperado com redis parado (http ${code} body=${hbody})"
  fi

  docker compose -f "${ROOT}/docker-compose.yml" -f "${ROOT}/docker-compose.servers.yml" start redis >/dev/null 2>&1
  local healthy=000
  for i in $(seq 1 30); do
    healthy="$(docker inspect "${REDIS_CONTAINER}" --format '{{.State.Health.Status}}' 2>/dev/null)"
    [ "$healthy" = "healthy" ] && break
    sleep 2
  done
  code=000
  for i in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${API_BASE}/health")"
    [ "$code" = "200" ] && break
    sleep 2
  done
  if [ "$code" = "200" ] && [ "$healthy" = "healthy" ]; then
    pass "recuperação: redis healthy e /health 200"
  else
    fail "recuperação falhou (redis=${healthy} health=${code})"
  fi
}

summary() {
  info ""
  info "=============================================="
  info "Smoke test: ${TOTAL} testes, ${PASS} OK, ${FAIL} falhas (fase=${PHASE} rollback=${ROLLBACK_MODE})"
  if [ "$FAIL" -gt 0 ]; then
    local f
    for f in "${FAILED[@]}"; do err "- ${f}"; done
    info "Resultado: FALHOU"
    return 1
  fi
  info "Resultado: OK"
  return 0
}

run_block_composition
run_block_functional
if [ "$PHASE" = "all" ] || [ "$PHASE" = "b" ]; then
  run_block_redis
fi

summary
