# CS Server Stats

> Sistema de monitoramento para servidores de Counter-Strike 1.6.
> Monitoring system for Counter-Strike 1.6 servers.

---

## 🇧🇷 Português (BR)

### Visão geral

CS Server Stats é um painel de monitoramento para servidores de Counter-Strike 1.6 com API Node.js, frontend vanilla JavaScript, MariaDB para dados, Redis para cache/sessão e Nginx para servir a interface web. Coleta, armazena e exibe estatísticas de partidas em tempo real e histórico de jogadores.

### Arquitetura

O projeto é orquestrado com Docker Compose e consiste em 5 serviços:

| Serviço | Descrição |
|---------|-----------|
| `cs16` | Servidor de jogo com AMX Mod X configurado |
| `db` | MariaDB para armazenamento de estatísticas |
| `redis` | Cache e armazenamento de sessões |
| `api` | Backend Node.js (Express) com endpoints REST |
| `web` | Frontend estático servido via Nginx com proxy reverso para a API |

### Funcionalidades

- Status do servidor e estatísticas em tempo real
- Rankings de jogadores (geral, semanal, mensal e por mapa)
- Perfis individuais com gráfico de evolução de kills e histórico diário
- Estatísticas avançadas: top headshots, precisão e killstreaks
- Placar ao vivo e killfeed em tempo real
- Painel admin com comandos RCON e autenticação por sessão
- Suporte a dois idiomas (Português/Inglês)
- Sistema de snapshots para rastrear progresso histórico
- Guia de conexão com suporte ao protocolo Steam

### Pré-requisitos

- Docker
- Docker Compose
- Portas disponíveis: **8080** (painel web), **27015** (servidor de jogo UDP/TCP)

### Início Rápido

**1. Clone o repositório:**

```bash
git clone <repo-url>
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
| `RCON_PASSWORD` | Senha RCON do servidor (deve bater com `config/server.cfg`) | `rcon123` |

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

#### Arquivos de configuração do CS

Os arquivos em `config/` são montados automaticamente no container do jogo:

| Arquivo | Montado em |
|---------|------------|
| `config/users.ini` | `cstrike/addons/amxmodx/configs/users.ini` |
| `config/server.cfg` | `cstrike/server.cfg` |
| `config/mapcycle.txt` | `cstrike/mapcycle.txt` |
| `config/motd.txt` | `cstrike/motd.txt` |

#### Arquivos live

Os arquivos em `live/` são compartilhados entre o servidor CS e a API:

| Arquivo | Descrição |
|---------|-----------|
| `live/live_scoreboard.json` | Placar ao vivo (escrito pelo plugin AMX Mod X) |
| `live/live_killfeed.json` | Killfeed ao vivo (escrito pelo plugin AMX Mod X) |

### Páginas Web

| Página | URL | Descrição |
|--------|-----|-----------|
| Home | `/` | Resumo geral, top 10 e status do servidor |
| Mapas | `/maps.html` | Lista de mapas registrados e snapshots |
| Ranking por Mapa | `/map.html?map=<nome>` | Ranking de jogadores em um mapa específico |
| Rankings | `/rankings.html` | Rankings semanal e mensal |
| Avançadas | `/advanced.html` | Top headshots, precisão e killstreaks |
| Perfil do Jogador | `/player.html?steamid=<id>` | Estatísticas individuais e histórico |
| Conectar | `/connect.html` | Guia de conexão ao servidor |
| Live Match | `/live.html` | Placar ao vivo e killfeed |
| Painel RCON | `/admin.html` | Autenticação e execução de comandos RCON |
| Sistema | `/system.html` | Status de todos os subsistemas |

### Referência da API

Todas as rotas devem ser acessadas via prefixo `/api` (proxy Nginx). Exemplo: `http://<host>:8080/api/health`

#### Saúde e Status

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/health` | Status da API, banco e Redis |
| `GET` | `/api/stats` | Estatísticas gerais (jogadores, kills, mapas) |
| `GET` | `/api/server` | Status atual do servidor CS |

#### Rankings

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/top10` | Top 10 por kills |
| `GET` | `/api/topskill` | Top 10 por skill |
| `GET` | `/api/topkd` | Top 10 por K/D (mín. 10 kills) |
| `GET` | `/api/ranking/weekly` | Ranking semanal (últimos 7 dias) |
| `GET` | `/api/ranking/monthly` | Ranking mensal (últimos 30 dias) |

#### Jogador

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/player/:steamid` | Detalhes de um jogador |
| `GET` | `/api/player-history-daily/:steamid` | Histórico diário de kills/deaths |
| `GET` | `/api/player-last-map/:steamid` | Último mapa jogado |

#### Avançadas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/top-headshots` | Top 10 por headshots |
| `GET` | `/api/top-accuracy` | Top 10 por % de headshots (mín. 10 kills) |
| `GET` | `/api/top-killstreak` | Top 10 por maior sequência de kills |

#### Mapas

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/maps` | Lista de mapas registrados |
| `GET` | `/api/map/:map` | Ranking simplificado por mapa |
| `GET` | `/api/map-ranking/:map` | Ranking detalhado por mapa com deltas |

#### Live

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/live/killfeed` | Killfeed ao vivo (últimos 5) |
| `GET` | `/api/live/state` | Estado do placar ao vivo |

#### Admin (RCON)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/admin/login` | Autenticar com senha RCON (com rate limit) |
| `POST` | `/api/admin/command` | Executar comando RCON (requer sessão, com rate limit) |
| `POST` | `/api/admin/logout` | Encerrar sessão admin |
| `GET` | `/api/admin/session` | Verificar status da sessão |

### Sistema de Snapshots

A API consulta a tabela `csstats` a cada **60 segundos**. Quando detecta mudanças (kills, deaths, hs, skill) ou troca de mapa, salva um registro em `csstats_snapshots` com timestamp. Esses snapshots alimentam:

- Rankings semanais e mensais (com cálculo de deltas via window functions)
- Histórico diário por jogador
- Ranking detalhado por mapa
- Gráfico de evolução na página do jogador

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
Se a tabela `csstats` está vazia, o servidor CS precisa estar rodando com o plugin de stats AMX Mod X ativo. Os dados são preenchidos quando jogadores se conectam e jogam.

---

## 🇺🇸 English (US)

### Overview

CS Server Stats is a monitoring dashboard for Counter-Strike 1.6 servers with a Node.js API, vanilla JavaScript frontend, MariaDB for data storage, Redis for cache/sessions, and Nginx serving the web interface. It collects, stores, and displays real-time match statistics and player history.

### Architecture

The project is orchestrated with Docker Compose and consists of 5 services:

| Service | Description |
|---------|-------------|
| `cs16` | Game server with AMX Mod X configured |
| `db` | MariaDB for stats storage |
| `redis` | Cache and session store |
| `api` | Node.js (Express) backend with REST endpoints |
| `web` | Static frontend served via Nginx with reverse proxy to the API |

### Features

- Real-time server status and player statistics
- Player rankings (overall, weekly, monthly, and per-map)
- Individual player profiles with kill evolution chart and daily history
- Advanced stats: top headshots, accuracy, and killstreaks
- Live scoreboard and killfeed
- Admin panel with RCON commands and session-based authentication
- Bilingual support (Portuguese/English)
- Snapshot system for tracking historical progression
- Connection guide with Steam protocol support

### Prerequisites

- Docker
- Docker Compose
- Available ports: **8080** (web panel), **27015** (game server UDP/TCP)

### Quick Start

**1. Clone the repository:**

```bash
git clone <repo-url>
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
| `RCON_PASSWORD` | Server RCON password (must match `config/server.cfg`) | `rcon123` |

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

#### CS Server config files

Files in `config/` are automatically mounted into the game container:

| File | Mounted at |
|------|------------|
| `config/users.ini` | `cstrike/addons/amxmodx/configs/users.ini` |
| `config/server.cfg` | `cstrike/server.cfg` |
| `config/mapcycle.txt` | `cstrike/mapcycle.txt` |
| `config/motd.txt` | `cstrike/motd.txt` |

#### Live files

Files in `live/` are shared between the CS server and the API:

| File | Description |
|------|-------------|
| `live/live_scoreboard.json` | Live scoreboard (written by AMX Mod X plugin) |
| `live/live_killfeed.json` | Live killfeed (written by AMX Mod X plugin) |

### Web Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` | General overview, top 10, and server status |
| Maps | `/maps.html` | List of registered maps and snapshots |
| Map Ranking | `/map.html?map=<name>` | Player rankings for a specific map |
| Rankings | `/rankings.html` | Weekly and monthly rankings |
| Advanced | `/advanced.html` | Top headshots, accuracy, and killstreaks |
| Player Profile | `/player.html?steamid=<id>` | Individual stats and history |
| Connect | `/connect.html` | Server connection guide |
| Live Match | `/live.html` | Live scoreboard and killfeed |
| RCON Panel | `/admin.html` | RCON authentication and command execution |
| System | `/system.html` | Status of all subsystems |

### API Reference

All routes must be accessed via the `/api` prefix (Nginx proxy). Example: `http://<host>:8080/api/health`

#### Health & Status

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | API, database, and Redis status |
| `GET` | `/api/stats` | General stats (players, kills, maps) |
| `GET` | `/api/server` | Current CS server status |

#### Rankings

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/top10` | Top 10 by kills |
| `GET` | `/api/topskill` | Top 10 by skill |
| `GET` | `/api/topkd` | Top 10 by K/D (min. 10 kills) |
| `GET` | `/api/ranking/weekly` | Weekly ranking (last 7 days) |
| `GET` | `/api/ranking/monthly` | Monthly ranking (last 30 days) |

#### Player

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/player/:steamid` | Player details |
| `GET` | `/api/player-history-daily/:steamid` | Daily kill/death history |
| `GET` | `/api/player-last-map/:steamid` | Last map played |

#### Advanced

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/top-headshots` | Top 10 by headshots |
| `GET` | `/api/top-accuracy` | Top 10 by headshot % (min. 10 kills) |
| `GET` | `/api/top-killstreak` | Top 10 by highest kill streak |

#### Maps

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/maps` | List of registered maps |
| `GET` | `/api/map/:map` | Simplified map ranking |
| `GET` | `/api/map-ranking/:map` | Detailed map ranking with deltas |

#### Live

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/live/killfeed` | Live killfeed (last 5) |
| `GET` | `/api/live/state` | Live scoreboard state |

#### Admin (RCON)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/admin/login` | Authenticate with RCON password (rate limited) |
| `POST` | `/api/admin/command` | Execute RCON command (requires session, rate limited) |
| `POST` | `/api/admin/logout` | End admin session |
| `GET` | `/api/admin/session` | Check session status |

### Snapshot System

The API polls the `csstats` table every **60 seconds**. When it detects changes (kills, deaths, hs, skill) or a map change, it saves a record to `csstats_snapshots` with a timestamp. These snapshots power:

- Weekly and monthly rankings (with delta calculation via window functions)
- Daily per-player history
- Detailed per-map rankings
- Evolution chart on the player page

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
If the `csstats` table is empty, the CS server needs to be running with the AMX Mod X stats plugin active. Data is populated when players connect and play.
