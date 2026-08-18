# CS Server Stats

> Servidor de Counter-Strike 1.6 com painel de estatísticas integrado.
> Counter-Strike 1.6 server with integrated statistics dashboard.

---

## 🇧🇷 Português (BR)

### Visão geral

CS Server Stats é um projeto completo de Counter-Strike 1.6 com painel de estatísticas integrado e **suporte multi-servidor**. Cada servidor roda com AMX Mod X configurado, coleta e armazena estatísticas de partidas em tempo real, e o painel web expõe rankings, perfis de jogadores, placar ao vivo, killfeed e **espectador web (WebRTC)**. Toda a stack é orquestrada com Docker Compose: servidores de jogo, MariaDB, Redis, API Node.js, frontend Nginx, monitoramento (Prometheus/Grafana), proxy TLS **swag** e DNS dinâmico **duckdns** — todos integrados num único projeto.

### Arquitetura

O projeto é orquestrado com Docker Compose. Os serviços base são:

| Serviço | Descrição |
|---------|-----------|
| `cs16` | Servidores de jogo Counter-Strike 1.6 com ReHLDS, ReGameDLL, AMX Mod X e stats plugin. Suporta 5 modos de jogo (standard, zombies, csdm, surf, gungame) com plugins e configs específicas por modo (um container por servidor; o primário é o `main`) |
| `db` | MariaDB para armazenamento de estatísticas |
| `redis` | Cache e armazenamento de sessões |
| `api` | Backend Node.js (Express) com endpoints REST |
| `web` | Frontend estático servido via Nginx com proxy reverso para a API |
| `prometheus` | Coleta de métricas da API (`/api/metrics`) e do Nginx |
| `grafana` | Dashboards de monitoramento (porta 3001) |
| `nginx-exporter` | Expositor de métricas do Nginx (consumido pelo Prometheus) |
| `nginxlog-exporter` | Métricas do access log do front (tempo médio de resposta) |
| `node-exporter` | Métricas do **host** (CPU/memória/rede, `network_mode: host`) |
| `cadvisor` | Métricas **por container** (CPU/memória/rede da stack) |
| `swag` | Proxy TLS reverso (TLS/DDNS): site em `:4443`, espectadores em `:4445`, redirect HTTP em `:8000` |
| `duckdns` | DNS dinâmico (atualiza `zueiracstrike.duckdns.org`) |

Além destes, há os serviços **opt-in** do espectador web (`profiles: ["watch"]`, nunca sobem com `docker compose up` simples — veja a seção [Espectador web](#espectador-web-webrtc)):

| Serviço | Descrição |
|---------|-----------|
| `watch-main-<id>` | Proxy WebRTC→UDP por servidor: serve a página do espectador e faz a ponte para o relay HLTV |
| `watch-hltv-<id>` | Relay HLTV por servidor: entre o servidor de jogo (`127.0.0.1:<host_port>`) e o espectador no browser |

O **swag** (proxy TLS) e o **duckdns** (DNS dinâmico) são **parte da stack** (`docker-compose.duckdns.yml`, incluído no `COMPOSE_FILE`): expõem o site principal em `https://zueiracstrike.duckdns.org:4443` e cada espectador em `https://zueiracstrike.duckdns.org:4445/<context>/`.

### Instalação

> Para um guia completo de instalação do zero, incluindo pré-requisitos, configuração do `.env`, servidores de jogo, HTTPS, espectadores, bot Discord e troubleshooting, veja **[INSTALL.md](INSTALL.md)**.

### Funcionalidades

#### Servidor de Jogo

- Counter-Strike 1.6 com **ReHLDS**, **ReGameDLL**, Metamod-R, ReUnion e **AMX Mod X 1.10**
- **5 modos de jogo**: standard (CS clássico), zombies (Zombie Plague 5.0.8a), csdm (ReDeathmatch), surf (Survival Surf), gungame (GunGame)
- Cada modo tem plugins, configs e MOTD próprios (templates em `config/templates/modes/` e `config/templates/motd/`)
- Configurações de servidor centralizadas (`server.cfg`, `users.ini`, `mapcycle.txt`, `motd.txt`)
- UAC (User Access Control) para proteção contra exploração de bugs
- ZBot com modo `fill` (preenche vagas com bots, piso de 2 bots, slot reservado ao HLTV)
- Stats plugin integrado para coleta automática de dados
- Multi-servidor: vários servidores com porta, mapa, modo e arquivos live próprios (`config/servers.list` é a fonte da verdade)
- **CSTV opt-in por servidor**: a 9ª coluna `cstv` em `servers.list` controla quais servidores têm espectador web (watch-hltv + watch-main)

#### Modos de Jogo

O projeto suporta 5 modos de jogo, cada um com plugins e configurações específicas:

| Modo | Descrição | Plugins principais |
|------|-----------|-------------------|
| `standard` | CS 1.6 clássico (bomb/defuse, rescue) | `csstatsx_sql`, `live_scoreboard`, `live_killfeed`, `slots_reserve` |
| `zombies` | Zombie Plague 5.0.8a (humans vs zombies) | `zp50_*` (70+ plugins), `live_scoreboard`, `live_killfeed` |
| `csdm` | ReDeathmatch (deathmatch com classes) | `redm_*` (classes), `csdm_*` (spawns), `live_scoreboard`, `live_killfeed` |
| `surf` | Survival Surf (surf em mapas customizados) | `live_scoreboard`, `live_killfeed` |
| `gungame` | GunGame (progressão de armas por kills) | `regg_*` (regg engine), `live_scoreboard`, `live_killfeed` |

- A 8ª coluna `mode` em `servers.list` define o modo (default: `standard`)
- Cada modo tem templates de `server.cfg` e `plugins.ini` em `config/templates/modes/`
- Cada modo tem MOTD personalizado em `config/templates/motd/`
- Plugins por modo ficam em `cs16/vendor/mode_plugins/<modo>/`
- **CSTV indisponível para modo zombies** (restrição no frontend e backend)

#### Painel Web

- Status do servidor e estatísticas em tempo real
- Rankings de jogadores (geral, semanal, mensal e por mapa)
- Perfis individuais com gráfico de evolução de kills e histórico diário
- Estatísticas avançadas: top headshots, precisão, killstreaks, assistências, dano, TK, bomb e tempo conectado
- Placar ao vivo e killfeed em tempo real (SSE)
- **Autenticação & RBAC**: login local (superadmin) + Google OAuth2 e Steam OpenID com papéis `superadmin`/`admin`/`pending` (1º login social entra como `pending` e é aprovado em `/usuarios`), CSRF de cookie duplo e rate limit de login (5/60s)
- **Gerenciamento de servidores pelo painel** (`/servidores`): add/remove/start/stop/restart via UI (docker CLI no socket), RCON automático para admins
- Monitoramento multi-servidor (status de vários servidores na página Sistema)
- Alertas de online/offline via webhook (Slack/Discord/Teams)
- **Bot Discord**: gerencia servidores, stack e espectadores por comandos no chat (prefixo `!`) — veja [Bot Discord](#bot-discord-gerencia-a-stack-pelo-chat)
- Rastreamento de partidas (placar, vencedor e duração por mapa)
- Métricas Prometheus + dashboards Grafana
- Suporte a dois idiomas (Português/Inglês)
- Sistema de snapshots para rastrear progresso histórico
- Guia de conexão com suporte ao protocolo Steam

#### Monitoramento (Prometheus & Grafana)

- 5 jobs de scrape: `cs16-api` (com Basic Auth), `nginx`, `nginxlog`, `node` (host) e `cadvisor` (por container)
- `node-exporter` com `network_mode: host` + `pid: host` para métricas reais do host (CPU/memória/rede do eno1)
- `cadvisor` por container — a imagem é um **build local** do fork `dillon-giacoppo/cadvisor` (suporte ao containerd snapshotter do Docker; a imagem oficial não enxerga containers nesse storage)
- Grafana em `:3001` com datasource e dashboards provisionados por arquivo (`config/grafana/provisioning/`, `cs16-infra.json`)
- Admin API do Prometheus (`127.0.0.1:9090`) usada pelo `servers.sh prune --metrics`

#### Espectador Web (WebRTC)

- Assistir **qualquer servidor** no navegador via relay HLTV (cliente Xash3D WASM), sem instalar nada — um par `watch-main`/`watch-hltv` por servidor de `config/servers.list`, cada um em seu path `/contexto/`
- Página CSTV (`/cstv.html`) com o espectador embutido em iframe + seletor de servidor
- Auto-recuperação: watchdog de stall no cliente (rejoin + reload silencioso) e teardown de idle na bridge do proxy — a sessão sobrevive até reinícios do servidor de jogo
- Exposição TLS via **swag** (parte da stack, `docker-compose.duckdns.yml`): `https://...:4445/<context>/`, com os blocos `location` sincronizados automaticamente por `servers.sh compose`/`swag-sync`
- Controle de **volume do espectador** por aba (Web Audio, slider persistente)
- Opt-in (não sobe na stack padrão), gerenciado por `./scripts/watch.sh`

### Pré-requisitos

- Docker
- Docker Compose
- Portas disponíveis:
  - **8080** (painel web)
  - **27015** (servidor primário UDP/TCP), **27016+** (demais servidores, uma porta cada)
  - **27100+** (relay HLTV UDP por servidor), **27200+** (espectador: página + signaling WebSocket), **27300+** (UDP WebRTC, faixa de 64 portas por servidor)
  - **8000** (HTTP → redirect HTTPS via swag), **4443** (HTTPS do site principal), **4445** (HTTPS do espectador) — tudo via swag
  - **3001** (Grafana) e **9090** (Prometheus, bind local); **8082** (cAdvisor, bind local, debug)
  - Internos (sem bind no host): `9113` (nginx-exporter) e `4040` (nginxlog-exporter)

### Início Rápido

**1. Clone o repositório (com submodules):**

```bash
git clone --recurse-submodules <repo-url>
cd csserver_wstats
```

**2. Configure o arquivo de ambiente:**

```bash
cp .env.example .env
```

Abra `.env` e defina os valores. No mínimo, configure:

```
MYSQL_ROOT_PASSWORD=<senha-forte>
MYSQL_DATABASE=csstats
MYSQL_USER=csuser
MYSQL_PASSWORD=<senha-forte>
SESSION_SECRET=<string-long-aleatoria>
RCON_PASSWORD=<mesma-senha-do-server.cfg>
```

**3. Inicie o ambiente:**

```bash
docker compose up -d --build
```

**4. Acesse o painel:**

Abra o navegador em `http://<seu-host>:8080`

### Configuração

#### Variáveis de ambiente

**Obrigatórias:**

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `MYSQL_ROOT_PASSWORD` | Senha do root do MariaDB | `minha_senha_root` |
| `MYSQL_DATABASE` | Nome do banco de dados | `csstats` |
| `MYSQL_USER` | Usuário do banco | `csuser` |
| `MYSQL_PASSWORD` | Senha do usuário | `minha_senha` |
| `SESSION_SECRET` | Segredo para sessões Express | `uma-string-muito-longa-e-aleatoria` |
| `RCON_PASSWORD` | Senha RCON dos servidores (gerada em `config/servers/<id>/server.cfg`) | `rcon123` |
| `DUCKDNS_TOKEN` | Token do DuckDNS (swag valida o cert e o duckdns atualiza o IP) | `xxxx-xxxx-xxxx` |

**Opcionais:**

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DB_HOST` | `db` | Host do banco de dados |
| `SESSION_STORE` | `redis` | Armazenamento de sessão: `redis` ou `memory` |
| `REDIS_HOST` | `redis` | Host do Redis |
| `REDIS_PORT` | `6379` | Porta do Redis |
| `REDIS_PASSWORD` | *(vazio)* | Senha do Redis |
| `REDIS_DB` | `0` | Índice do banco Redis |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080,http://192.168.15.54:8080` | Origens permitidas (separadas por vírgula) |
| `GAMEDIG_HOST` | `cs16` | Host do servidor de jogo (usado pelo Gamedig) |
| `GAMEDIG_PORT` | `27015` | Porta do servidor de jogo |
| `CS_SERVERS` | *(vazio)* | JSON array de servidores monitorados (multi-servidor); a primeira entrada é a principal |
| `ALERT_WEBHOOK_URL` | *(vazio)* | URL de webhook (Slack/Discord/Teams) notificada em mudanças online/offline |
| `SEED_ADMIN` | `1` | Se `1`, cria o superadmin local no boot e grava `ADMIN_CREDENTIALS.txt` (gitignored) |
| `ADMIN_USERNAME` | *(vazio)* | Username do superadmin local (padrão: gerado aleatório) |
| `STEAM_RETURN_URL` | *(vazio)* | URL pública de retorno do login Steam (OpenID). **Obs.:** todo 1º login social entra como `pending` e precisa de aprovação do superadmin |
| `GOOGLE_CLIENT_ID` | *(vazio)* | Client ID do OAuth2 do Google |
| `GOOGLE_CLIENT_SECRET` | *(vazio)* | Client secret do OAuth2 do Google |
| `GOOGLE_RETURN_URL` | *(vazio)* | URL de callback autorizada do Google (`https://...:4443/api/auth/google/callback`) |
| `METRICS_USER` | *(vazio)* | Usuário do Basic Auth do `/api/metrics` (apenas alfanumérico) |
| `METRICS_PASS` | *(vazio)* | Senha do Basic Auth do `/api/metrics` |
| `GRAFANA_ADMIN_USER` | `admin` | Usuário admin do Grafana |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Senha admin do Grafana (vale só no 1º boot; o volume `grafana_data` guarda a senha posterior) |
| `DOCKER_USER` | *(vazio)* | Usuário do Docker Hub (`scripts/push-images.sh`) |
| `DISCORD_BOT_TOKEN` | *(vazio)* | Token do bot Discord que gerencia a stack por comandos `!` no chat (requer o intent privilegiado **MESSAGE CONTENT** habilitado) |
| `DISCORD_ALLOWED_ROLE_IDS` | *(vazio)* | IDs de roles Discord autorizados a usar o bot (separados por vírgula) |
| `DISCORD_ALLOWED_USER_IDS` | *(vazio)* | IDs de usuários Discord autorizados (separados por vírgula; sem role e sem ID o bot é desabilitado) |

**Espectador web (opt-in):**

As portas são derivadas por índice `i` em `config/servers.list` (relay `WATCH_HLTV_BASE+i`, listen `WATCH_LISTEN_BASE+i`, ICE `WATCH_UDP_BASE+(i*WATCH_UDP_SIZE)..+WATCH_UDP_SIZE-1`).

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `WATCH_HLTV_BASE` | `27100` | Porta base do relay HLTV (UDP): `base+i` |
| `WATCH_LISTEN_BASE` | `27200` | Porta base do proxy (página + signaling WebSocket, TCP): `base+i` |
| `WATCH_UDP_BASE` | `27300` | Porta base da faixa UDP fixa para o ICE (abrir no firewall/NAT) |
| `WATCH_UDP_SIZE` | `64` | Tamanho da faixa UDP por servidor |
| `WATCH_CONSOLE_COMMANDS` | `spec_autodirector 1` | Comandos de console executados no cliente espectador (câmera automática) |
| `WATCH_PACKAGE_ZIP` | `/valve/valve.zip` | Caminho do `valve.zip` dentro do container do proxy |
| `WATCH_PUBLIC_BASE` | *(vazio)* | URL pública base do espectador (swag): gera o `spectatorUrl` da API = `BASE/<context>/` |
| `WATCH_UPSTREAM_HOST` | `127.0.0.1` | Host/porta usados pelo swag para alcançar o `watch-main` (network_mode: host) |

> O IP público NÃO é mais configurado: o proxy descobre via STUN (`stun.l.google.com`) em cada conexão.

#### TLS/DDNS (swag & duckdns)

O **swag** (proxy TLS reverso) e o **duckdns** (DNS dinâmico) fazem parte da stack via `docker-compose.duckdns.yml` (incluído no `COMPOSE_FILE`):

| Porta host | Uso |
|------------|-----|
| `8000` | HTTP: redireciona para `https://...:4443` |
| `4443` | HTTPS do site principal (`zueiracstrike.duckdns.org:4443` → `web:8080` via IP do host) |
| `4445` | HTTPS dos espectadores (`:4445/<context>/` → `watch-main` `27200+i` via IP do host) |

- Dados do swag (nginx, certs, fail2ban) vivem em `duckdns/swag/config/` (**gitignored**); o token fica em `DUCKDNS_TOKEN` no `.env`.
- **Blocos `location` dos espectadores**: o `scripts/servers.sh compose` (e `swag-sync`) reescreve apenas a região `# BEGIN/END servers.sh swag locations` do proxy-conf vivo, derivada de `config/servers.list`, e reinicia o swag só quando o arquivo muda (e `nginx -t` passa). No remove, o bloco do servidor removido some automaticamente.
- **Backup dos certs**: `duckdns/backup.sh` gera `duckdns/backups/config-*.tar.gz` (config + patch do certcheck + compose). Restaurar `etc/letsencrypt/{live,archive,renewal}` resolve problemas de cert sem queimar a cota do Let's Encrypt.
- **Atenção swag/cert**: a imagem swag tem um check "old LE root" quebrado (espera o emissor "ISRG Root X", mas a cadeia atual é YE2→Root YE), que revogava o cert em todo boot e queimava a cota do LE. O fix é **durável**: `docker-compose.duckdns.yml` monta `duckdns/init-certbot-config.run` (cópia patcheada do script da imagem) por cima do arquivo do s6, então o swag **não reemite** o cert ao reiniciar/recriar.

#### Arquivos de configuração do CS

Cada servidor tem seus arquivos gerados em `config/servers/<id>/` (veja a seção **Multi-servidor**) e montados no container:

| Arquivo | Montado em |
|---------|------------|
| `config/servers/<id>/users.ini` | `cstrike/addons/amxmodx/configs/users.ini` |
| `config/servers/<id>/server.cfg` | `cstrike/server.cfg` |
| `config/servers/<id>/mapcycle.txt` | `cstrike/mapcycle.txt` |
| `config/servers/<id>/motd.txt` | `cstrike/motd.txt` |
| `config/servers/<id>/plugins.ini` | `cstrike/addons/amxmodx/configs/plugins.ini` |

#### Arquivos live

Os arquivos em `live/<id>/` são compartilhados entre o plugin do servidor CS e a API para exibir dados em tempo real (um diretório por servidor):

| Arquivo | Descrição |
|---------|-----------|
| `live/<id>/live_scoreboard.json` | Placar ao vivo (escrito pelo plugin AMX Mod X) |
| `live/<id>/live_killfeed.json` | Killfeed ao vivo (escrito pelo plugin AMX Mod X) |
| `live/watch/<id>/` | Logs do relay HLTV e `last_hltv_crash.txt` (espectador, por servidor) |

#### Plugins AMX Mod X (`cs16/plugins/`)

Os fontes dos plugins que escrevem os arquivos live ficam versionados em `cs16/plugins/` e são **compilados e montados no container do servidor** (sobrepõem os binários da imagem `leandrosalvas/cs16_stats`):

| Arquivo | Descrição |
|---------|-----------|
| `cs16/plugins/live_scoreboard.sma` | Gera `live/live_scoreboard.json` (scoreboard T/CT) |
| `cs16/plugins/live_killfeed.sma` | Gera `live/live_killfeed.json` (kill feed) |
| `cs16/plugins/slots_reserve.sma` | Reserva um slot para o HLTV (espectador) e evita que ele tome o lugar de um jogador |
| `cs16/plugins/csstatsx_sql.sma` | Coleta de estatísticas para o banco SQL |
| `cs16/plugins/adminslots.sma` | Gerenciamento de slots de admin |
| `cs16/plugins/amx_settings_api.sma` | API de configurações do AMX |
| `cs16/plugins/cs_ham_bots_api.sma` | API HAM para bots |
| `cs16/plugins/cs_maxspeed_api.sma` | API de velocidade máxima |
| `cs16/plugins/cs_player_models_api.sma` | API de modelos de jogador |
| `cs16/plugins/cs_teams_api.sma` | API de times |
| `cs16/plugins/cs_weap_models_api.sma` | API de modelos de armas |
| `cs16/plugins/cs_weap_restrict_api.sma` | API de restrição de armas |
| `cs16/plugins/plugins.ini` | Lista de plugins ativos do AMX Mod X |

Além destes, cada modo tem plugins próprios em `cs16/vendor/mode_plugins/<modo>/` (ex.: `zombies/`, `csdm/`, `gungame/`, `surf/`), montados no container conforme o modo configurado.

Para alterar um plugin, edite o `.sma` em `cs16/plugins/` e recompile:

```bash
./cs/build-plugins.sh   # usa o amxxpc da imagem cs16_stats para gerar os .amxx
docker compose up -d cs16   # aplica os .amxx montados no container
```

O `docker-compose.yml` monta os `.amxx` compilados e o `plugins.ini` do repo sobre os da imagem, então o fluxo é sempre: editar `.sma` → `build-plugins.sh` → `up -d cs16`.

#### Endereço público do servidor (página Conectar)

O host e a porta exibidos em `connect.html` (endereço, botão Steam e comando `connect`) são definidos em `web/common.js`:

```javascript
const SERVER_HOST = 'seu.host.aqui'
const SERVER_PORT = '27015'
```

O botão do espectador (páginas CSTV, ao vivo e Conectar) resolve a URL via `/servers` (`spectatorUrl` = `WATCH_PUBLIC_BASE/<context>/`), com `SPECTATOR_URL` como fallback estático em `web/common.js`:

```javascript
const SPECTATOR_URL = 'https://zueiracstrike.duckdns.org:4445/'
```

Os blocos `server_name` com domínios no `web/nginx.conf` são específicos da implantação de produção (redirecionam HTTP → `https://...:4443`, já exposto pelo swag) e podem ser removidos para uso genérico/local.

#### Multi-servidor (provisionamento automático)

> **Novo na stack?** Para um guia completo de instalação do zero (pré-requisitos, .env, troubleshooting), veja [INSTALL.md](INSTALL.md).

O projeto pode rodar vários servidores CS 1.6 ao mesmo tempo, cada um com porta, mapa, nome, arquivos live e espectador web próprios. O servidor **primário** (primeira linha de `config/servers.list`) é o único usado por snapshots/rankings e pelo registro de partidas (`cs_matches`).

**Fluxo de uso:**

```bash
# Opção A (recomendada) — assistente interativo:
# pergunta quantos servidores você quer, o nome de cada um, se deseja rotação de
# mapas (e quais mapas), gera o servers.list, cria os arquivos de config/live e sobe a stack.
./scripts/setup.sh

# Opção B (manual) — edite config/servers.list (formato: id nome porta_host mapa maxplayers rotate context mode cstv)
./scripts/servers.sh up
```

**Comandos do provisionador:**

| Comando | Descrição |
|---------|-----------|
| `./scripts/setup.sh` | Assistente interativo: pergunta a quantidade/nomes, rotação de mapas (e quais) e sobe a stack (flags: `--no-up`, `--yes`) |
| `./scripts/servers.sh init` | Cria `config/servers/<id>/`, `live/<id>/`, `config/watch/<id>/` e `live/watch/<id>/` a partir de `servers.list` |
| `./scripts/servers.sh compose` | Gera `docker-compose.servers.yml` (override) + `docker-compose.watch.yml` (espectador) + `config/watch/swag-locations.conf.example` **e sincroniza os blocos `location` no swag vivo** |
| `./scripts/servers.sh swag-sync` | Re-sincroniza os blocos `location` no proxy-conf vivo do swag e reinicia o swag se mudou (idempotente) |
| `./scripts/servers.sh config` | Valida o compose mergeado |
| `./scripts/servers.sh up` | `init` + `compose` + `docker compose up -d --no-recreate` (sem `--build`; builds são explícitos via `servers.sh build`) |
| `./scripts/servers.sh build` | Constrói as imagens `cs16_stats:local` e `csserver_wstats-api` |
| `./scripts/servers.sh down` | Para a stack |
| `./scripts/servers.sh ps` | Estado dos containers |
| `./scripts/servers.sh status` | Resumo dos servidores configurados |
| `./scripts/servers.sh list` | Mostra `config/servers.list` |
| `./scripts/servers.sh prune [ids]` | Apaga `config/servers/<id>` e `live/<id>` (sem ids, apaga os que saíram do `servers.list`); com `--metrics`, também remove as séries do Prometheus |
| `./scripts/servers.sh rcon <id> <cmd>` | Executa comando RCON em um servidor específico |

**Exemplo de `config/servers.list`:**

```
# Formato: id name host_port map maxplayers rotate context mode cstv
main Zueira 27015 de_dust2 30 yes zueira standard yes
gungame GunGame 27016 fy_iceworld 16 no gungame gungame yes
deathmatch DeathMatch 27017 de_dust 30 yes deathmatch csdm yes
zombies Zombies 27018 de_aztec 30 yes zombies zombies no
```

Regras e detalhes:

- A 1ª linha é o primário e deve manter o id `main`.
- `porta_host` é a porta publicada no host; dentro do container todos usam a porta interna `27015`.
- `context` (7ª coluna, opcional) é o slug do path do espectador web (`WATCH_PUBLIC_BASE/<context>/`); deve ser único e usar apenas `a-z0-9`. Default = slug do nome.
- `mode` (8ª coluna, opcional) é o modo de jogo: `standard` (padrão), `zombies`, `csdm`, `surf` ou `gungame`. Cada modo tem plugins, configs e MOTD próprios.
- `cstv` (9ª coluna, opcional) habilita os serviços de espectador web (watch-hltv + watch-main) para o servidor: `yes` ou `no` (padrão). Indisponível para modo `zombies`.
- `maxplayers` = slots **visíveis** (pares entre 2 e 30, máximo 30). O engine usa `visible + 1` (slot escondido reservado ao HLTV via plugin `slots_reserve`); como 30+1=31 fica sempre abaixo do teto de 32 do engine, o slot escondido existe em qualquer configuração. A API não conta o HLTV (`<context>-hltv`) nos `players`/`playersList`. `pb_minbots 2` garante um piso de 2 bots.
- `rotate`: `yes` (padrão) = rotação de mapas, com a lista em `config/servers/<id>/mapcycle.txt` (o assistente pergunta quais mapas da imagem entram na rotação); `no` = o `mapcycle.txt` fica apenas com o mapa escolhido (servidor sem troca de mapa).
- Se o `mapcycle.txt` do servidor ainda não existir com `rotate=yes`, o `init` copia o `config/mapcycle.txt` compartilhado como padrão; com `rotate=no`, ele regrava o mapa único se o conteúdo mudar.
- Os `server.cfg` são gerados a partir de `config/templates/server.cfg` usando o `RCON_PASSWORD` do `.env` (uma única senha para todos os servidores).
- Cada servidor grava seus próprios arquivos live em `live/<id>/`, que a API lê por servidor (`/api/live/state?server=<id>`).
- As páginas têm um seletor de servidor (Home, Live, Rankings, Mapas, Player, Avançadas, Partidas e Painel RCON); rankings, tops, mapas e partidas são filtrados pelo servidor selecionado e comandos RCON são executados no servidor alvo.
- As métricas do Grafana são rotuladas por servidor (`cs16_players_online{server="..."}`) com uma variável de servidor no dashboard.
- O `.env` define `COMPOSE_FILE=docker-compose.yml:docker-compose.servers.yml:docker-compose.duckdns.yml`: depois de gerado, `docker compose ps/logs/config/up` já usam o override e o swag/duckdns sem precisar de `-f` (o override é regenerado pelo `servers.sh compose`/`up` ou pelo `setup.sh`). O espectador (compose watch) não entra no `COMPOSE_FILE`: é opt-in via `./scripts/watch.sh`.

##### Adicionar um novo servidor (passo a passo)

Exemplo: adicionar o servidor `surf` na porta **27019**, mapa `surf_ski_2` e **20** slots.

**Com o assistente** (recomendado):

```bash
./scripts/setup.sh
```

Informe o total desejado, o nome do novo servidor (rotação de mapas, porta/mapa/slots têm defaults) e confirme. Se optar pela rotação (`S`), o assistente lista os mapas disponíveis na imagem e você escolhe os números dos mapas que entram na rotação (Enter mantém os curados de `config/mapcycle.txt`); se responder `n`, o servidor fica só com o mapa escolhido. O assistente atualiza o `servers.list`, gera os arquivos e sobe a stack.

**Ou manualmente:**

1. **Edite `config/servers.list`** e adicione a linha:

   ```
   surf Surf 27019 surf_ski_2 20 yes surf surf surf yes
   ```

   Formato: `id nome porta_host mapa maxplayers rotate context mode cstv` — use um `id` curto, sem espaços. As colunas `context`, `mode` e `cstv` são opcionais: `context` default = slug do nome; `mode` default = `standard`; `cstv` default = `no` (indisponível para `zombies`). Se quiser rotação customizada, crie/edite `config/servers/<id>/mapcycle.txt` com a lista de mapas (ou rode o assistente); para não rotacionar, use `no`.

2. **Rode o provisionador** (gera os arquivos e sobe a stack):

   ```bash
   ./scripts/servers.sh up
   ```

3. **Confira**:

   ```bash
   ./scripts/servers.sh status
   ./scripts/servers.sh rcon surf status
   ```

O que acontece por baixo dos panos:

- O `init` cria `config/servers/surf/` (server.cfg com hostname "Surf" e a senha RCON do `.env`, `users.ini`, `mapcycle.txt`, `motd.txt` e `plugins.ini`) e `live/surf/` com os JSONs vazios. O `mapcycle.txt` só é criado se não existir (ou vira só o mapa escolhido com `rotate=no`), preservando a rotação escolhida por servidor. Para modos específicos (zombies, csdm, surf, gungame), templates de `server.cfg` e `plugins.ini` são copiados de `config/templates/modes/<modo>/` quando existentes.
- O `compose` regenera `docker-compose.servers.yml` com o container `cs16surf` (porta 27019 publicada) e adiciona o servidor ao `CS_SERVERS` da API.
- Se `cstv=yes`, o `init` também cria `config/watch/surf/` (hltv.cfg + start-hltv.sh) e o `compose` gera os containers `cs16-watch-hltv-surf` + `cs16-watch-main-surf`.
- A API passa a detectar o novo servidor via Gamedig; os seletores de servidor de todas as páginas o exibem automaticamente, assim como os alertas de online/offline e as métricas do Grafana.

##### Personalizar um servidor

- A rotação de mapas do servidor é o `config/servers/<id>/mapcycle.txt` (um mapa por linha, em ordem). Edite à mão ou rode o assistente e escolha os mapas na seleção. Com `rotate=no` no `servers.list`, o `init` força o arquivo a conter só o mapa escolhido.
- Plugins e demais arquivos: edite os arquivos em `config/servers/<id>/` (ex.: plugins no `plugins.ini`) e rode `./scripts/servers.sh up` — ou, para aplicar em um único servidor:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.servers.yml up -d cs16surf
  ```

- Se o mapa informado em `servers.list` não estiver instalado, o HLDS escolhe outro mapa — instale o mapa ou ajuste o valor/`mapcycle.txt`.
- A lista de mapas oferecida pelo assistente vem da imagem (`/home/cs16/cstrike/maps/*.bsp`); se a imagem ainda não estiver local, o assistente usa os mapas de `config/mapcycle.txt` como fallback.

##### Remover um servidor

**Com o assistente** (recomendado):

```bash
./scripts/setup.sh
```

Informe o total desejado (menor que o atual) e escolha quais servidores remover. O assistente pergunta se quer apagar também `config/servers/<id>` e `live/<id>` (manter é o padrão e permite reverter).

**Ou manualmente:**

1. Apague a linha correspondente em `config/servers.list`.
2. Atualize a stack (regenera o compose sem o servidor; `--no-recreate` não remove containers existentes):

   ```bash
   ./scripts/servers.sh up
   ```

3. Remova o container e, opcionalmente, os arquivos de config/live:

   ```bash
   ./scripts/servers.sh prune surf
   ```

> Os dados no banco (stats, snapshots e partidas) de um servidor removido são **sempre preservados**; os seletores do frontend deixam de exibi-lo automaticamente. Com `--metrics`, o `prune` também remove as séries do servidor no Prometheus (via Admin API, bind `127.0.0.1:9090`).

##### Importante

- `docker-compose.servers.yml` é **gerado automaticamente** — não edite à mão; altere `config/servers.list` e rode `./scripts/servers.sh compose`.
- As portas UDP **e** TCP do `porta_host` precisam estar livres no host.
- `config/servers/` e `live/` não são versionados (o `server.cfg` contém a senha RCON).

#### Espectador Web (WebRTC)

O espectador permite assistir **servidores habilitados** direto no navegador, sem instalar o CS 1.6. Apenas servidores com `cstv=yes` na 9ª coluna do `config/servers.list` recebem os containers de espectador (modo `zombies` é automaticamente desabilitado). Para cada servidor habilitado há um par `watch-main-<id>` + `watch-hltv-<id>`; o fluxo (por servidor) é:

```
Browser (Xash3D WASM) ──WebRTC──▶ watch-main-<id> (proxy 27200+i) ──UDP──▶ watch-hltv-<id> (relay 27100+i) ──▶ cs16<id> (127.0.0.1:<host_port>)
```

Cada proxy atende em `BASE_PATH=/<context>/` (7ª coluna do `servers.list`), então o path público é `https://...:4445/<context>/`.

O `watch-main` é o submodule `watch/webxash3d-proxy` (fork `LeandroSalvas/webxash3d-proxy` de `bordeux/webxash3d-proxy`), um proxy Rust WebRTC→UDP com cliente Xash3D WASM. As modificações locais (ack do HLTV, DTLS vendored para Chrome, auto-recuperação, contexts `BASE_PATH`, etc.) estão documentadas no `watch/webxash3d-proxy/PATCHES.md`.

**Opt-in**: todos os serviços carregam `profiles: ["watch"]`, então a stack padrão nunca os inicia. Gerencie com:

```bash
./scripts/watch.sh up|down|build|ps|status|logs|restart|backup|restore
```

| Comando | Descrição |
|---------|-----------|
| `up` | Sobe todos os `watch-main-<id>` + `watch-hltv-<id>` (builda `cs16_stats:local` e o proxy se faltarem) |
| `down` | Derruba a stack do espectador |
| `build` | Reconstrói o cliente do espectador (necessário após mudanças no submodule) |
| `status` | Saúde dos serviços + última queda do HLTV, por servidor |
| `backup`/`restore` | Copia o `valve.zip` para/de `./backups/` |

**Assets**: `valve/valve.zip` (assets proprietários do Half-Life) é **gitignored**; o `backup`/`restore` do watch.sh o preserva. O compose o monta read-only nos `watch-main`.

**Portas** (por índice `i` em `config/servers.list`; 4 servidores hoje = 0..3):

| Porta | Uso |
|-------|-----|
| `27100+i` UDP | Relay HLTV (`watch-hltv-<id>`) |
| `27200+i` TCP | Página do espectador + signaling WebSocket (`/websocket`) |
| `27300+(i*64)..+63` UDP | WebRTC (ICE) |
| `4445` TCP | HTTPS do espectador (via swag, produção) |

> **Sem redirecionamento de portas no roteador** (sem port-forward, sem DMZ): o acesso externo passa todo pelo swag (`:4445`, TLS/WSS) e o media WebRTC atravessa o NAT via STUN (IP público descoberto por `stun.l.google.com`) na faixa UDP fixa `27300+`. As portas `27100+/27200+/27300+` são apenas binds do host (caminho interno swag→watch-main→relay→jogo).

`watch-main` usa `network_mode: host` (anuncia o IP da LAN como ICE candidate e resolve os candidatos mDNS `.local`). Em produção, o swag (parte da stack) serve `https://zueiracstrike.duckdns.org:4445/<context>/` → `http://192.168.15.54:27200+i`. Os blocos `location` são gerados em `config/watch/swag-locations.conf.example` **e sincronizados automaticamente** no proxy-conf vivo do swag por `servers.sh compose`/`swag-sync` (região de marcadores; reescrita idempotente; reinício do swag só com `nginx -t` OK).

**Auto-recuperação** (cliente + proxy):

- Watchdog de stall no cliente: se nenhum pacote de jogo chegar em **15s**, força `rejoin()` (disconnect + connect no mesmo canal WebRTC); após **6** tentativas, recarrega a página uma única vez (guarda em `sessionStorage`). O reload é **silencioso** (o diálogo `beforeunload` foi removido).
- Teardown de idle na bridge do proxy: **25s** sem dados do upstream derruba a bridge e sinaliza o cliente a reconectar (armado a partir do primeiro pacote ou do handshake do browser).
- Reconexão automática em `close`/`error` do canal de dados.
- Com a aba oculta: shim de `requestAnimationFrame` mantém o loop do engine vivo e o backlog de `net.incoming` foi elevado para `maxPackets: 16384` — esconder a aba por pouco tempo "avança rápido" até o ao-vivo em vez de congelar; mais de 60s oculto reconecta.
- **Congelamento com a aba ativa (overflow do buffer)**: o relay produz mais rápido que o engine consome (1 pacote/frame), o buffer enchia em ~3-7 min e o descarte do pacote mais antigo quebrava a cadeia delta do HLTV (freeze permanente, watchdog quieto pois pacotes continuam chegando). Fix: watchdog de backlog que faz `rejoin()` a 80% do buffer (reseta a cadeia antes de qualquer drop) + `rejoin()` agora limpa o backlog da sessão anterior; o relay roda com `sys_ticrate 30` para a produção acompanhar o consumo.
- **Microfone**: o glue do engine pede `getUserMedia` no boot (captura de voice); stub no `index.html` rejeita a permissão — sem prompt para o espectador.
- Loading por etapas em PT-BR com barra de progresso; erros de JS/WebGL2 aparecem na tela em vez de tela preta.
- **Volume do espectador**: controle de volume global por aba via Web Audio — o `index.html` envolve o `ctx.destination` do `AudioContext` num `GainNode` (`window.setSpectatorVolume(v)`) e há um slider **Vol** persistente (guarda em `localStorage` a chave `spectatorVolume`). O áudio é local do navegador (Web Audio), então nada no servidor controla o volume de cada espectador.

#### Bot Discord (gerencia a stack pelo chat)

A API roda um bot Discord que controla servidores de jogo, stack e espectadores por comandos de texto no canal. Ele roda **no processo da API** (`api/lib/discordBot.js`) e chama os módulos internos diretamente (sem HTTP/CSRF): `serverManager` para start/stop/restart, `runRconCommand` para RCON, `stackHealthState` para o estado da stack, `queryServer`/`findServer` para o estado dos jogos e o CLI do docker (mesmo socket do `serverManager`) para logs/stats/health.

**Configuração** (`.env`):

| Variável | Descrição |
|----------|-----------|
| `DISCORD_BOT_TOKEN` | Token do bot (crie um application em `discord.com/developers` → Bot). **Ative o intent privilegiado MESSAGE CONTENT** e convide o bot ao servidor com permissões de ler/enviar mensagens (OAuth2 URL Generator, escopo `bot`). |
| `DISCORD_ALLOWED_ROLE_IDS` | IDs de roles autorizados (separados por vírgula) |
| `DISCORD_ALLOWED_USER_IDS` | IDs de usuários autorizados (separados por vírgula) |

Sem token ou sem permissões, o bot é desabilitado sem crash. As variáveis são repassadas ao container no `docker-compose.yml`.

**Comandos** (prefixo `!`, só quem tem role/ID autorizado):

| Comando | Descrição |
|---------|-----------|
| `!status` | Servidores + stack |
| `!servidores` | Lista os servidores de jogo |
| `!stack` | Estado dos serviços da stack |
| `!start <id>` / `!stop <id>` / `!restart <id>` | Controle de servidor |
| `!rcon <id> <comando>` | RCON no servidor |
| `!changelevel <id> <mapa>` | Troca o mapa do servidor (RCON `changelevel`) |
| `!mapas` | Mapas disponíveis na imagem |
| `!player <nome ou steamid>` | Stats do jogador (SQL de `top.js`, filtrando bots) |
| `!logs <id ou serviço> [n]` | Últimas `n` linhas de log do container (ex.: `!logs zueira2 20`, `!logs api 50`) |
| `!ps` | CPU/memória dos containers do projeto (`docker stats`) |
| `!watch [id]` | Saúde dos espectadores (todos, ou só um servidor): health do `watch-main`/`watch-hltv`, último crash e episódios de mudo |
| `!uptime` | Uptime/versão da API e serviços no ar |
| `!ajuda` | Lista os comandos |

Respostas truncadas em ~1900 chars (limite do Discord). Mutações (`start/stop/restart`, `rcon`, `changelevel`) também disparam `sendAlert` no mesmo webhook dos alertas. O **volume do espectador é impossível pelo bot**: o áudio é local do navegador (Web Audio), nada no servidor o controla.

**Observação operacional**: o relay HLTV pode ficar "mudo" (processo vivo e conectado ao servidor, mas sem enviar dados). A auto-recuperação acima destrava a sessão; o destravamento definitivo é reiniciar o servidor de jogo (o HLTV reconecta sozinho em ~20s). O cron `scripts/watch-mudo.sh` detecta e recupera o mudo automaticamente (kick via RCON). Acompanhe `live/watch/<id>/last_hltv_crash.txt` e o `watch.sh status`.

#### Upgrade e smoke test da API

A API roda **Node 26** + **Express 5**. Para validar a API em execução e fazer upgrades com rollback automático:

```bash
# Valida a API rodando (exit 0 = saudável): composição, endpoints, redis/sessão.
./scripts/smoke-test.sh
# Flags: --fase a|b (subconjuntos), --rollback (pula rate-limit/SIGTERM/robustez)

# Upgrade com snapshot + rollback automático em falha.
./scripts/upgrade.sh --fase a|b
# Flags: --no-auto-rollback (para inspeção manual); upgrade.sh rollback [tag] / list
```

Detalhes: o upgrade tira snapshot (`csserver_wstats-api:rollback-<ts>` + HEAD em `.rollback-state`), aplica as mudanças, regenera o lockfile, builda, sobe o `api`, aguarda health e roda o smoke; em falha restaura imagem + código (`git reset --hard`) e revalida. As versões esperadas são **derivadas do código atual** (Dockerfile/package.json), então o mesmo script valida upgrade e rollback. Atenção: o smoke consome a janela de rate limit de login (60s) — um smoke completo bloqueia o login do host por alguns segundos.

### Páginas Web

| Página | URL | Descrição |
|--------|-----|-----------|
| Home | `/` | Resumo geral, top 10 e status do servidor |
| Mapas | `/maps.html` | Lista de mapas registrados e snapshots |
| Ranking por Mapa | `/map.html?map=<nome>` | Ranking de jogadores em um mapa específico |
| Rankings | `/rankings.html` | Rankings semanal e mensal |
| Avançadas | `/advanced.html` | Top headshots, precisão e killstreaks |
| Partidas | `/matches.html` | Histórico de partidas (placar, vencedor, duração) |
| Perfil do Jogador | `/player.html?steamid=<id>` | Estatísticas individuais e histórico |
| Conectar | `/connect.html` | Guia de conexão ao servidor |
| Live Match | `/live.html` | Placar ao vivo e killfeed |
| Duelo | `/duelo.html` | Confronto entre jogadores |
| CSTV | `/cstv.html` | Espectador web (WebRTC) com seletor de servidor |
| Painel RCON | `/admin.html` | Autenticação e execução de comandos RCON *(admin)* |
| Sistema | `/system.html` | Status de todos os subsistemas *(admin)* |
| Servidores | `/servidores` | Gestão de servidores: add/remove/start/stop/restart *(admin)* |
| Usuários | `/usuarios` | Aprovação de 1º login social e papéis *(superadmin)* |
| Login | `/login` | Login local (superadmin) + Google/Steam |

> Páginas marcadas *(admin)* / *(superadmin)* são protegidas de verdade: o nginx usa `auth_request` no `/api/auth/guard` e redireciona para `/login?next=...` quando não há sessão de admin ativa. 

### Referência da API

Todas as rotas devem ser acessadas via prefixo `/api` (proxy Nginx). Exemplo: `http://<host>:8080/api/health`

> Em modo multi-servidor, os endpoints de stats, top, ranking, player, mapa e partidas aceitam `?server=<id>` para filtrar os dados de um servidor específico (ex.: `/api/top10?server=frag`). Sem o parâmetro, retornam dados consolidados de todos os servidores.

#### Saúde e Status

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/health` | Status da API, banco e Redis |
| `GET` | `/api/stats` | Estatísticas gerais (jogadores, kills, mapas) — aceita `?server=` |
| `GET` | `/api/server` | Status atual do servidor CS |

#### Rankings

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/top10` | Top por kills (padrão 10) |
| `GET` | `/api/topskill` | Top por skill |
| `GET` | `/api/topkd` | Top por K/D (mín. 10 kills) |
| `GET` | `/api/ranking/weekly` | Ranking semanal (últimos 7 dias) |
| `GET` | `/api/ranking/monthly` | Ranking mensal (últimos 30 dias) |

> Os endpoints de ranking e top aceitam `?limit=` e `?page=` para paginação (padrão `limit=10`, máx. 50) e `?server=` para filtrar por servidor.

#### Jogador

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/player/:steamid` | Detalhes de um jogador |
| `GET` | `/api/player-search?q=` | Busca de jogadores por nome ou steamid (LIMIT 10) |
| `GET` | `/api/player-history-daily/:steamid` | Histórico diário de kills/deaths |
| `GET` | `/api/player-last-map/:steamid` | Último mapa jogado |
| `GET` | `/api/player-rank-history/:steamid` | Histórico diário de posição no ranking |

> Todos os endpoints de jogador aceitam `?server=` para filtrar os dados de um servidor específico.

#### Avançadas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/top-headshots` | Top por headshots |
| `GET` | `/api/top-accuracy` | Top por % de headshots (mín. 10 kills) |
| `GET` | `/api/top-killstreak` | Top por maior sequência de kills |
| `GET` | `/api/top-assists` | Top por assistências |
| `GET` | `/api/top-damage` | Top por dano causado |
| `GET` | `/api/top-tk` | Top por team kills |
| `GET` | `/api/top-bomb` | Top por ações de bomba (plants + defuses + def + explosions) |
| `GET` | `/api/top-connect-time` | Top por tempo total conectado |

> Todos os endpoints avançados aceitam `?server=` para filtrar por servidor.

#### Mapas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/maps` | Lista de mapas registrados |
| `GET` | `/api/map/:map` | Ranking simplificado por mapa |
| `GET` | `/api/map-ranking/:map` | Ranking detalhado por mapa com deltas |

> Todos os endpoints de mapas aceitam `?server=` para filtrar por servidor.

#### Live

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/live/killfeed` | Killfeed ao vivo (últimos 5) |
| `GET` | `/api/live/state` | Estado do placar ao vivo |
| `GET` | `/api/live/events` | Event Stream (SSE) com atualizações em tempo real |

> A página Live usa SSE (`/api/live/events`) para atualizações em tempo real, com fallback para polling se o SSE falhar. Os endpoints live aceitam `?server=<id>` para selecionar um servidor específico (multi-servidor).

#### Partidas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/matches` | Histórico de partidas (aceita `?limit=`, `?page=` e `?server=`) |
| `GET` | `/api/matches/latest` | Última partida registrada |
| `GET` | `/api/matches/:id` | Detalhes de uma partida |

> O plugin `live_scoreboard` reporta o placar de rounds (T/CT) por mapa e, ao trocar de mapa, publica o resultado como `last_match`. A API lê esse campo a cada 2s e insere em `cs_matches` (tabela criada automaticamente com chave única `server + map + ended_at` para evitar duplicidade). Cada servidor registra apenas as próprias partidas (`?server=`).

#### Servidores e Alertas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/servers` | Status de todos os servidores configurados (`CS_SERVERS`) |
| `GET` | `/api/server/:id` | Status detalhado de um servidor específico |
| `GET` | `/api/server` | Status do servidor principal |
| `GET` | `/api/alerts` | Estado atual de alertas e histórico recente |

> Os alertas comparam o estado online/offline do servidor principal a cada 30s. Quando o estado muda e `ALERT_WEBHOOK_URL` está configurada, um webhook é enviado (formato `{"text": ...}` ou `{"content": ...}` para Discord).

#### Métricas (Prometheus)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/metrics` | Métricas no formato Prometheus (default metrics + HTTP requests, jogadores online por servidor, DB up, partidas) |

> O Grafana roda em `http://<host>:3001` com datasource Prometheus e dashboards provisionados por arquivo (`config/grafana/provisioning/` + `cs16-infra.json`). O Prometheus coleta 5 jobs: `cs16-api` (Basic Auth `METRICS_USER`/`METRICS_PASS`), `nginx` (`:9113`), `nginxlog` (`:4040`), `node` (host via `host.docker.internal:9100`) e `cadvisor` (`:8080`). A Admin API do Prometheus (`127.0.0.1:9090`) é usada pelo `servers.sh prune --metrics`. Painéis de média de resposta (API e Front) usam janelas de 30m (tráfego esparso).

#### Autenticação

Sessão em cookie `httpOnly` (`cs16.sid`, `sameSite=lax`, rolling renewal), senha local com scrypt, **CSRF de cookie duplo** (`csrf_token` + header `x-csrf-token`) exigido em toda mutação e rate limit de login (5/60s por IP → 429). Tabela `users` no MariaDB (migrada idempotentemente pelo `ensureSchema`).

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Login local com usuário/senha (superadmin) |
| `GET` | `/api/auth/session` | Sessão atual (user, papel, CSRF token) |
| `GET` | `/api/auth/status` | Estado do login social configurado (Google/Steam) |
| `POST` | `/api/auth/logout` | Encerra a sessão |
| `GET` | `/api/auth/guard` | Público: 200 se admin ativo, senão 401 (usado pelo `auth_request` do nginx) |
| `GET` | `/api/auth/google` + `/api/auth/google/callback` | Login Google OAuth2 |
| `GET` | `/api/auth/steam` + `/api/auth/steam/callback` | Login Steam (OpenID 2.0, sem Web API key) |
| `GET` | `/api/auth/steam/status` | Status do login Steam configurado |

> **Todo 1º login social (Google/Steam) nasce `pending`** e precisa ser aprovado pelo superadmin em `/usuarios`. O superadmin local é criado no boot (`SEED_ADMIN=1`) com credenciais em `ADMIN_CREDENTIALS.txt` (gitignored, regenerável com `docker compose exec api node scripts/seed-admin.js --reset`). Papéis: `superadmin` (total), `admin` (operações de servidor + RCON), `pending`. O nginx protege `/admin.html`, `/system.html`, `/servers.html` e `/users.html` com `auth_request /api/auth/guard` → `/login?next=...`.

#### Usuários (admin)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/admin/users` | Lista usuários e papéis |
| `POST` | `/api/admin/users/:id/approve` | Aprova usuário `pending` (define papel) |
| `POST` | `/api/admin/users/:id/reject` | Rejeita usuário `pending` |
| `POST` | `/api/admin/users/:id/role` | Altera o papel de um usuário |
| `DELETE` | `/api/admin/users/:id` | Remove um usuário |

#### Servidores (admin)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/admin/servers` | Lista servidores (enriquecida com `servers.list`) |
| `GET` | `/api/admin/servers/maps` | Mapas disponíveis na imagem |
| `POST` | `/api/admin/servers` | Adiciona servidor (provisiona via `servers.sh up` num container descartável) |
| `DELETE` | `/api/admin/servers/:id` | Remove servidor (unprovision) |
| `POST` | `/api/admin/servers/:id/start` | Inicia o servidor |
| `POST` | `/api/admin/servers/:id/stop` | Para o servidor |
| `POST` | `/api/admin/servers/:id/restart` | Reinicia o servidor |

> Todas as rotas de admin exigem sessão + CSRF + `commandLimiter`. O add/remove regenera o override e o compose **recria o container da api** no meio da operação — o frontend recebe 502/conexão cortada, mas a operação **conclui** (o `web/servers.js` trata erro de rede como "provisionando, recarregando..."). O RCON automático (`/api/admin/command`) usa a credencial do servidor (não existe mais senha RCON no card do admin). `writeServersList` faz `.bak` e `add()`/`remove()` revertem a lista se o provision falhar.

#### Admin (RCON)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/admin/command` | Executar comando RCON (requer sessão `admin`, token CSRF e rate limit) |
| `POST` | `/api/admin/logout` | Encerrar sessão admin (requer token CSRF) |
| `GET` | `/api/admin/session` | Verificar status da sessão e obter token CSRF |

> Os endpoints de escrita do admin exigem o header `x-csrf-token` (obtido em `/api/admin/session`, rotacionado a cada login via `regenerate`). O cookie de sessão (`cs16.sid`) é `httpOnly`, `sameSite=lax`, com `rolling` renewal.

### Sistema de Snapshots

A API consulta a tabela `csstats` a cada **60 segundos**. Quando detecta mudanças (kills, deaths, hs, skill) ou troca de mapa, salva um registro em `csstats_snapshots` com timestamp. Apenas jogadores ativos são registrados (e mapas `unknown`/offline são ignorados). Esses snapshots alimentam:

- Rankings semanais e mensais (com cálculo de deltas via window functions)
- Histórico diário por jogador
- Ranking detalhado por mapa
- Gráfico de evolução na página do jogador

**Bancos existentes:** o `schema.sql` já contém os índices da `csstats_snapshots` (`steamid, created_at`, `map`, `created_at`). Para aplicar em um banco já em produção, rode:

```sql
ALTER TABLE `csstats_snapshots`
  ADD KEY `idx_snap_steamid_time` (`steamid`, `created_at`),
  ADD KEY `idx_snap_map` (`map`),
  ADD KEY `idx_snap_created` (`created_at`);
```

### Internacionalização (i18n)

- Idiomas: Português (PT) e Inglês (EN)
- Detecção automática do idioma do navegador
- Preferência salva em `localStorage`
- Traduções em `web/i18n/translations.js`
- Elementos HTML usam o atributo `data-i18n` para tradução automática

### Desenvolvimento

```bash
# Rebuild e restart da API após alterações
docker compose up -d --build api

# Frontend recarrega automaticamente (volume montado)
# Basta editar arquivos em web/

# Ver logs
docker compose logs -f api
docker compose logs -f web
docker compose logs -f db

# Espectador web: rebuild do cliente (após mudanças no submodule)
./scripts/watch.sh build

# Validar a API em execução
./scripts/smoke-test.sh

# Publicar imagens no Docker Hub (cs16, api, watch-main)
./scripts/push-images.sh          # docker login antes; tags latest + v<AAAAMMDD>-<HHMM>

# Backup dos certs do swag (config + patch do certcheck + compose)
./duckdns/backup.sh               # gera duckdns/backups/config-<data>.tar.gz

# Recuperar relay HLTV "mudo" (kick via RCON)
./scripts/watch-mudo.sh           # cron a cada minuto; ou watch-mudo.sh <id>...
```

### Solução de problemas

**API não inicia:**
```bash
docker compose logs api
```
Verifique se `.env` está configurado com `SESSION_SECRET` e variáveis do banco. O container para se `SESSION_SECRET` estiver vazio.

**Erro de conexão com banco:**
```bash
docker compose logs db
```
Confira as variáveis `MYSQL_*` no `.env`. O banco pode levar alguns segundos para ficar pronto — o compose usa healthcheck para garantir a ordem de início.

**Web abre mas sem dados:**
```bash
docker compose logs api
docker exec csserver_wstats-db-1 mysql -u root -p<senha> -e "USE csstats; SELECT COUNT(*) FROM csstats;"
```
Se a tabela `csstats` está vazia, verifique se o servidor de jogo está rodando corretamente. O stats plugin integrado ao AMX Mod X coleta os dados automaticamente quando os jogadores se conectam e jogam.

**Espectador congelado ou sem imagem:**
```bash
./scripts/watch.sh status      # saúde dos serviços + última queda do HLTV por servidor
./scripts/watch.sh logs -f     # logs dos proxies/relays
```
O cliente se auto-recupera (rejoin + reload silencioso). Se um relay HLTV ficou "mudo", o cron `scripts/watch-mudo.sh` o recupera (kick via RCON); o definitivo é reiniciar o servidor de jogo (`docker compose restart cs16<id>`) — o HLTV reconecta sozinho em ~20s. Verifique também `live/watch/<id>/last_hltv_crash.txt`.

**Login admin bloqueado (429):** o `smoke-test.sh` compartilha a janela de rate limit de login (60s) com o host. Aguarde o intervalo e tente novamente.

**swag sem certificado / cota do Let's Encrypt queimada (imagem ~2026):**
```bash
docker compose ps swag          # unhealthy
docker compose logs swag | grep -i cert
```
O check "old LE root" da imagem é contornado **duravelmente** pela montagem `ro` de `duckdns/init-certbot-config.run` no compose (o swag **não** reemite o cert no boot). Se mesmo assim o cert sumiu ou o swag ficou sem cert por horas (cota 5 certs/168h), restaure do backup: `duckdns/backups/config-*.tar.gz` → restaurar `etc/letsencrypt/{live,archive,renewal}`. **Não rode múltiplos `docker compose up -d` seguidos com o swag sem cert** — cada boot tenta reemitir e queima a cota.

**Certs do swag expirando / renovação:** o swag renova automaticamente pelo certbot. O backup em `duckdns/backups/` guarda o último estado bom (restaurar resolve sem queimar cota).

**cAdvisor sem dados (fs) no Grafana:** a imagem é um build local do fork `dillon-giacoppo/cadvisor` (containerd snapshotter); CPU/memória/rede funcionam, filesystem não — comportamento esperado.

---

## 🇺🇸 English (US)

### Overview

CS Server Stats is a complete Counter-Strike 1.6 project with an integrated statistics dashboard and **multi-server support**. Each server runs with AMX Mod X configured, collects and stores real-time match statistics, and the web panel exposes rankings, player profiles, live scoreboard, killfeed, and a **web spectator (WebRTC)**. The entire stack is orchestrated with Docker Compose: game servers, MariaDB, Redis, Node.js API, Nginx frontend, monitoring (Prometheus/Grafana), **swag** TLS proxy and **duckdns** dynamic DNS — all integrated in a single project.

### Architecture

The project is orchestrated with Docker Compose. The base services are:

| Service | Description |
|---------|-------------|
| `cs16` | Counter-Strike 1.6 game servers with ReHLDS, ReGameDLL, AMX Mod X and stats plugin. Supports 5 game modes (standard, zombies, csdm, surf, gungame) with mode-specific plugins and configs (one container per server; the primary is `main`) |
| `db` | MariaDB for stats storage |
| `redis` | Cache and session store |
| `api` | Node.js (Express) backend with REST endpoints |
| `web` | Static frontend served via Nginx with reverse proxy to the API |
| `prometheus` | API metrics collection (`/api/metrics`) and Nginx metrics |
| `grafana` | Monitoring dashboards (port 3001) |
| `nginx-exporter` | Nginx metrics exporter (scraped by Prometheus) |
| `nginxlog-exporter` | Access-log metrics for the front (average response time) |
| `node-exporter` | **Host** metrics (CPU/memory/network, `network_mode: host`) |
| `cadvisor` | **Per-container** metrics (CPU/memory/network of the stack) |
| `swag` | Reverse TLS proxy (TLS/DDNS): main site on `:4443`, spectators on `:4445`, HTTP redirect on `:8000` |
| `duckdns` | Dynamic DNS (updates `zueiracstrike.duckdns.org`) |

On top of these, there are **opt-in** spectator services (`profiles: ["watch"]`, never started by plain `docker compose up` — see the [Web Spectator](#web-spectator-webrtc) section):

| Service | Description |
|---------|-------------|
| `watch-main-<id>` | WebRTC→UDP proxy per server: serves the spectator page and bridges to the HLTV relay |
| `watch-hltv-<id>` | HLTV relay per server: between the game server (`127.0.0.1:<host_port>`) and the browser spectator |

The **swag** (TLS proxy) and **duckdns** (dynamic DNS) are **part of the stack** (`docker-compose.duckdns.yml`, included in `COMPOSE_FILE`): they expose the main site at `https://zueiracstrike.duckdns.org:4443` and each spectator at `https://zueiracstrike.duckdns.org:4445/<context>/`.

### Installation

> For a complete installation guide from scratch, including prerequisites, `.env` configuration, game servers, HTTPS, spectators, Discord bot, and troubleshooting, see **[INSTALL.md](INSTALL.md)**.

### Features

#### Game Server

- Counter-Strike 1.6 with **ReHLDS**, **ReGameDLL**, Metamod-R, ReUnion and **AMX Mod X 1.10**
- **5 game modes**: standard (classic CS), zombies (Zombie Plague 5.0.8a), csdm (ReDeathmatch), surf (Survival Surf), gungame (GunGame)
- Each mode has its own plugins, configs, and MOTD (templates in `config/templates/modes/` and `config/templates/motd/`)
- Centralized server configuration (`server.cfg`, `users.ini`, `mapcycle.txt`, `motd.txt`)
- UAC (User Access Control) for bug exploitation protection
- ZBot with `fill` mode (fills empty slots with bots, 2-bot floor, reserved slot for HLTV)
- Integrated stats plugin for automatic data collection
- Multi-server: multiple servers, each with its own port, map, mode, and live files (`config/servers.list` is the source of truth)
- **CSTV opt-in per server**: the 9th column `cstv` in `servers.list` controls which servers have web spectators (watch-hltv + watch-main)

#### Game Modes

| Mode | Description | Key plugins |
|------|-------------|-------------|
| `standard` | Classic CS 1.6 (bomb/defuse, rescue) | `csstatsx_sql`, `live_scoreboard`, `live_killfeed`, `slots_reserve` |
| `zombies` | Zombie Plague 5.0.8a (humans vs zombies) | `zp50_*` (70+ plugins), `live_scoreboard`, `live_killfeed` |
| `csdm` | ReDeathmatch (deathmatch with classes) | `redm_*` (classes), `csdm_*` (spawns), `live_scoreboard`, `live_killfeed` |
| `surf` | Survival Surf (custom surf maps) | `live_scoreboard`, `live_killfeed` |
| `gungame` | GunGame (weapon progression by kills) | `regg_*` (regg engine), `live_scoreboard`, `live_killfeed` |

- The 8th column `mode` in `servers.list` sets the mode (default: `standard`)
- Each mode has `server.cfg` and `plugins.ini` templates in `config/templates/modes/`
- Each mode has a custom MOTD in `config/templates/motd/`
- Mode-specific plugins are in `cs16/vendor/mode_plugins/<mode>/`
- **CSTV unavailable for zombies mode** (frontend and backend restriction)

#### Web Panel

- Real-time server status and player statistics
- Player rankings (overall, weekly, monthly, and per-map)
- Individual player profiles with kill evolution chart and daily history
- Advanced stats: top headshots, accuracy, killstreaks, assists, damage, team kills, bomb, and connected time
- Live scoreboard and killfeed (SSE)
- **Authentication & RBAC**: local login (superadmin) + Google OAuth2 and Steam OpenID with `superadmin`/`admin`/`pending` roles (first social login is born `pending` and is approved in `/usuarios`), double-cookie CSRF, login rate limit (5/60s)
- **Server management from the panel** (`/servidores`): add/remove/start/stop/restart via UI (docker CLI on the socket), automatic RCON for admins
- Multi-server monitoring (status of several servers on the System page)
- Online/offline alerts via webhook (Slack/Discord/Teams)
- **Discord bot**: manages game servers, the stack, and the spectators via chat commands (`!` prefix) — see [Discord Bot](#discord-bot-manages-the-stack-via-chat)
- Match tracking (score, winner, and duration per map)
- Prometheus metrics + Grafana dashboards
- Bilingual support (Portuguese/English)
- Snapshot system for tracking historical progression
- Connection guide with Steam protocol support

#### Monitoring (Prometheus & Grafana)

- 5 scrape jobs: `cs16-api` (Basic Auth), `nginx`, `nginxlog`, `node` (host) and `cadvisor` (per container)
- `node-exporter` with `network_mode: host` + `pid: host` for real host metrics (CPU/memory/network of the LAN interface)
- `cadvisor` per container — the image is a **local build** of the `dillon-giacoppo/cadvisor` fork (Docker containerd snapshotter support; the upstream image cannot see containers on that storage)
- Grafana on `:3001` with datasource and dashboards provisioned by file (`config/grafana/provisioning/`, `cs16-infra.json`)
- Prometheus Admin API (`127.0.0.1:9090`) used by `servers.sh prune --metrics`

#### Web Spectator (WebRTC)

- Watch **any server** in the browser via an HLTV relay (Xash3D WASM client), with no installation — a `watch-main`/`watch-hltv` pair per `config/servers.list` server, each at its `/context/` path
- CSTV page (`/cstv.html`) with the spectator embedded in an iframe + server selector
- Self-healing: client stall watchdog (rejoin + silent reload) and proxy bridge idle teardown — the session survives even game-server restarts
- TLS exposure via **swag** (part of the stack, `docker-compose.duckdns.yml`): `https://...:4445/<context>/`, with the `location` blocks auto-synced by `servers.sh compose`/`swag-sync`
- Per-tab **spectator volume** (Web Audio, persistent slider)
- Opt-in (not part of the default stack), managed by `./scripts/watch.sh`

### Prerequisites

- Docker
- Docker Compose
- Available ports:
  - **8080** (web panel)
  - **27015** (primary server UDP/TCP), **27016+** (extra servers, one port each)
  - **27100+** (HLTV relay UDP per server), **27200+** (spectator: page + signaling WebSocket), **27300+** (WebRTC UDP, 64-port range per server)
  - **8000** (HTTP → HTTPS redirect via swag), **4443** (main site HTTPS), **4445** (spectator HTTPS)
  - **3001** (Grafana) and **9090** (Prometheus, local bind); **8082** (cAdvisor, local bind, debug)
  - Internal (no host bind): `9113` (nginx-exporter) and `4040` (nginxlog-exporter)

### Quick Start

> **New to the stack?** For a complete installation guide from scratch (prerequisites, .env configuration, troubleshooting), see [INSTALL.md](INSTALL.md).

**1. Clone the repository (with submodules):**

```bash
git clone --recurse-submodules <repo-url>
cd csserver_wstats
```

**2. Configure the environment file:**

```bash
cp .env.example .env
```

Open `.env` and set the values. At minimum, configure:

```
MYSQL_ROOT_PASSWORD=<strong-password>
MYSQL_DATABASE=csstats
MYSQL_USER=csuser
MYSQL_PASSWORD=<strong-password>
SESSION_SECRET=<long-random-string>
RCON_PASSWORD=<same-password-as-server.cfg>
```

**3. Start the environment:**

```bash
docker compose up -d --build
```

**4. Access the panel:**

Open your browser at `http://<your-host>:8080`

### Configuration

#### Environment variables

**Required:**

| Variable | Description | Example |
|----------|-------------|---------|
| `MYSQL_ROOT_PASSWORD` | MariaDB root password | `my_root_password` |
| `MYSQL_DATABASE` | Database name | `csstats` |
| `MYSQL_USER` | Database user | `csuser` |
| `MYSQL_PASSWORD` | Database user password | `my_password` |
| `SESSION_SECRET` | Express session secret | `a-very-long-random-string` |
| `RCON_PASSWORD` | Server RCON password (generated into `config/servers/<id>/server.cfg`) | `rcon123` |
| `DUCKDNS_TOKEN` | DuckDNS token (swag validates the cert and duckdns updates the IP) | `xxxx-xxxx-xxxx` |

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `db` | Database host |
| `SESSION_STORE` | `redis` | Session store: `redis` or `memory` |
| `REDIS_HOST` | `redis` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(empty)* | Redis password |
| `REDIS_DB` | `0` | Redis database index |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080,http://192.168.15.54:8080` | Allowed origins (comma-separated) |
| `GAMEDIG_HOST` | `cs16` | Game server host (used by Gamedig) |
| `GAMEDIG_PORT` | `27015` | Game server port |
| `CS_SERVERS` | *(empty)* | JSON array of monitored servers (multi-server); first entry is the primary |
| `ALERT_WEBHOOK_URL` | *(empty)* | Webhook URL (Slack/Discord/Teams) notified on online/offline changes |
| `SEED_ADMIN` | `1` | If `1`, creates the local superadmin on boot and writes `ADMIN_CREDENTIALS.txt` (gitignored) |
| `ADMIN_USERNAME` | *(empty)* | Local superadmin username (default: random) |
| `STEAM_RETURN_URL` | *(empty)* | Public Steam login return URL. **Note:** every first social login is born `pending` and needs superadmin approval |
| `GOOGLE_CLIENT_ID` | *(empty)* | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | *(empty)* | Google OAuth2 client secret |
| `GOOGLE_RETURN_URL` | *(empty)* | Authorized Google callback URL (`https://...:4443/api/auth/google/callback`) |
| `METRICS_USER` | *(empty)* | Basic Auth user for `/api/metrics` (alphanumeric only) |
| `METRICS_PASS` | *(empty)* | Basic Auth password for `/api/metrics` |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin user |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana admin password (only on first boot; the `grafana_data` volume keeps the later password) |
| `DOCKER_USER` | *(empty)* | Docker Hub user (`scripts/push-images.sh`) |
| `DISCORD_BOT_TOKEN` | *(empty)* | Token of the Discord bot that manages the stack via `!` chat commands (requires the privileged **MESSAGE CONTENT** intent enabled) |
| `DISCORD_ALLOWED_ROLE_IDS` | *(empty)* | Discord role IDs allowed to use the bot (comma-separated) |
| `DISCORD_ALLOWED_USER_IDS` | *(empty)* | Discord user IDs allowed (comma-separated; with neither role nor ID the bot is disabled) |

**Web spectator (opt-in):**

Ports are derived per server index `i` in `config/servers.list` (relay `WATCH_HLTV_BASE+i`, listen `WATCH_LISTEN_BASE+i`, ICE `WATCH_UDP_BASE+(i*WATCH_UDP_SIZE)..+WATCH_UDP_SIZE-1`).

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCH_HLTV_BASE` | `27100` | HLTV relay UDP port base: `base+i` |
| `WATCH_LISTEN_BASE` | `27200` | Proxy port base (page + signaling WebSocket, TCP): `base+i` |
| `WATCH_UDP_BASE` | `27300` | Fixed UDP port range base for ICE (open in firewall/NAT) |
| `WATCH_UDP_SIZE` | `64` | UDP range size per server |
| `WATCH_CONSOLE_COMMANDS` | `spec_autodirector 1` | Console commands executed on the spectator client (auto camera) |
| `WATCH_PACKAGE_ZIP` | `/valve/valve.zip` | Path to `valve.zip` inside the proxy container |
| `WATCH_PUBLIC_BASE` | *(empty)* | Public spectator base URL (swag): the API exposes `spectatorUrl` = `BASE/<context>/` |
| `WATCH_UPSTREAM_HOST` | `127.0.0.1` | Host used by swag to reach `watch-main` (network_mode: host) |

> The public IP is no longer configured: the proxy discovers it via STUN (`stun.l.google.com`) per connection.

#### TLS/DDNS (swag & duckdns)

The **swag** (reverse TLS proxy) and **duckdns** (dynamic DNS) are part of the stack via `docker-compose.duckdns.yml` (included in `COMPOSE_FILE`):

| Host port | Use |
|-----------|-----|
| `8000` | HTTP: redirects to `https://...:4443` |
| `4443` | Main site HTTPS (`zueiracstrike.duckdns.org:4443` → `web:8080` via the host IP) |
| `4445` | Spectator HTTPS (`:4445/<context>/` → `watch-main` `27200+i` via the host IP) |

- swag data (nginx, certs, fail2ban) lives in `duckdns/swag/config/` (**gitignored**); the token is in `DUCKDNS_TOKEN` in `.env`.
- **Spectator `location` blocks**: `scripts/servers.sh compose` (and `swag-sync`) rewrites only the `# BEGIN/END servers.sh swag locations` region of the live proxy-conf, derived from `config/servers.list`, and restarts swag only when the file changed (and `nginx -t` passes). Removing a server also drops its block.
- **Cert backup**: `duckdns/backup.sh` produces `duckdns/backups/config-*.tar.gz` (config + certcheck patch + compose). Restoring `etc/letsencrypt/{live,archive,renewal}` fixes cert issues without burning the Let's Encrypt quota.
- **swag/cert caveat**: the swag image has a broken "old LE root" check (expects issuer "ISRG Root X", but the current chain is YE2→Root YE), which revoked the cert on every boot and burned the LE quota. The fix is **durable**: `docker-compose.duckdns.yml` mounts `duckdns/init-certbot-config.run` (a patched copy of the image's script) over the s6 file, so swag **does not reissue** the cert on restart/recreate.

#### CS Server config files

Each server has its config generated in `config/servers/<id>/` (see the **Multi-server** section) and mounted into the container:

| File | Mounted at |
|------|------------|
| `config/servers/<id>/users.ini` | `cstrike/addons/amxmodx/configs/users.ini` |
| `config/servers/<id>/server.cfg` | `cstrike/server.cfg` |
| `config/servers/<id>/mapcycle.txt` | `cstrike/mapcycle.txt` |
| `config/servers/<id>/motd.txt` | `cstrike/motd.txt` |
| `config/servers/<id>/plugins.ini` | `cstrike/addons/amxmodx/configs/plugins.ini` |

#### Live files

Files in `live/<id>/` are shared between the CS server plugin and the API for real-time display (one directory per server):

| File | Description |
|------|-------------|
| `live/<id>/live_scoreboard.json` | Live scoreboard (written by AMX Mod X plugin) |
| `live/<id>/live_killfeed.json` | Live killfeed (written by AMX Mod X plugin) |
| `live/watch/<id>/` | HLTV relay logs and `last_hltv_crash.txt` (spectator, per server) |

#### AMX Mod X plugins (`cs16/plugins/`)

The sources of the plugins that write the live files are versioned in `cs16/plugins/` and are **compiled and mounted into the game server container** (overriding the binaries shipped in the `leandrosalvas/cs16_stats` image):

| File | Description |
|------|-------------|
| `cs16/plugins/live_scoreboard.sma` | Generates `live/live_scoreboard.json` (T/CT scoreboard) |
| `cs16/plugins/live_killfeed.sma` | Generates `live/live_killfeed.json` (kill feed) |
| `cs16/plugins/slots_reserve.sma` | Reserves a slot for HLTV (spectator) so it never takes a player's place |
| `cs16/plugins/csstatsx_sql.sma` | Stats collection for the SQL database |
| `cs16/plugins/adminslots.sma` | Admin slot management |
| `cs16/plugins/amx_settings_api.sma` | AMX settings API |
| `cs16/plugins/cs_ham_bots_api.sma` | HAM API for bots |
| `cs16/plugins/cs_maxspeed_api.sma` | Max speed API |
| `cs16/plugins/cs_player_models_api.sma` | Player models API |
| `cs16/plugins/cs_teams_api.sma` | Teams API |
| `cs16/plugins/cs_weap_models_api.sma` | Weapon models API |
| `cs16/plugins/cs_weap_restrict_api.sma` | Weapon restriction API |
| `cs16/plugins/plugins.ini` | Active AMX Mod X plugin list |

Additionally, each mode has its own plugins in `cs16/vendor/mode_plugins/<mode>/` (e.g., `zombies/`, `csdm/`, `gungame/`, `surf/`), mounted into the container based on the configured mode.

To change a plugin, edit the `.sma` in `cs16/plugins/` and recompile:

```bash
./cs/build-plugins.sh   # uses the cs16_stats image amxxpc to produce the .amxx files
docker compose up -d cs16   # applies the mounted .amxx in the container
```

`docker-compose.yml` mounts the compiled `.amxx` files and the repo `plugins.ini` over the image's, so the workflow is always: edit `.sma` → `build-plugins.sh` → `up -d cs16`.

#### Public game server address (Connect page)

The host and port shown in `connect.html` (address, Steam button, and `connect` command) are set in `web/common.js`:

```javascript
const SERVER_HOST = 'your.host.here'
const SERVER_PORT = '27015'
```

The spectator button (CSTV page) uses `SPECTATOR_URL` in the same `web/common.js`:

```javascript
const SPECTATOR_URL = 'https://zueiracstrike.duckdns.org:4445/'
```

The `server_name` blocks with domains in `web/nginx.conf` are specific to the production deployment (HTTP → `https://...:4443` redirect, already exposed by swag) and can be removed for generic/local use.

#### Multi-server (automated provisioning)

The project can run multiple CS 1.6 servers at the same time, each with its own port, map, name, and live files. The **primary** server (first line of `config/servers.list`) is the only one used by snapshots/rankings, match tracking (`cs_matches`), and the web spectator.

**Usage flow:**

```bash
# Option A (recommended) — interactive wizard:
# asks how many servers you want, the name of each one, whether to rotate maps
# (and which maps), writes servers.list, creates the config/live files, and starts the stack.
./scripts/setup.sh

# Option B (manual) — edit config/servers.list (format: id name host_port map maxplayers rotate context mode cstv)
./scripts/servers.sh up
```

**Provisioner commands:**

| Command | Description |
|---------|-------------|
| `./scripts/setup.sh` | Interactive wizard: asks count/names, map rotation (and which maps) and starts the stack (flags: `--no-up`, `--yes`) |
| `./scripts/servers.sh init` | Creates `config/servers/<id>/` and `live/<id>/` from `servers.list` |
| `./scripts/servers.sh compose` | Generates `docker-compose.servers.yml` (override) + `docker-compose.watch.yml` (spectator) + `config/watch/swag-locations.conf.example` **and syncs the `location` blocks in the live swag conf** |
| `./scripts/servers.sh swag-sync` | Re-syncs the `location` blocks in the live swag proxy-conf and restarts swag if changed (idempotent) |
| `./scripts/servers.sh config` | Validates the merged compose |
| `./scripts/servers.sh up` | `init` + `compose` + `docker compose up -d --no-recreate` (no `--build`; builds are explicit via `servers.sh build`) |
| `./scripts/servers.sh build` | Builds the `cs16_stats:local` and `csserver_wstats-api` images |
| `./scripts/servers.sh down` | Stops the stack |
| `./scripts/servers.sh ps` | Container state |
| `./scripts/servers.sh status` | Summary of configured servers |
| `./scripts/servers.sh list` | Shows `config/servers.list` |
| `./scripts/servers.sh prune [ids]` | Deletes `config/servers/<id>` and `live/<id>` (with no ids, deletes those no longer in `servers.list`); with `--metrics`, also removes the server's Prometheus series |
| `./scripts/servers.sh rcon <id> <cmd>` | Runs an RCON command on a specific server |

**Example `config/servers.list`:**

```
# Format: id name host_port map maxplayers rotate context mode cstv
main Zueira 27015 de_dust2 30 yes zueira standard yes
gungame GunGame 27016 fy_iceworld 16 no gungame gungame yes
deathmatch DeathMatch 27017 de_dust 30 yes deathmatch csdm yes
zombies Zombies 27018 de_aztec 30 yes zombies zombies no
```

Rules and details:

- The 1st line is the primary and must keep the id `main`.
- `host_port` is the host-published port; inside the container all servers use the internal port `27015`.
- `context` (optional 7th column) is the web-spectator path slug (`WATCH_PUBLIC_BASE/<context>/`); must be unique and use only `a-z0-9`. Default = slugified name.
- `mode` (optional 8th column) is the game mode: `standard` (default), `zombies`, `csdm`, `surf`, or `gungame`. Each mode has its own plugins, configs, and MOTD.
- `cstv` (optional 9th column) enables web spectator services (watch-hltv + watch-main) for the server: `yes` or `no` (default). Unavailable for `zombies` mode.
- `maxplayers` = **visible** slots (even, 2..30, max **30**). The engine uses `visible + 1` (hidden slot reserved for HLTV via the `slots_reserve` plugin); since 30+1=31 is always below the engine's 32 cap, the hidden slot always exists. The API excludes the HLTV (`<context>-hltv`) from `players`/`playersList`. `pb_minbots 2` keeps a 2-bot floor.
- `rotate`: `yes` (default) = map rotation, with the list in `config/servers/<id>/mapcycle.txt` (the wizard asks which maps from the image go into the rotation); `no` = the `mapcycle.txt` holds only the chosen map (no map changes).
- If the server's `mapcycle.txt` does not exist yet with `rotate=yes`, `init` copies the shared `config/mapcycle.txt` as the default; with `rotate=no` it rewrites the single map when the content changes.
- `server.cfg` files are generated from `config/templates/server.cfg` using the `RCON_PASSWORD` from `.env` (a single password for all servers).
- Each server writes its own live files in `live/<id>/`, which the API reads per server (`/api/live/state?server=<id>`).
- All pages have a server selector (Home, Live, Rankings, Maps, Player, Advanced, Matches, and RCON Panel); rankings, tops, maps, and matches are filtered by the selected server and RCON commands run against the target server.
- Grafana metrics are labeled per server (`cs16_players_online{server="..."}`) with a server variable in the dashboard.
- The `.env` sets `COMPOSE_FILE=docker-compose.yml:docker-compose.servers.yml:docker-compose.duckdns.yml`: after generation, plain `docker compose ps/logs/config/up` use the override and the swag/duckdns services without needing `-f` (the override is regenerated by `servers.sh compose`/`up` or `setup.sh`). The spectator compose is NOT in `COMPOSE_FILE` — it is opt-in via `./scripts/watch.sh`.

##### Adding a new server (step by step)

Example: add the `surf` server on port **27019**, map `surf_ski_2`, and **20** slots.

**With the wizard** (recommended):

```bash
./scripts/setup.sh
```

Enter the desired total, the new server's name (map rotation, port/map/slots have defaults), and confirm. If you choose rotation (`S`), the wizard lists the maps available in the image and you pick the numbers of the maps to rotate (Enter keeps the curated `config/mapcycle.txt` maps); if you answer `n`, the server keeps only the chosen map. The wizard updates `servers.list`, generates the files, and starts the stack.

**Or manually:**

1. **Edit `config/servers.list`** and add the line:

   ```
   surf Surf 27019 surf_ski_2 20 yes surf surf surf yes
   ```

   Format: `id name host_port map maxplayers rotate context mode cstv` — use a short `id`, with no spaces. The `context`, `mode`, and `cstv` columns are optional: `context` defaults to slugified name; `mode` defaults to `standard`; `cstv` defaults to `no` (unavailable for `zombies`). For a custom rotation, create/edit `config/servers/<id>/mapcycle.txt` with the map list (or run the wizard); use `no` to disable rotation.

2. **Run the provisioner** (generates the files and starts the stack):

   ```bash
   ./scripts/servers.sh up
   ```

3. **Verify**:

   ```bash
   ./scripts/servers.sh status
   ./scripts/servers.sh rcon surf status
   ```

What happens under the hood:

- `init` creates `config/servers/surf/` (server.cfg with hostname "Surf" and the RCON password from `.env`, `users.ini`, `mapcycle.txt`, `motd.txt`, and `plugins.ini`) and `live/surf/` with empty JSON files. The `mapcycle.txt` is only created if missing (or becomes the single chosen map with `rotate=no`), preserving the per-server rotation. For specific modes (zombies, csdm, surf, gungame), `server.cfg` and `plugins.ini` templates are copied from `config/templates/modes/<mode>/` when they exist.
- `compose` regenerates `docker-compose.servers.yml` with the `cs16surf` container (port 27019 published) and adds the server to the API `CS_SERVERS`.
- If `cstv=yes`, `init` also creates `config/watch/surf/` (hltv.cfg + start-hltv.sh) and `compose` generates `cs16-watch-hltv-surf` + `cs16-watch-main-surf` containers.
- The API starts detecting the new server via Gamedig; the server selectors on all pages show it automatically, as do the online/offline alerts and the Grafana metrics.

##### Customizing a server

- The server's map rotation is `config/servers/<id>/mapcycle.txt` (one map per line, in order). Edit it by hand or run the wizard and pick the maps from the selection. With `rotate=no` in `servers.list`, `init` forces the file to contain only the chosen map.
- Plugins and other files: edit the files in `config/servers/<id>/` (e.g. plugins in `plugins.ini`) and run `./scripts/servers.sh up` — or, to apply to a single server:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.servers.yml up -d cs16surf
  ```

- If the map set in `servers.list` is not installed, HLDS picks another map — install the map or adjust the value/`mapcycle.txt`.
- The map list offered by the wizard comes from the image (`/home/cs16/cstrike/maps/*.bsp`); if the image is not local yet, the wizard falls back to the maps in `config/mapcycle.txt`.

##### Removing a server

**With the wizard** (recommended):

```bash
./scripts/setup.sh
```

Enter a lower total and choose which servers to remove. The wizard asks whether to also delete `config/servers/<id>` and `live/<id>` (keeping them is the default and lets you revert).

**Or manually:**

1. Delete the matching line from `config/servers.list`.
2. Refresh the stack (regenerates compose without the server; `--no-recreate` does not remove existing containers):

   ```bash
   ./scripts/servers.sh up
   ```

3. Remove the container and optionally the config/live files:

   ```bash
   ./scripts/servers.sh prune surf
   ```

> Database data (stats, snapshots, and matches) of a removed server is **always preserved**; the frontend selectors stop showing it automatically. With `--metrics`, `prune` also removes the server's series from Prometheus (via the Admin API, bound to `127.0.0.1:9090`).

##### Important

- `docker-compose.servers.yml` is **auto-generated** — do not edit it by hand; change `config/servers.list` and run `./scripts/servers.sh compose`.
- The UDP **and** TCP `host_port` ports must be free on the host.
- `config/servers/` and `live/` are not versioned (the `server.cfg` contains the RCON password).

#### Web Spectator (WebRTC)

The spectator lets you watch **enabled servers** directly in the browser, without installing CS 1.6. Only servers with `cstv=yes` in the 9th column of `config/servers.list` get spectator containers (zombies mode is automatically disabled). Each enabled server gets a `watch-main-<id>` + `watch-hltv-<id>` pair; the flow (per server) is:

```
Browser (Xash3D WASM) ──WebRTC──▶ watch-main-<id> (proxy 27200+i) ──UDP──▶ watch-hltv-<id> (relay 27100+i) ──▶ cs16<id> (127.0.0.1:<host_port>)
```

Each proxy serves its server at `BASE_PATH=/<context>/` (7th `servers.list` column), so the public path is `https://...:4445/<context>/`.

`watch-main` is the `watch/webxash3d-proxy` submodule (fork `LeandroSalvas/webxash3d-proxy` of `bordeux/webxash3d-proxy`), a Rust WebRTC→UDP proxy with an Xash3D WASM client. Local modifications (HLTV connect-ack rewrite, vendored DTLS for Chrome, self-healing, `BASE_PATH` contexts, etc.) are documented in `watch/webxash3d-proxy/PATCHES.md`.

**Opt-in**: all services carry `profiles: ["watch"]`, so the default stack never starts them. Manage with:

```bash
./scripts/watch.sh up|down|build|ps|status|logs|restart|backup|restore
```

| Command | Description |
|---------|-------------|
| `up` | Starts all `watch-main-<id>` + `watch-hltv-<id>` (builds `cs16_stats:local` and the proxy if missing) |
| `down` | Stops the spectator stack |
| `build` | Rebuilds the spectator client (required after submodule changes) |
| `status` | Service health + last HLTV crash, per server |
| `backup`/`restore` | Copies `valve.zip` to/from `./backups/` |

**Assets**: `valve/valve.zip` (proprietary Half-Life assets) is **gitignored**; `watch.sh backup`/`restore` preserves it. The compose mounts it read-only into the `watch-main` services.

**Ports** (per index `i` in `config/servers.list`; 4 servers today = 0..3):

| Port | Usage |
|------|-------|
| `27100+i` UDP | HLTV relay (`watch-hltv-<id>`) |
| `27200+i` TCP | Spectator page + signaling WebSocket (`/websocket`) |
| `27300+(i*64)..+63` UDP | WebRTC (ICE) |
| `4445` TCP | Spectator HTTPS (via swag, part of the stack) |

> **No router port forwarding needed** (no port-forward, no DMZ): all external access goes through swag (`:4445`, TLS/WSS) and the WebRTC media crosses the NAT via STUN (public IP discovered through `stun.l.google.com`) on the fixed UDP range `27300+`. The `27100+/27200+/27300+` ports are host bindings only (internal path swag→watch-main→relay→game).

`watch-main` uses `network_mode: host` (announces the LAN IP as an ICE candidate and resolves the browser's mDNS `.local` candidates). In production, swag serves `https://zueiracstrike.duckdns.org:4445/<context>/` → `http://192.168.15.54:27200+i`. The location blocks are generated in `config/watch/swag-locations.conf.example` **and synced automatically** into the live swag proxy-conf by `servers.sh compose`/`swag-sync` (marker region; idempotent rewrite; swag restarted only when `nginx -t` passes).

**Self-healing** (client + proxy):

- Client stall watchdog: if no game packet arrives for **15s**, it forces `rejoin()` (disconnect + connect on the same WebRTC channel); after **6** attempts it reloads the page once (guarded by `sessionStorage`). The reload is **silent** (the `beforeunload` dialog was removed).
- Proxy bridge idle teardown: **25s** without upstream data tears the bridge down and signals the client to reconnect (armed after the first packet or the browser handshake).
- Automatic reconnect on data-channel `close`/`error`.
- Hidden tab: a `requestAnimationFrame` shim keeps the engine loop alive and the `net.incoming` backlog is raised to `maxPackets: 16384` — short hides fast-forward to live instead of freezing; hides over 60s reconnect.
- **Active-tab freeze (buffer overflow)**: the relay produces faster than the engine consumes (1 packet/frame via `recvfrom`); the buffer filled in ~3-7min and dropping the oldest packet broke the HLTV delta chain again (permanent freeze, stall watchdog quiet because packets kept arriving). Fixed with a backlog high-watermark watchdog (`rejoin()` at 80% full) + `rejoin()` flushing the old session's backlog (`netClear()`); the relay runs `sys_ticrate 30` so production matches consumption.
- **Microphone**: the engine glue requests `getUserMedia` at boot (voice capture); a stub in `index.html` rejects it — no permission prompt for spectators.
- Staged PT-BR loading screen with a progress bar; JS/WebGL2 errors surface on screen instead of a black screen.
- **Spectator volume**: global per-tab volume via Web Audio — `index.html` wraps the `AudioContext`'s `ctx.destination` in a `GainNode` (`window.setSpectatorVolume(v)`) and there is a persistent **Vol** slider (saved under the `localStorage` key `spectatorVolume`). Audio is browser-local (Web Audio), so nothing on the server controls a spectator's volume.

#### Discord Bot (manages the stack via chat)

The API runs a Discord bot that controls game servers, the stack, and the spectators via text commands in the channel. It runs **inside the API process** (`api/lib/discordBot.js`) and calls the internal modules directly (no HTTP/CSRF): `serverManager` for start/stop/restart, `runRconCommand` for RCON, `stackHealthState` for stack state, `queryServer`/`findServer` for game state, and the docker CLI (the same socket as `serverManager`) for logs/stats/health.

**Configuration** (`.env`):

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Bot token (create an application in `discord.com/developers` → Bot). **Enable the privileged MESSAGE CONTENT intent** and invite the bot with read/send-message permissions (OAuth2 URL Generator, `bot` scope). |
| `DISCORD_ALLOWED_ROLE_IDS` | Authorized role IDs (comma-separated) |
| `DISCORD_ALLOWED_USER_IDS` | Authorized user IDs (comma-separated) |

Without a token or permissions the bot is disabled without crashing. The variables are passed to the container in `docker-compose.yml`.

**Commands** (`!` prefix, only members with an authorized role/ID):

| Command | Description |
|---------|-------------|
| `!status` | Servers + stack |
| `!servidores` | Lists the game servers |
| `!stack` | Stack service states |
| `!start <id>` / `!stop <id>` / `!restart <id>` | Server control |
| `!rcon <id> <command>` | RCON on the server |
| `!changelevel <id> <map>` | Changes the server map (RCON `changelevel`) |
| `!mapas` | Maps available in the image |
| `!player <name or steamid>` | Player stats (same SQL as `top.js`, bots filtered out) |
| `!logs <id or service> [n]` | Last `n` log lines of a container (e.g. `!logs zueira2 20`, `!logs api 50`) |
| `!ps` | CPU/memory of the project containers (`docker stats`) |
| `!watch [id]` | Spectator health (all, or a single server): `watch-main`/`watch-hltv` health, last crash, and mudo episodes |
| `!uptime` | API uptime/version and services up |
| `!ajuda` | Lists the commands |

Replies are truncated at ~1900 chars (Discord's limit). Mutations (`start/stop/restart`, `rcon`, `changelevel`) also trigger `sendAlert` on the same alerts webhook. **Spectator volume cannot be changed via the bot**: audio is browser-local (Web Audio), nothing on the server controls it.

**Operational note**: the HLTV relay can go "silent" (process alive and connected to the server, but not sending data). The self-healing above unlocks the session; the definitive fix is restarting the game server (HLTV reconnects on its own in ~20s). The `scripts/watch-mudo.sh` cron detects and recovers mudo automatically (RCON kick). Monitor `live/watch/<id>/last_hltv_crash.txt` and `watch.sh status`.

#### API upgrade and smoke test

The API runs on **Node 26** + **Express 5**. To validate the running API and perform upgrades with automatic rollback:

```bash
# Validates the running API (exit 0 = healthy): composition, endpoints, redis/session.
./scripts/smoke-test.sh
# Flags: --fase a|b (subsets), --rollback (skips rate-limit/SIGTERM/robustness)

# Upgrade with snapshot + automatic rollback on failure.
./scripts/upgrade.sh --fase a|b
# Flags: --no-auto-rollback (manual inspection); upgrade.sh rollback [tag] / list
```

Details: the upgrade snapshots (`csserver_wstats-api:rollback-<ts>` + HEAD in `.rollback-state`), applies changes, regenerates the lockfile, builds, starts `api`, waits for health, and runs the smoke test; on failure it restores image + code (`git reset --hard`) and revalidates. Expected versions are **derived from the current source** (Dockerfile/package.json), so the same script validates upgrades and rollbacks. Note: the smoke test consumes the login rate-limit window (60s) — a full run briefly locks out login for the host IP.

### Web Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` | General overview, top 10, and server status |
| Maps | `/maps.html` | List of registered maps and snapshots |
| Map Ranking | `/map.html?map=<name>` | Player rankings for a specific map |
| Rankings | `/rankings.html` | Weekly and monthly rankings |
| Advanced | `/advanced.html` | Top headshots, accuracy, and killstreaks |
| Matches | `/matches.html` | Match history (score, winner, duration) |
| Player Profile | `/player.html?steamid=<id>` | Individual stats and history |
| Connect | `/connect.html` | Server connection guide |
| Live Match | `/live.html` | Live scoreboard and killfeed |
| Duel | `/duelo.html` | Head-to-head player comparison |
| CSTV | `/cstv.html` | Web spectator (WebRTC) with server selector |
| RCON Panel | `/admin.html` | RCON command execution *(admin)* |
| System | `/system.html` | Status of all subsystems *(admin)* |
| Servers | `/servidores` | Server management: add/remove/start/stop/restart *(admin)* |
| Users | `/usuarios` | Social login approval and roles *(superadmin)* |
| Login | `/login` | Local (superadmin) + Google/Steam login |

> Pages marked *(admin)* / *(superadmin)* are actually protected: nginx uses `auth_request` on `/api/auth/guard` and redirects to `/login?next=...` when there is no active admin session.

### API Reference

All routes must be accessed via the `/api` prefix (Nginx proxy). Example: `http://<host>:8080/api/health`

> In multi-server mode, stats, top, ranking, player, map, and match endpoints accept `?server=<id>` to filter data for a specific server (e.g. `/api/top10?server=frag`). Without the parameter they return consolidated data from all servers.

#### Health & Status

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | API, database, and Redis status |
| `GET` | `/api/stats` | General stats (players, kills, maps) — accepts `?server=` |
| `GET` | `/api/server` | Current CS server status |

#### Rankings

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/top10` | Top by kills (default 10) |
| `GET` | `/api/topskill` | Top by skill |
| `GET` | `/api/topkd` | Top by K/D (min. 10 kills) |
| `GET` | `/api/ranking/weekly` | Weekly ranking (last 7 days) |
| `GET` | `/api/ranking/monthly` | Monthly ranking (last 30 days) |

> Ranking and top endpoints accept `?limit=` and `?page=` for pagination (default `limit=10`, max 50) and `?server=` to filter by server.

#### Player

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/player/:steamid` | Player details |
| `GET` | `/api/player-search?q=` | Player search by name or steamid (LIMIT 10) |
| `GET` | `/api/player-history-daily/:steamid` | Daily kill/death history |
| `GET` | `/api/player-last-map/:steamid` | Last map played |
| `GET` | `/api/player-rank-history/:steamid` | Daily rank position history |

> All player endpoints accept `?server=` to filter data for a specific server.

#### Advanced

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/top-headshots` | Top by headshots |
| `GET` | `/api/top-accuracy` | Top by headshot % (min. 10 kills) |
| `GET` | `/api/top-killstreak` | Top by highest kill streak |
| `GET` | `/api/top-assists` | Top by assists |
| `GET` | `/api/top-damage` | Top by damage dealt |
| `GET` | `/api/top-tk` | Top by team kills |
| `GET` | `/api/top-bomb` | Top by bomb actions (plants + defuses + def + explosions) |
| `GET` | `/api/top-connect-time` | Top by total connected time |

> All advanced endpoints accept `?server=` to filter by server.

#### Maps

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/maps` | List of registered maps |
| `GET` | `/api/map/:map` | Simplified map ranking |
| `GET` | `/api/map-ranking/:map` | Detailed map ranking with deltas |

> All map endpoints accept `?server=` to filter by server.

#### Live

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/live/killfeed` | Live killfeed (last 5) |
| `GET` | `/api/live/state` | Live scoreboard state |
| `GET` | `/api/live/events` | Server-Sent Events stream with realtime updates |

> The Live page uses SSE (`/api/live/events`) for realtime updates, falling back to polling if SSE fails. Live endpoints accept `?server=<id>` to select a specific server (multi-server).

#### Matches

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/matches` | Match history (accepts `?limit=`, `?page=` and `?server=`) |
| `GET` | `/api/matches/latest` | Last registered match |
| `GET` | `/api/matches/:id` | Match details |

> The `live_scoreboard` plugin reports the per-map round score (T/CT) and, on map change, publishes the result as `last_match`. The API reads it every 2s and inserts into `cs_matches` (table auto-created with a unique `server + map + ended_at` key to avoid duplicates). Each server registers only its own matches (`?server=`).

#### Servers & Alerts

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/servers` | Status of all configured servers (`CS_SERVERS`) |
| `GET` | `/api/server/:id` | Detailed status of a specific server |
| `GET` | `/api/server` | Primary server status |
| `GET` | `/api/alerts` | Current alert state and recent history |

> Alerts compare the primary server online/offline state every 30s. When the state changes and `ALERT_WEBHOOK_URL` is set, a webhook is sent (`{"text": ...}` format, or `{"content": ...}` for Discord).

#### Metrics (Prometheus)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/metrics` | Prometheus-format metrics (default metrics + HTTP requests, players online per server, DB up, matches) |

> Grafana runs at `http://<host>:3001` with datasource and dashboards provisioned by file (`config/grafana/provisioning/` + `cs16-infra.json`). Prometheus scrapes 5 jobs: `cs16-api` (Basic Auth `METRICS_USER`/`METRICS_PASS`), `nginx` (`:9113`), `nginxlog` (`:4040`), `node` (host via `host.docker.internal:9100`) and `cadvisor` (`:8080`). The Admin API (`127.0.0.1:9090`) is used by `servers.sh prune --metrics`. Average-response-time panels (API and Front) use 30m windows (sparse traffic).

#### Authentication

`httpOnly` session cookie (`cs16.sid`, `sameSite=lax`, rolling renewal), scrypt local password, **double-cookie CSRF** (`csrf_token` + `x-csrf-token` header) required on every mutation, and login rate limit (5/60s per IP → 429). The `users` table lives in MariaDB (idempotently migrated by `ensureSchema`).

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/auth/login` | Local user/password login (superadmin) |
| `GET` | `/api/auth/session` | Current session (user, role, CSRF token) |
| `GET` | `/api/auth/status` | Configured social login state (Google/Steam) |
| `POST` | `/api/auth/logout` | Ends the session |
| `GET` | `/api/auth/guard` | Public: 200 if active admin, else 401 (used by nginx `auth_request`) |
| `GET` | `/api/auth/google` + `/api/auth/google/callback` | Google OAuth2 login |
| `GET` | `/api/auth/steam` + `/api/auth/steam/callback` | Steam login (OpenID 2.0, no Web API key) |
| `GET` | `/api/auth/steam/status` | Steam login configuration status |

> **Every first social login (Google/Steam) is born `pending`** and must be approved by the superadmin in `/usuarios`. The local superadmin is created on boot (`SEED_ADMIN=1`) with credentials in `ADMIN_CREDENTIALS.txt` (gitignored; regenerate with `docker compose exec api node scripts/seed-admin.js --reset`). Roles: `superadmin` (full), `admin` (server operations + RCON), `pending`. nginx protects `/admin.html`, `/system.html`, `/servers.html`, and `/users.html` with `auth_request /api/auth/guard` → `/login?next=...`.

#### Users (admin)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/admin/users` | Lists users and roles |
| `POST` | `/api/admin/users/:id/approve` | Approves a `pending` user (sets role) |
| `POST` | `/api/admin/users/:id/reject` | Rejects a `pending` user |
| `POST` | `/api/admin/users/:id/role` | Changes a user's role |
| `DELETE` | `/api/admin/users/:id` | Removes a user |

#### Servers (admin)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/admin/servers` | Lists servers (enriched with `servers.list`) |
| `GET` | `/api/admin/servers/maps` | Maps available in the image |
| `POST` | `/api/admin/servers` | Adds a server (provisions via `servers.sh up` in a disposable container) |
| `DELETE` | `/api/admin/servers/:id` | Removes a server (unprovision) |
| `POST` | `/api/admin/servers/:id/start` | Starts the server |
| `POST` | `/api/admin/servers/:id/stop` | Stops the server |
| `POST` | `/api/admin/servers/:id/restart` | Restarts the server |

> All admin routes require session + CSRF + `commandLimiter`. Add/remove regenerate the override, so compose **recreates the api container** mid-request — the caller gets 502/cut connection but the operation **completes** (`web/servers.js` treats network errors as "provisioning, reloading..."). Automatic RCON (`/api/admin/command`) uses the server's credential (no more RCON password card on the admin page). `writeServersList` keeps a `.bak` and `add()`/`remove()` revert the list if provisioning fails.

#### Admin (RCON)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/admin/command` | Execute RCON command (requires `admin` session, CSRF token, rate limited) |
| `POST` | `/api/admin/logout` | End admin session (requires CSRF token) |
| `GET` | `/api/admin/session` | Check session status and get CSRF token |

> Admin write endpoints require the `x-csrf-token` header (obtained from `/api/admin/session`, rotated on each login via session `regenerate`). The session cookie (`cs16.sid`) is `httpOnly`, `sameSite=lax`, with `rolling` renewal.

### Snapshot System

The API polls the `csstats` table every **60 seconds**. When it detects changes (kills, deaths, hs, skill) or a map change, it saves a record to `csstats_snapshots` with a timestamp. Only active players are recorded (and `unknown`/offline maps are skipped). These snapshots power:

- Weekly and monthly rankings (with delta calculation via window functions)
- Daily per-player history
- Detailed per-map rankings
- Evolution chart on the player page

**Existing databases:** `schema.sql` now includes the `csstats_snapshots` indexes (`steamid, created_at`, `map`, `created_at`). To apply them to a database already in production, run:

```sql
ALTER TABLE `csstats_snapshots`
  ADD KEY `idx_snap_steamid_time` (`steamid`, `created_at`),
  ADD KEY `idx_snap_map` (`map`),
  ADD KEY `idx_snap_created` (`created_at`);
```

### Internationalization (i18n)

- Languages: Portuguese (PT) and English (EN)
- Automatic browser language detection
- Preference saved in `localStorage`
- Translations in `web/i18n/translations.js`
- HTML elements use the `data-i18n` attribute for automatic translation

### Development

```bash
# Rebuild and restart API after changes
docker compose up -d --build api

# Frontend auto-reloads (volume mounted)
# Just edit files in web/

# View logs
docker compose logs -f api
docker compose logs -f web
docker compose logs -f db

# Web spectator: rebuild the client (after submodule changes)
./scripts/watch.sh build

# Validate the running API
./scripts/smoke-test.sh

# Publish images to Docker Hub (cs16, api, watch-main)
./scripts/push-images.sh          # docker login first; tags latest + v<AAAAMMDD>-<HHMM>

# Backup swag certs (config + certcheck patch + compose)
./duckdns/backup.sh               # produces duckdns/backups/config-<date>.tar.gz

# Recover a "silent" HLTV relay (RCON kick)
./scripts/watch-mudo.sh           # cron every minute; or watch-mudo.sh <id>...
```

### Troubleshooting

**API won't start:**
```bash
docker compose logs api
```
Check that `.env` is configured with `SESSION_SECRET` and database variables. The container will exit if `SESSION_SECRET` is empty.

**Database connection error:**
```bash
docker compose logs db
```
Verify the `MYSQL_*` variables in `.env`. The database may take a few seconds to become ready — compose uses a healthcheck to ensure startup order.

**Web opens but no data:**
```bash
docker compose logs api
docker exec csserver_wstats-db-1 mysql -u root -p<password> -e "USE csstats; SELECT COUNT(*) FROM csstats;"
```
If the `csstats` table is empty, verify the game server is running correctly. The integrated AMX Mod X stats plugin collects data automatically when players connect and play.

**Spectator frozen or blank:**
```bash
./scripts/watch.sh status      # service health + last HLTV crash, per server
./scripts/watch.sh logs -f     # proxy/relay logs
```
The client self-heals (rejoin + silent reload). If an HLTV relay went silent, the `scripts/watch-mudo.sh` cron recovers it (RCON kick); the definitive fix is restarting the game server (`docker compose restart cs16<id>`) — HLTV reconnects on its own in ~20s. Also check `live/watch/<id>/last_hltv_crash.txt`.

**Admin login blocked (429):** the `smoke-test.sh` shares the login rate-limit window (60s) with the host. Wait for the interval and retry.

**swag without certificate / burned Let's Encrypt quota (image ~2026):**
```bash
docker compose ps swag          # unhealthy
docker compose logs swag | grep -i cert
```
The "old LE root" check of the image is worked around **durably** by the `ro` mount of `duckdns/init-certbot-config.run` in the compose file (swag **does not** reissue the cert on boot). If the cert still vanished or swag is cert-less for hours (quota 5 certs/168h), restore from a backup: `duckdns/backups/config-*.tar.gz` → restore `etc/letsencrypt/{live,archive,renewal}`. **Do not run repeated `docker compose up -d` while swag has no cert** — each boot tries to reissue and burns the quota.

**swag cert expiring / renewal:** swag renews automatically via certbot. The backup in `duckdns/backups/` holds the last known-good state (restoring resolves without burning quota).

**cAdvisor without fs data in Grafana:** the image is a local build of the `dillon-giacoppo/cadvisor` fork (containerd snapshotter); CPU/memory/network work, filesystem does not — expected behavior.
