# AGENTS.md

## Project Overview

CS Server Stats is a Counter-Strike 1.6 server monitoring system with a Node.js/Express API and vanilla JavaScript frontend. The stack includes MariaDB for stats storage, Redis for sessions/cache, and Nginx for serving the web frontend.

## Build/Lint/Test Commands

### API (Node.js)
```bash
# Install dependencies
cd api && npm install

# Run the API
cd api && npm start

# Run with docker (full stack)
docker compose up --build

# Run API container only (if other services are running)
docker compose up --build api
```

### Docker Commands
```bash
# Start full stack (uses COMPOSE_FILE from .env = base + generated override)
docker compose up --build

# Start in background
docker compose up -d --build

# View logs
docker compose logs -f api
docker compose logs -f web

# Restart a service
docker compose restart api

# Stop all services
docker compose down
```

### Multi-server provisioning
- `config/servers.list` is the single source of truth (first line = primary `main`). The primary always uses host port `27015` (fixed in `docker-compose.yml` base; `compose` errors out if the list says otherwise). Server ids must match `^[a-z0-9][a-z0-9_-]*$`. Format: `id name host_port map maxplayers rotate context` — `context` is the optional 7th column (web-spectator URL path, `^[a-z0-9]+$`, unique; default = slugified `name`, e.g. `Zueira` → `zueira`).
- `./scripts/setup.sh` — interactive wizard: asks how many servers/names, whether to rotate maps (and which maps, from the image's available pool), writes `servers.list` (backing up the old one to `servers.list.bak`), generates configs, and starts the stack (flags: `--no-up`, `--yes`).
- **Slots & bots**: `maxplayers` in `servers.list` = **visible** slots (even, 2..30; max **30**; `setup.sh` offers a 8/16/24/30 menu, `init` validates even 2..30 and rejects 32 with "máximo é 30"). The engine maxplayers is `visible + 1` (hidden slot always reserved for the HLTV via `sv_visiblemaxplayers <visible>` + AMXX plugin `slots_reserve.amxx`, which kicks the next non-HLTV occupant with `slots_reserve_msg`). CS 1.6 clamps `+maxplayers` to 32, so with max 30 visible (30+1=31) the hidden slot always exists and the plugin is just a safety net. `servers.sh compose` computes `MAXPLAYERS` with a defensive 32 cap. GameDig (API `/servers`) reads `sv_visiblemaxplayers`; the API filters the HLTV relay out of `players`/`playersList` (relays are named `<context>-hltv` in `config/watch/<id>/hltv.cfg`, filtered in `api/lib/serverCtx.js` `queryServer`), so empty servers report `0/30`. **Bot floor**: `cs16/Dockerfile` patches `podbot.cfg` to `pb_minbots 2` (file is CRLF — sed must match `^pb_minbots 0\r$`) so the HLTV relay connecting no longer kicks the last bot. PodBot `pb_maxbots 32` auto-refills bots as humans leave; `pb removebots` (via RCON) resets to the 2-bot floor.
- `./scripts/servers.sh up` — `init` + `compose` + `docker compose up -d --remove-orphans`. It does NOT pass `--build` (BuildKit's provenance metadata produces a new image ID on every build, which made compose recreate all CS containers on each `up`). Builds happen explicitly via `./scripts/servers.sh build`; `up` only builds automatically on first run when `cs16_stats:local` / `csserver_wstats-api` images don't exist yet. `servers.sh` runs compose with `COMPOSE_FILES` (`docker-compose.yml` + `docker-compose.servers.yml` + `docker-compose.watch.yml` **if present**) — the watch file is only loaded so the watch services are *known* (profile `watch` keeps them from being started), otherwise `up --remove-orphans` would tear down the running spectator stack.
- `./scripts/servers.sh compose` regenerates the committed overrides `docker-compose.servers.yml` (game servers + API `CS_SERVERS`, now including `spectatorUrl` = `WATCH_PUBLIC_BASE/<context>/` per server) and `docker-compose.watch.yml` (spectator), plus `config/watch/swag-locations.conf.example`; `prune [ids]` deletes config/live dirs of removed servers and, if confirmed (or `--metrics`), also deletes their Prometheus series via the Admin API (`--web.enable-admin-api`, bound to `127.0.0.1:9090`) so Grafana stops showing removed servers.
- `.env` sets `COMPOSE_FILE=docker-compose.yml:docker-compose.servers.yml:docker-compose.duckdns.yml`, so plain `docker compose ...` works after generation (swag/duckdns included). The spectator compose is NOT in `COMPOSE_FILE` — it's opt-in and only used by `watch.sh` (which passes `-f` explicitly).

### Docker Hub — `scripts/push-images.sh`
- Builds and pushes `$DOCKER_USER/csserver_wstats-cs16`, `-api` and `-watch-main` (from `.env` `DOCKER_USER`), tags `latest` + `$DOCKER_IMAGE_TAG` (default `v<AAAAMMDD>-<HHMM>`). Run `docker login` first. Images are generic — `valve.zip` and per-server configs are volumes, never baked in. `servers.sh up` only auto-builds locally when `cs16_stats:local`/`csserver_wstats-api` are missing; there is no automatic pull from Docker Hub.

### Monitoring — host e containers (Grafana/Prometheus)
- `node-exporter` (`cs16-node-exporter`) coleta métricas do **host**: CPU, memória e rede da interface física. Roda com `network_mode: host` + `pid: host` e bind-mount read-only `/:/host:ro,rslave` (`--path.rootfs=/host`) — é assim que vê `/proc`, `/sys` e os contadores de rede do host (por namespace, por isso host network é obrigatório; na rede bridge veria só as interfaces do próprio container). O Prometheus o alcança via `host.docker.internal:9100` (`extra_hosts: host-gateway` no serviço `prometheus`). Porta 9100 fica no 0.0.0.0 do host (LAN; não é encaminhada no roteador).
- `cadvisor` (`cs16-cadvisor`, `privileged`) coleta métricas **por container** da stack (CPU/memória/rede). **Atenção:** o host usa o **containerd snapshotter** (`driver-type io.containerd.snapshotter.v1`); o cAdvisor upstream (google/cadvisor) NÃO enxerga containers nesse storage (issue #3643, fechada como not_planned). Por isso a imagem é um **build local** do fork `dillon-giacoppo/cadvisor` (commit `d63def0`, branch `fix-3643-add-support-overlayfs-containerd`) via `cadvisor/Dockerfile` (imagem `cs16-cadvisor:local`; CPU/memória/rede funcionam, filesystem não). Mudanças no storage do Docker (voltar ao overlay2 clássico) permitiriam usar a imagem oficial `gcr.io/cadvisor/cadvisor` de novo.
- `config/prometheus.yml` tem 5 jobs: `cs16-api` (com Basic Auth), `nginx` (`nginx-exporter:9113`), `nginxlog` (`nginxlog-exporter:4040`), `node` (`host.docker.internal:9100`) e `cadvisor` (`cadvisor:8080`). **Atenção:** o Prometheus roda o config efetivo gerado no boot (`sed` das credenciais → `/tmp/prometheus.yml`), então mudanças no yml exigem `docker compose restart prometheus` (o `/-/reload` não enxerga o arquivo do host).
- `nginxlog-exporter` (`cs16-nginxlog-exporter`, `quay.io/martinhelmich/prometheus-nginxlog-exporter:v1`) lê o access log do nginx e expõe `nginxlog_http_response_time_seconds_{sum,count}` (média da resposta do **front**). O `web` bind-monta `./live/nginx-logs:/var/log/nginx` (host, gitignored) e o exporter lê o mesmo arquivo ro. O nginx usa `log_format metrics` (inclui `rt=$request_time`) em `web/nginx.conf` — o `format` em `config/nginxlog-exporter.hcl` DEVE espelhar exatamente a linha do log (senão viram `nginxlog_parse_errors_total`). Blocos `access_log off` (css/imagens/stub_status) ficam de fora da medição. Painel "Tempo médio de resposta — Front (ms)" (stat, unit `ms`, thresholds 0/200/500) usa `1000 * sum(rate(nginxlog_http_response_time_seconds_sum[30m])) / sum(rate(nginxlog_http_response_time_seconds_count[30m]))` — janela de 30m para o tráfego esparso (janelas de 5m dão 0/0=NaN).
- Dashboard `cs16-infra.json` (provisionado por arquivo; incremente `version` no JSON para o Grafana recarregar em ≤60s; `refresh` 5s e `time` now-24h) tem 3 seções: **API e Infra** (API/nginx), **Host** (CPU %, memória %, rede % da interface `$iface` — usa `node_network_speed_bytes`, variável custom `iface` default `eno1`) e **Stack — containers** (CPU/memória/rede por container e proporções, filtrando `container_label_com_docker_compose_project="csserver_wstats"` — o cAdvisor vê TODOS os containers do host, inclusive plex/noip de outros projetos; o label de projeto os exclui). Containers `network_mode: host` (watch-main/hltv) reportam contadores do namespace do host no cAdvisor — os painéis de rede são confiáveis para os demais serviços. Na seção **API e Infra**, ao lado do painel "Latência HTTP (p50/p95/p99)" (w=7), ficam empilhados (w=5, h=4) os 2 stats de média (mesmo formato do "Memória do host"): **API** (`cs16_http_request_duration_seconds`, `[30m]`) e **Front** (nginxlog, acima), ambos unit `ms` com thresholds verde <200 / amarelo <500 / vermelho ≥500 (base Apdex T=0,25s + RAIL).
- Grafana: credenciais são as do `.env` (`GRAFANA_ADMIN_USER/PASSWORD`, default admin/admin) mas **só valem no primeiro boot**; depois de inicializado o volume `grafana_data` guarda a senha interna própria (mudar o `.env` não altera a senha já criada). Porta do cAdvisor `127.0.0.1:8082` só p/ debug.

### Web spectator (WebRTC) — `scripts/watch.sh` (opt-in)
- **Multi-server**: one `watch-main-<id>` (proxy WebRTC->UDP) + `watch-hltv-<id>` (HLTV relay) per server in `servers.list`, all carrying `profiles: ["watch"]`, so `servers.sh up` / plain `docker compose up` never starts them. Manage with `./scripts/watch.sh up|down|build|ps|status|logs|restart|backup|restore`. `watch.sh up` builds `cs16_stats:local` if missing (relay image) and always rebuilds the proxy image `csserver_wstats-watch-main` (only `watch-main-<first>` carries the `build:` in compose; the rest reuse the image).
- **Ports** are derived from the server index `i` (position in `servers.list`) via `.env` bases: relay HLTV UDP `WATCH_HLTV_BASE+i` (27100+), watch-main listen TCP `WATCH_LISTEN_BASE+i` (27200+), WebRTC ICE UDP `WATCH_UDP_BASE+(i*WATCH_UDP_SIZE)` .. `+(i*WATCH_UDP_SIZE)+WATCH_UDP_SIZE-1` (27300+64 chunks). With 3 servers today: relays 27100/27101/27102, listen 27200/27201/27202, ICE 27300-27363/27364-27427/27428-27491. Each watch-main serves its server at `BASE_PATH=/<context>/` (`config/servers.list` context) — the proxy resolves `localhost:<context>/` to the right relay, so no upstream path-stripping is needed.
- **Per-server deploy config** is generated by `servers.sh init` in `config/watch/<id>/`: `hltv.cfg` (relay connects to the game server at `127.0.0.1:<host_port>`; `name`/`hostname` = `<context>-hltv`; `sys_ticrate 30`) and `start-hltv.sh` (auto-restart loop, pidfile for healthcheck, crash log to `/home/cs16/watch_logs/last_hltv_crash.txt` → mounted `./live/watch/<id>`). Editing a config only affects that server; `servers.sh compose` regenerates `docker-compose.watch.yml` (keep it committed).
- `watch/webxash3d-proxy` is a git **submodule** (fork `LeandroSalvas/webxash3d-proxy` of `bordeux/webxash3d-proxy`). Source + patches live there (see `PATCHES.md` in the fork): HLTV connect-ack rewrite, vendored `webrtc-dtls` curve negotiation (Chrome post-quantum), spectator client auto-reconnect/STUN, self-healing watchdog (stall → rejoin → silent reload), proxy bridge idle teardown, **`BASE_PATH` path contexts** (§15 — mount the proxy under `/<context>/`, it serves page+assets+`/websocket`+`/config` on that prefix and injects `<base href>` into the page). To bump: commit+push in the submodule, then `git submodule update --remote`-style update of the pointer (or `git -C watch/webxash3d-proxy pull` + `git add watch/webxash3d-proxy`).
- Spectator client robustness (client side of the submodule): a visibility-aware `requestAnimationFrame` shim keeps the engine loop alive while the tab is hidden (no netchan `cl_timeout` → no frozen screen on refocus), with `disconnect`+`connect` auto-rejoin after >60s hidden (`visibilitychange`). The net `incoming` backlog is raised to `maxPackets: 16384`: dropping the oldest packets broke the HLTV delta chain and permanently froze the renderer ("delta frame is too old" → `cl.validsequence=0`), so short hides now drain the backlog in order (fast-forward to live) and only long hides reconnect. **Active-tab freeze (overflow)**: the relay produces faster than the engine consumes (1 packet/frame via `recvfrom`), the buffer filled in ~3-7min and the oldest-packet drop broke the delta chain again while the stall watchdog stayed quiet (packets kept arriving) — fixed with a backlog high-watermark watchdog (`rejoin()` at 80% full, resets the chain before any drop) + `rejoin()` now flushes the buffer (`netClear()`); the relay runs at `sys_ticrate 30` (`config/watch/<id>/hltv.cfg`) so production matches consumption. **Microphone**: `getUserMedia` is stubbed to reject in `index.html` (the engine glue — SDL2/AL voice capture in `xash3d-fwgs` — still calls it at boot and showed a permission prompt even for spectators). Loading screen shows PT-BR stage messages + custom progress bar (crosshair `loading.png` from the site's `favicon.svg`); `window.onerror`/WebGL2 check surface errors instead of a black screen. Loading/reconnect fixes require a full client rebuild (`./scripts/watch.sh build`).
- **Self-healing (commit `763895d`)**: the upstream (HLTV/game server) can die without the WebRTC peer noticing (SCTP keepalives keep the peer "Connected" while packets stop). Client: `lastPacketAt` tracks the last game packet; a 2s watchdog forces `rejoin()` (disconnect + connect over the same live WebRTC channel) when idle ≥ `STALL_MS = 15000`; after `REJOIN_ATTEMPTS_BEFORE_RELOAD = 6` failed rejoins it reloads the page **once**, silently (guarded by `sessionStorage.watchStallReloaded`) — the upstream `beforeunload` dialog was removed so the auto-reload isn't blocked. Proxy (`src/bridge.rs`): `forward_udp_to_webrtc` tears the bridge down after `IDLE_TIMEOUT = 25s` without upstream UDP data (armed on `saw_packet || browser_started`, where `browser_started` avoids a teardown while the valve.zip download/connect handshake is still running), signaling the client to reconnect via `scheduleReconnect()`. The write-channel `onclose`/`onerror` also call `scheduleReconnect()`. On a game-server restart the session survives: HLTV renegotiates the connect ack with the existing spectator and the stream resumes without reload. **Transport rebuild → rejoin (commit `c05425b`)**: a WS/peer reset leaves the engine with a stale netchan baseline — packets flow again (the stall watchdog sleeps because `lastPacketAt` stays fresh) but the broken HLTV delta chain froze the screen forever even with a healthy stream. Rebuilt transport pairs now fire `onReconnected` → `rejoin()` (re-syncs the baseline in ~2s, no reload, no valve.zip re-download); the watchdog escalates to `forceReconnect()` (immediate WS+peer rebuild) every 12 stalls once the `sessionStorage` reload guard is consumed, instead of rejoining forever over a dead channel (see submodule `PATCHES.md` §12).
- **HLTV relay can go "silent"** (process alive + connected to the game server but no data to spectators): the watchdog/teardown unlock the frozen spectator; the **operational recovery is `scripts/watch-mudo.sh`** (cron every minute, checks all servers in `servers.list`, or `watch-mudo.sh <id>...` for specific ones), which detects mudo by **game-packet rate** — the proxy logs `recving N bytes` per UDP packet; the HLTV keepalive is exactly 48 bytes (~every 2s), a healthy stream is ~99% game packets (≠48B) at ~10-20/s, while mudo/degraded is keepalive-only (or a ~0.3-0.5/s trickle). It kicks the HLTV via RCON when there are **fewer than 45 ≠48B packets in 90s** and a bridge is **currently active** (openings − closings in the last 10 min > 0, so a viewer who closed the tab isn't a false positive) — a relay `docker restart` was proven NOT to fix the mudo (the relay reconnected but stayed silent), while the kick forces a fresh netchan handshake (~20s recovery). If the kick doesn't land it escalates to `docker restart cs16-watch-hltv-<id>`; after 3 consecutive episodes it logs a warning to restart the game server (`docker compose restart cs16<id>`; HLTV reconnects in ~20s), the definitive fix. Per-server state/logs live in `live/watch/<id>/` (`mudo.log`, `.mudo_last_action`, `.mudo_count`). Also fix in the client: `sendto()` is guarded (never throws `InvalidStateError` on a closed channel, which used to abort the WASM frame — see submodule `PATCHES.md` §11).
- **WS keepalive (commit `c05425b`)**: game data goes over WebRTC/UDP, so the signaling WebSocket idles after the handshake and a ~240s idle timeout on an intermediate proxy/NAT (swag/router) reset it every 4 minutes ("Connection reset without closing handshake" → full WebRTC rebuild → ~2-3s stream gap; deterministic 242-243s intervals). The client now sends `{"event":"ping"}` every 60s (started on WS open, cleared on error/close) with a silent `ping` handler in `signaling.rs` — the idle timer at every hop never fires and sessions stay up indefinitely (10+ min continuous in production, previously a reset every 4 min; see submodule `PATCHES.md` §13).
- `valve/valve.zip` (proprietary Half-Life assets) is **gitignored**; `watch.sh backup|restore` copies it to `./backups/`. The compose mounts it read-only into `watch-main` (`PACKAGE_ZIP=/valve/valve.zip`).
- **valve.zip download (PATCHES.md §14)**: the proxy hashes the zip (SHA-256) once at boot, exposes it in `/config` (`package_zip: {sha256, size}`) and as `ETag`, and serves with `Range`/`Accept-Ranges` support, streaming from disk (no more 449MB-per-request `read_to_end`). The client downloads in 8 parallel byte ranges and persists the blob in IndexedDB keyed by the fingerprint, so returning spectators skip the download entirely; anything failing (private mode, quota, no Range) falls back to a single stream. Rebuild client+proxy with `./scripts/watch.sh build` after changing `client/src/main.ts` or `src/main.rs`.
- Deploy config (not in the fork) is generated by `servers.sh init` into `config/watch/<id>/`: `hltv.cfg` (relay connects to `127.0.0.1:<host_port>` of that server) and `start-hltv.sh` (auto-restart loop, pidfile for healthcheck, crash log to `/home/cs16/watch_logs/last_hltv_crash.txt` → mounted `./live/watch/<id>`).
- Networking: every `watch-main-<id>` listens on host TCP `27200+i` (page + `/websocket` signaling) and WebRTC UDP in its `27300+(i*64)..+63` range, all `network_mode: host`. It resolves the browser's mDNS `.local` candidates over the LAN (same-LAN viewers connect via the host candidate `192.168.15.54`) and discovers the public IP via STUN (`stun.l.google.com`) per connection — no `WATCH_PUBLIC_IP` hardcoded anymore (a stale public IP used to break external/mobile viewers when the ISP's dynamic IP changed). The host bindings `27200-27202` (TCP), relays `27100-27102` (UDP) and the WebRTC UDP range `27300-27491` are internal (swag→watch-main→relay→game server; LAN only) — **no router port forwarding is needed** (no port-forward, no DMZ): all external access goes through swag on `:4445` (TLS/WSS), and the WebRTC media reaches the proxy's fixed UDP range via STUN-discovered public IP + the router's automatic NAT traversal.
- TLS exposure: swag (**part of the stack** — `docker-compose.duckdns.yml` at the repo root, in `COMPOSE_FILE`; data in `duckdns/`, gitignored) serves each spectator on `https://zueiracstrike.duckdns.org:4445/<context>/` via `proxy-confs/zueiracstrike-watch.subdomain.conf` → `http://192.168.15.54:27200+i`, and the main site on `:4443` (redirect HTTP `:8000`). `servers.sh compose` writes the location blocks (`proxy_pass` WITHOUT trailing slash — the proxy keeps the `BASE_PATH` prefix) to `config/watch/swag-locations.conf.example` **and auto-syncs the live conf** (`apply_swag_locations`, called at the end of `cmd_compose`, so it covers `up`/`compose`/`provision`/`unprovision`; manual re-sync via `servers.sh swag-sync`): it rewrites only the region between `# BEGIN servers.sh swag locations` / `# END servers.sh swag locations` (first run migrates the legacy blocks), takes a one-time `${conf}.bak`, and restarts the swag container (`SWAG_CONTAINER`, default `swag`) only when the file changed AND `docker exec swag nginx -t` passes. Blocks derive from `servers.list`, so removing a server drops its location too. The live conf is in `duckdns/swag/config/nginx/proxy-confs/` (inside the repo, gitignored); `apply_swag_locations` resolves its path as `SWAG_PROXY_CONF` (env) → `${ROOT}/duckdns/...` → `$HOME/duckdns/...` → `dirname $ROOT/duckdns/...` (legacy fallback; without `duckdns` on the host it warns and continues). The api's disposable provision container (add/remove via UI, `serverManager.js` `runProvision`) mounts the repo at the SAME absolute host path + the docker socket (no parent dir mount anymore, sempre existe — sem risco de o docker criar dirs vazios). O `apply_swag_locations` grava o arquivo via `mktemp`+`mv` **só quando o conteúdo muda** e restaura dono/modo originais (`stat`/`chown`/`chmod`) — se rodar do container de provisionamento (root) sem isso, o conf viraria root:root 0600 e o host não conseguiria mais ler (já aconteceu). **Atenção swag/cert**: o `init-certbot-config/run` do swag (imagem `lscr.io/linuxserver/swag:latest` de ~2026) tem um check "old LE root" quebra­do — testa se o emissor do 1º cert do `chain.pem` contém "ISRG Root X", mas a cadeia atual do Let's Encrypt (YE2→Root YE) faz o check falhar SEMPRE, então TODO restart revogava o cert e reemitia, queimando a cota do LE (5 certs/168h p/ o mesmo domínio → swag sem cert e unhealthy por horas). O fix é **durável**: `duckdns/init-certbot-config.run` (cópia patcheada do script da imagem, removido o `!` do check) é montado **read-only** por cima do arquivo do s6 no `docker-compose.duckdns.yml`, então o swag **não reemite** o cert em restart nem em recreate (só atualizar o swag quebra o contorno — o mount sobrevive, mas se a imagem mudar o path interno, remontar o patch). Backup dos certs: `duckdns/backups/config-*.tar.gz` (restaurar `etc/letsencrypt/{live,archive,renewal}` resolve sem queimar cota). The client uses `window.location.host`, so it becomes `wss://...:4445/<context>/websocket` automatically. **No router forwarding needed**: growing `servers.list` requires nothing on the router — the only requirement is the host listening on the per-index `i` (0-based) TCP/UDP ranges derived from `.env` bases (relay UDP `27100+i`, watch-main TCP `27200+i`, WebRTC ICE UDP `27300+(i*64)..+(i*64)+63`; with 4 servers today: `27100-27103`, `27200-27203`, `27300-27555`), all reached internally from swag `:4445`. Frontend: `/servers` returns `spectatorUrl` per server; the "Assistir" button/iframe on `cstv.html`/`live.html` follows the server selector (`data-watch-link`, `data-spectator-frame`), with `SPECTATOR_URL` as static fallback in `web/common.js`.
- Healthchecks: each `watch-main-<id>` hits `/health` (image includes `wget`); `watch-hltv-<id>` checks the HLTV pidfile. `watch.sh status` shows health + last HLTV crash time per server.

### API upgrades (`scripts/smoke-test.sh` / `scripts/upgrade.sh`)
- The API runs **Node 26** + **Express 5** (Dockerfile `node:26`; `npm ci --omit=dev` requires the committed `api/package-lock.json`). The host has no Node — lockfile and `node --check` run inside `node:26` (done automatically by `upgrade.sh`).
- `./scripts/smoke-test.sh` validates the running API; exit 0 = healthy. Block 1: composition (Node major + `npm ls` deps + robustez markers + graceful shutdown via a disposable container). Block 2: functional (health, rankings, 400s/404, metrics `cs16_`, SSE `: ping`, admin login/logout + CSRF, 6th login → 429). Block 3: redis/session (new `sess:*` keys, persistence across api restart, degradation with redis stopped). Expected versions are **derived from the current source** (Dockerfile/package.json), so the same script validates upgrades and rollbacks. Flags: `--fase a|b`, `--rollback` (skips rate-limit/SIGTERM/robustez).
- `./scripts/upgrade.sh --fase a|b` runs an upgrade with automatic rollback: snapshot (`csserver_wstats-api:rollback-<ts>` + HEAD recorded in `.rollback-state`, gitignored) → apply changes → lockfile → build → `up -d api` → health gate → smoke. On smoke failure it restores image + code (`git reset --hard`) and revalidates with `smoke-test.sh --rollback`. `--no-auto-rollback` stops for manual inspection; `upgrade.sh rollback [tag]` and `upgrade.sh list` manage snapshots. Nothing besides the `api` service is touched.
- Express 5 / rate-limit v8 notes: keep the per-route try/catch (a global 4-arg `errorHandler` catches anything that escapes); use `limit:` not `max:`; graceful shutdown ends SSE clients, then `server.close()` → db pool + redis `quit()` → exit 0; `process.on('unhandledRejection'/'uncaughtException')` logs and `exit(1)`s.
- The smoke login/rate-limit tests consume the shared 60s `loginLimiter` window (all host requests share 127.0.0.1), so block 3 retries until the window passes; running a full smoke briefly locks out login for the host IP.

### Autenticação & RBAC (`api/lib/auth.js`, `api/lib/security.js`)
- Auth: sessão em cookie httpOnly (Redis/`memory`), senha scrypt, CSRF duplo (cookie `csrf_token` + header `x-csrf-token`, validado em toda mutação). Providers: **local** (`/auth/login`, superadmin) + **Google OAuth2** e **Steam OpenID** (completam o `session.user`). Tabela `users` no MariaDB (migração no `ensureSchema` + DDL em `api/sql/schema.sql`).
- Papéis: `superadmin`, `admin`, `pending`. **Todo 1º login social nasce `pending`** — o superadmin aprova/rejeita/define papel em `web/users.html` (`api/lib/routes/adminUsers.js`, só superadmin; antes, o login aprova 401 com `error: 'pending'`). Superadmin = acesso total; admin = operações de servidor (RCON/controle) e páginas `/servidores`; usuário comum = somente stats.
- Seed: `seedSuperadmin()` no boot cria o superadmin idempotente a partir de `SEED_ADMIN` (`.env`), gera senha aleatória e grava **`ADMIN_CREDENTIALS.txt** (formato `username:`/`password:`, 0600, **gitignored**, `chown` para o dono do diretório quando existir; regenerável com `docker compose exec api node scripts/seed-admin.js --reset`). `STEAM_ADMIN_IDS` foi **removido** (todo login social é pending).
- Guardas: `requireAuth`/`requireAdmin`/`requireSuperadmin` (montam `req.user` da sessão). `/auth/guard` (público) retorna 200 se admin ativo, senão 401 — é o que o **nginx** usa em `auth_request` nas locations `=/admin.html`, `=/system.html`, `=/servers.html`, `=/users.html` (com `@login_redirect` → 302 `/login?next=$request_uri`). Rotas `web/*.html` protegidas de verdade no server; `common.js` replica o guard client-side (`guardPage`/`data-requires-admin`) + badge de sessão. Rate limit de login: 5/60s por IP → 429.
- `web/login.html`/`login.js`: login local + botões Steam/Google; qualquer rota protegida redireciona para `/login?next=...` e volta após autenticar.

### Gerenciamento de servidores (`api/lib/serverManager.js`, `api/lib/routes/adminServers.js`)
- **RCON automático para admins**: a antiga senha RCON do card do admin.html sumiu; `/admin/command` agora roda sob `requireAdmin` e o RCON usa a credencial do servidor.
- Adapter `serverManager.js`: lista/start/stop/restart/add/remove/mapas via **docker CLI no socket** (montado `-v /var/run/docker.sock` no container `api`, que também monta o repo em `/repo`). `list()` filtra containers pelo label `com.docker.compose.service` (não valor) e enriquece com `servers.list`; retorna `{id, name, context, hostPort, map, maxplayers, rotate, containerState, containerStatus, online}`.
- **Provisioning (add/remove)**: roda `servers.sh up` num container descartável (mesma imagem da api, com docker CLI + compose). **Cuidado com os paths**: o compose resolve os `./config/...` dos binds contra o `working_dir`, mas o daemon monta contra o path do **HOST** — por isso o repo é montado no MESMO caminho absoluto do host (ex.: `-w /home/salvas/csserver_wstats -v /home/salvas/csserver_wstats:/home/salvas/csserver_wstats`) e não em `/repo`; também é forçado `COMPOSE_PROJECT_NAME=<basename do path do host>` (senão vira o projeto "repo"). O script `servers.sh` inclui o `docker-compose.watch.yml` nos `COMPOSE_FILES`, então o `--remove-orphans` **não** derruba o espectador.
- **Efeito colateral esperado**: add/remove regeneram o override (`api` entra com `CS_SERVERS` novo), então o compose **recria o container da api** no meio do request — o chamador recebe 502/conexão cortada, mas a operação **conclui** (a resposta não chega; o frontend `web/servers.js` trata o erro de rede como "provisionando, recarregando..."). Start/stop/restart não recriam a api (sem mudança de config) e respondem normal.
- Rollback de `servers.list`: `writeServersList` preserva o cabeçalho de comentários existente (faz `.bak`); `add()`/`remove()` revertem a lista se o provision falhar. Containers/configs root-owneds gerados por provision precisam de limpeza via container (que roda como root).
- Rotas: `GET /admin/servers`, `GET /admin/servers/maps`, `POST /admin/servers/:id/{start,stop,restart}`, `POST /admin/servers` (add), `DELETE /admin/servers/:id` — todas `requireAdmin` + CSRF + `commandLimiter`.

### Environment Configuration
```bash
# Copy environment template
cp .env.example .env

# Required variables in .env:
# MYSQL_ROOT_PASSWORD, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD
# DB_HOST (default: db), SESSION_SECRET, SESSION_STORE (redis/memory)
# REDIS_HOST (default: redis), REDIS_PORT (default: 6379)
```

### Passwords & Accounts
- The password in `users.ini` (AMXX admin account, set via client `setinfo _pw "<senha>"`) is **NOT** the RCON password. They are independent.
- RCON password = `RCON_PASSWORD` in `.env`, applied to `rcon_password` in each `config/servers/<id>/server.cfg` (generated from `config/templates/server.cfg`). Must match for RCON to work.
- Admin accounts live in `config/users.ini` (tracked master); `scripts/servers.sh init` copies it to `config/servers/<id>/users.ini` (gitignored, bind-mounted into the CS containers). Account flag `a` = kick on invalid password; AMXX re-reads `users.ini` only on map change.
- Per-server `config/servers/*/users.ini` must be kept in sync with the master manually (init only copies when the per-server file doesn't exist).

### Port Access
- Frontend: http://localhost:8080
- API via proxy: http://localhost:8080/api
- Health check: http://localhost:8080/api/health

## Code Style Guidelines

### Language & Module System
- Use **CommonJS** (`require()` / `module.exports`)
- No ES modules or TypeScript
- Place API code in `api/index.js` (monolith) or split into `api/routes/`, `api/db/`, etc.

### JavaScript Conventions
- Use `const` and `let`; avoid `var`
- Use **async/await** for asynchronous operations
- Use **arrow functions** for callbacks and inline functions
- Use **template literals** for string interpolation

### Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `lastState`, `redisClient` |
| Constants | SCREAMING_SNAKE_CASE | `sessionStoreType` |
| Functions | camelCase, verb prefix | `getCurrentMap()`, `snapshot()` |
| Routes | kebab-case paths | `/top-headshots`, `/map-ranking` |
| SQL tables | snake_case | `csstats`, `csstats_snapshots` |
| SQL columns | snake_case | `kill_streak`, `last_join` |

### SQL Style
- Use **UPPERCASE** for SQL keywords
- Always use **parameterized queries** (`?` placeholders) to prevent SQL injection
- Format multi-line queries with keywords on separate lines for readability

### Error Handling
- Wrap async route handlers in try/catch blocks
- Return appropriate HTTP status codes:
  - `200` for success
  - `400` for bad request (missing required fields)
  - `401` for authentication failures
  - `500` for server errors
- Log errors with `console.error()` including context
- Never expose internal error details to clients in production

### Database Connections
- Use **connection pools** (`mysql.createPool`)
- Use **async/await** with `db.query()` for all queries
- Handle connection failures gracefully (API should still respond even if DB is temporarily down)

### Redis
- Redis is optional (`SESSION_STORE=memory` bypasses it)
- Handle Redis connection failures without crashing the API
- Use reconnection strategies with exponential backoff

### API Routes Structure
```javascript
app.get('/resource', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT ...', [params])
    res.json(rows)
  } catch (err) {
    console.error('Error message:', err)
    res.status(500).json({ error: err.message })
  }
})
```

### Frontend JavaScript (`web/`)
- Vanilla JS only (no frameworks)
- Use `fetch()` for API calls
- Helper functions in `common.js` are shared across pages
- DOM manipulation via `document.getElementById()` and `document.createElement()`
- Event listeners attached after DOM is ready

### File Organization
```
csserver_wstats/
├── api/                  # Node.js API
│   ├── index.js          # Main entry (monolith)
│   ├── package.json
│   └── Dockerfile
├── web/                  # Frontend static files
│   ├── app.js            # Homepage logic
│   ├── common.js         # Shared utilities
│   ├── *.html            # HTML pages
│   └── nginx.conf        # Nginx config
├── config/               # CS server config
├── live/                 # Runtime data files
├── docker-compose.yml
└── .env.example
```

### Comments
- Use comments sparingly in code
- Add comments only when explaining non-obvious business logic or workarounds
- Portuguese comments exist in existing code; match the surrounding context language

### Security
- Never commit `.env` files
- Parameterize all SQL queries
- Use `httpOnly` cookies for sessions
- Validate all user input in route handlers

### Git Workflow
- Commit messages: concise, imperative mood ("Add top-killstreak endpoint")
- Keep commits focused on single changes
- Test changes with `docker compose up --build api` before committing
