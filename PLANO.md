# Plano de implementação — Auth, RBAC, RCON automático e Gerenciamento de Servidores

Arquivo de memória do plano. Marque `[x]` os itens entregues (com data/hash do commit).

## Fase 1 — Auth, seed do Superadmin e RBAC
- [x] 1.1 Migração `users` no `ensureSchema` + `api/sql/schema.sql` (DDL p/ stack nova via `/docker-entrypoint-initdb.d`)
- [x] 1.2 `seedSuperadmin` (geração de senha + `ADMIN_CREDENTIALS.txt` gitignored, scrypt)
- [x] 1.3 `config.js`/`security.js` — envs Google, `requireAuth`/`requireAdmin`/`requireSuperadmin`, sessão com `user`
- [x] 1.4 Rotas `/auth/*` (login/logout/session/status/guard + Steam/Google com fluxo `pending`)
- [x] 1.5 `nginx.conf` — `auth_request` nas páginas protegidas + rewrites novas (`/login`, `/servidores`, `/usuarios`)
- [x] 1.6 `common.js` — `initAuthSession`, nav filtrada por role, badge de sessão, guard client-side
- [x] 1.7 `login.html`/`login.js`

## Fase 2 — RCON automático
- [x] 2.1 Remover card/form de senha RCON (`admin.html`/`admin.js`); `/admin/command` sob `requireAdmin`
- [x] 2.2 `system.html` com guard (`data-requires-admin`)

## Fase 3 — Gerenciamento de servidores
- [x] 3.1 `serverManager.js` (adapter docker: list/start/stop/restart/add/remove/availableMaps)
- [x] 3.2 `routes/adminServers.js` (GET /admin/servers, /maps, start/stop/restart, POST, DELETE)
- [x] 3.3 `servers.html`/`servers.js` (tabela + ações + wizard de adição espelhando setup.sh)
- [x] 3.4 Infra: `api/Dockerfile` (docker CLI), `docker-compose.yml` (socket, `/repo`, envs, initdb)

## Fase 4 — Aprovações de usuários
- [x] 4.1 `routes/adminUsers.js` (list/approve/reject/role/delete — só superadmin)
- [x] 4.2 `users.html`/`users.js`

## Fase 5 — Config e segurança
- [x] 5.1 `.env.example` (GOOGLE_CLIENT_*, GOOGLE_RETURN_URL, SEED_ADMIN, SERVER_MANAGER_PROVIDER, SERVER_REPO_DIR)
- [x] 5.2 `.gitignore` (+ `ADMIN_CREDENTIALS.txt`)

## Fase 6 — Testes e docs
- [x] 6.1 `scripts/smoke-test.sh` — fluxo novo de auth (credenciais do `ADMIN_CREDENTIALS.txt`), `/auth/guard`, `/admin/command`
- [x] 6.2 Validação: `node --check` (node:26), `nginx -t`, rebuild `api`, `./scripts/smoke-test.sh` (52/52 OK) + add/remove/restart de servidor validados via API
- [x] 6.3 `AGENTS.md` atualizado

## Comandos úteis
- Seed manual (reset de senha): `docker compose exec api node scripts/seed-admin.js`
- Rebuild API: `docker compose up -d --build api` + `docker compose restart web`
- Validação de JS (web): `docker run --rm -v "$PWD/web":/check node:26 sh -c 'for f in /check/*.js; do node --check "$f"; done'`
