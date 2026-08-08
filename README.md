# CS Server Stats

> Servidor de Counter-Strike 1.6 com painel de estatísticas integrado.
> Counter-Strike 1.6 server with integrated statistics dashboard.

---

## 🇧🇷 Português (BR)

### Visão geral

CS Server Stats é um projeto completo de Counter-Strike 1.6 com painel de estatísticas integrado e **suporte multi-servidor**. Cada servidor roda com AMX Mod X configurado, coleta e armazena estatísticas de partidas em tempo real, e o painel web expõe rankings, perfis de jogadores, placar ao vivo, killfeed e **espectador web (WebRTC)**. Toda a stack é orquestrada com Docker Compose: servidores de jogo, MariaDB, Redis, API Node.js, frontend Nginx, Prometheus e Grafana.

### Arquitetura

O projeto é orquestrado com Docker Compose. Os serviços base são:

| Serviço | Descrição |
|---------|-----------|
| `cs16` | Servidores de jogo Counter-Strike 1.6 com AMX Mod X e stats plugin (um container por servidor; o primário é o `main`) |
| `db` | MariaDB para armazenamento de estatísticas |
| `redis` | Cache e armazenamento de sessões |
| `api` | Backend Node.js (Express) com endpoints REST |
| `web` | Frontend estático servido via Nginx com proxy reverso para a API |
| `prometheus` | Coleta de métricas da API (`/api/metrics`) e do Nginx |
| `grafana` | Dashboards de monitoramento (porta 3001) |
| `nginx-exporter` | Expositor de métricas do Nginx (consumido pelo Prometheus) |

Além destes, há os serviços **opt-in** do espectador web (`profiles: ["watch"]`, nunca sobem com `docker compose up` simples — veja a seção [Espectador web](#espectador-web-webrtc)):

| Serviço | Descrição |
|---------|-----------|
| `watch-main` | Proxy WebRTC→UDP: serve a página do espectador e faz a ponte para o relay HLTV |
| `watch-hltv` | Relay HLTV entre o servidor de jogo (27015) e o espectador no browser |

Na implantação de produção há ainda serviços externos: **swag** (proxy TLS, porta 4445) + **duckdns** (DNS dinâmico) para expor o espectador em `https://zueiracstrike.duckdns.org:4445`.

### Funcionalidades

#### Servidor de Jogo

- Counter-Strike 1.6 pronto para rodar com AMX Mod X
- Configurações de servidor centralizadas (`server.cfg`, `users.ini`, `mapcycle.txt`, `motd.txt`)
- Suporte a bots PodBot (mínimo 2 bots, com slot reservado ao HLTV)
- Stats plugin integrado para coleta automática de dados
- Multi-servidor: vários servidores com porta, mapa, nome e arquivos live próprios (`config/servers.list` é a fonte da verdade)

#### Painel Web

- Status do servidor e estatísticas em tempo real
- Rankings de jogadores (geral, semanal, mensal e por mapa)
- Perfis individuais com gráfico de evolução de kills e histórico diário
- Estatísticas avançadas: top headshots, precisão, killstreaks, assistências, dano, TK, bomb e tempo conectado
- Placar ao vivo e killfeed em tempo real (SSE)
- Painel admin com comandos RCON e autenticação por sessão (CSRF + rate limit)
- Login Steam (OpenID) opcional para administração
- Monitoramento multi-servidor (status de vários servidores na página Sistema)
- Alertas de online/offline via webhook (Slack/Discord/Teams)
- Rastreamento de partidas (placar, vencedor e duração por mapa)
- Métricas Prometheus + dashboards Grafana
- Suporte a dois idiomas (Português/Inglês)
- Sistema de snapshots para rastrear progresso histórico
- Guia de conexão com suporte ao protocolo Steam

#### Espectador Web (WebRTC)

- Assistir o servidor primário **no navegador** via relay HLTV (cliente Xash3D WASM), sem instalar nada
- Página CSTV (`/cstv.html`) com o espectador embutido em iframe
- Auto-recuperação: watchdog de stall no cliente (rejoin + reload silencioso) e teardown de idle na bridge do proxy — a sessão sobrevive até reinícios do servidor de jogo
- Opt-in (não sobe na stack padrão), gerenciado por `./scripts/watch.sh`

### Pré-requisitos

- Docker
- Docker Compose
- Portas disponíveis:
  - **8080** (painel web)
  - **27015** (servidor primário UDP/TCP), **27016+** (demais servidores, uma porta cada)
  - **27018** (espectador: página + signaling WebSocket)
  - **27019-27050** (UDP WebRTC do espectador)
  - **4445** (HTTPS do espectador via swag, produção)
  - **3001** (Grafana) e **9090** (Prometheus, bind local)

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
| `STEAM_RETURN_URL` | *(vazio)* | URL pública de retorno do login Steam |
| `STEAM_ADMIN_IDS` | *(vazio)* | SteamID64s (separados por vírgula) autorizados a logar como admin |
| `GRAFANA_ADMIN_USER` | `admin` | Usuário admin do Grafana |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Senha admin do Grafana |

**Espectador web (opt-in):**

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `WATCH_PUBLIC_IP` | *(vazio)* | IP público anunciado como ICE candidate do WebRTC (obrigatório para acesso fora da LAN) |
| `WATCH_LISTEN_PORT` | `27018` | Porta do proxy (página do espectador + signaling WebSocket) |
| `WATCH_UDP_PORT_RANGE` | `27019-27050` | Faixa de portas UDP fixas para o ICE (abrir no firewall/NAT) |
| `WATCH_HLTV_PORT` | `27020` | Porta do relay HLTV (interno) |
| `WATCH_CONSOLE_COMMANDS` | `spec_autodirector 1` | Comandos de console executados no cliente espectador (câmera automática) |
| `WATCH_PACKAGE_ZIP` | `/valve/valve.zip` | Caminho do `valve.zip` dentro do container do proxy |

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
| `live/watch/` | Logs do relay HLTV e `last_hltv_crash.txt` (espectador) |

#### Plugins AMX Mod X (`cs/plugins/`)

Os fontes dos plugins que escrevem os arquivos live ficam versionados em `cs/plugins/` e são **compilados e montados no container do servidor** (sobrepõem os binários da imagem `leandrosalvas/cs16_stats`):

| Arquivo | Descrição |
|---------|-----------|
| `cs/plugins/live_scoreboard.sma` | Gera `live/live_scoreboard.json` (scoreboard T/CT) |
| `cs/plugins/live_killfeed.sma` | Gera `live/live_killfeed.json` (kill feed) |
| `cs/plugins/slots_reserve.sma` | Reserva um slot para o HLTV (espectador) e evita que ele tome o lugar de um jogador |
| `cs/plugins/plugins.ini` | Lista de plugins ativos do AMX Mod X |

Para alterar um plugin, edite o `.sma` e recompile:

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

O botão do espectador (página CSTV) usa `SPECTATOR_URL` no mesmo `web/common.js`:

```javascript
const SPECTATOR_URL = 'https://zueiracstrike.duckdns.org:4445/'
```

Os blocos `server_name` com domínios no `web/nginx.conf` são específicos da implantação de produção (redirecionam HTTP → HTTPS) e podem ser removidos para uso genérico/local.

#### Multi-servidor (provisionamento automático)

O projeto pode rodar vários servidores CS 1.6 ao mesmo tempo, cada um com porta, mapa, nome e arquivos live próprios. O servidor **primário** (primeira linha de `config/servers.list`) é o único usado por snapshots/rankings, pelo registro de partidas (`cs_matches`) e pelo espectador web.

**Fluxo de uso:**

```bash
# Opção A (recomendada) — assistente interativo:
# pergunta quantos servidores você quer, o nome de cada um, se deseja rotação de
# mapas (e quais mapas), gera o servers.list, cria os arquivos de config/live e sobe a stack.
./scripts/setup.sh

# Opção B (manual) — edite config/servers.list (formato: id nome porta_host mapa maxplayers rotate)
./scripts/servers.sh up
```

**Comandos do provisionador:**

| Comando | Descrição |
|---------|-----------|
| `./scripts/setup.sh` | Assistente interativo: pergunta a quantidade/nomes, rotação de mapas (e quais) e sobe a stack (flags: `--no-up`, `--yes`) |
| `./scripts/servers.sh init` | Cria `config/servers/<id>/` e `live/<id>/` a partir de `servers.list` |
| `./scripts/servers.sh compose` | Gera `docker-compose.servers.yml` (override) |
| `./scripts/servers.sh config` | Valida o compose mergeado |
| `./scripts/servers.sh up` | `init` + `compose` + `docker compose up -d --remove-orphans` (sem `--build`; builds são explícitos via `servers.sh build`) |
| `./scripts/servers.sh build` | Constrói as imagens `cs16_stats:local` e `csserver_wstats-api` |
| `./scripts/servers.sh down` | Para a stack |
| `./scripts/servers.sh ps` | Estado dos containers |
| `./scripts/servers.sh status` | Resumo dos servidores configurados |
| `./scripts/servers.sh list` | Mostra `config/servers.list` |
| `./scripts/servers.sh prune [ids]` | Apaga `config/servers/<id>` e `live/<id>` (sem ids, apaga os que saíram do `servers.list`); com `--metrics`, também remove as séries do Prometheus |
| `./scripts/servers.sh rcon <id> <cmd>` | Executa comando RCON em um servidor específico |

**Exemplo de `config/servers.list`:**

```
main Zueira 27015 de_dust2 32 yes
frag Frag 27016 de_inferno 24 yes
dm Deathmatch 27017 fy_iceworld 20 yes
awp AWP 27018 awp_map 16 yes
```

Regras e detalhes:

- A 1ª linha é o primário e deve manter o id `main`.
- `porta_host` é a porta publicada no host; dentro do container todos usam a porta interna `27015`.
- `maxplayers` = slots **visíveis** (pares: 8/16/24/32). O engine usa `visible + 1` (slot oculto reservado ao HLTV via plugin `slots_reserve`), exceto no teto de 32 (o plugin reserva o 32º slot). `pb_minbots 2` garante um piso de 2 bots.
- `rotate`: `yes` (padrão) = rotação de mapas, com a lista em `config/servers/<id>/mapcycle.txt` (o assistente pergunta quais mapas da imagem entram na rotação); `no` = o `mapcycle.txt` fica apenas com o mapa escolhido (servidor sem troca de mapa).
- Se o `mapcycle.txt` do servidor ainda não existir com `rotate=yes`, o `init` copia o `config/mapcycle.txt` compartilhado como padrão; com `rotate=no`, ele regrava o mapa único se o conteúdo mudar.
- Os `server.cfg` são gerados a partir de `config/templates/server.cfg` usando o `RCON_PASSWORD` do `.env` (uma única senha para todos os servidores).
- Cada servidor grava seus próprios arquivos live em `live/<id>/`, que a API lê por servidor (`/api/live/state?server=<id>`).
- As páginas têm um seletor de servidor (Home, Live, Rankings, Mapas, Player, Avançadas, Partidas e Painel RCON); rankings, tops, mapas e partidas são filtrados pelo servidor selecionado e comandos RCON são executados no servidor alvo.
- As métricas do Grafana são rotuladas por servidor (`cs16_players_online{server="..."}`) com uma variável de servidor no dashboard.
- O `.env` define `COMPOSE_FILE=docker-compose.yml:docker-compose.servers.yml`: depois de gerado, `docker compose ps/logs/config/up` já usam o override sem precisar de `-f` (o override é regenerado pelo `servers.sh compose`/`up` ou pelo `setup.sh`).

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
   surf Surf 27019 surf_ski_2 20 yes
   ```

   Formato: `id nome porta_host mapa maxplayers rotate` — use um `id` curto, sem espaços. Se quiser rotação customizada, crie/edite `config/servers/<id>/mapcycle.txt` com a lista de mapas (ou rode o assistente); para não rotacionar, use `no`.

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

- O `init` cria `config/servers/surf/` (server.cfg com hostname "Surf" e a senha RCON do `.env`, `users.ini`, `mapcycle.txt`, `motd.txt` e `plugins.ini`) e `live/surf/` com os JSONs vazios. O `mapcycle.txt` só é criado se não existir (ou vira só o mapa escolhido com `rotate=no`), preservando a rotação escolhida por servidor.
- O `compose` regenera `docker-compose.servers.yml` com o container `cs16surf` (porta 27019 publicada) e adiciona o servidor ao `CS_SERVERS` da API.
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
2. Atualize a stack (o `up` usa `--remove-orphans` e já destrói o container do servidor removido):

   ```bash
   ./scripts/servers.sh up
   ```

3. Se quiser apagar também os arquivos de config/live do servidor removido:

   ```bash
   ./scripts/servers.sh prune surf
   ```

> Os dados no banco (stats, snapshots e partidas) de um servidor removido são **sempre preservados**; os seletores do frontend deixam de exibi-lo automaticamente. Com `--metrics`, o `prune` também remove as séries do servidor no Prometheus (via Admin API, bind `127.0.0.1:9090`).

##### Importante

- `docker-compose.servers.yml` é **gerado automaticamente** — não edite à mão; altere `config/servers.list` e rode `./scripts/servers.sh compose`.
- As portas UDP **e** TCP do `porta_host` precisam estar livres no host.
- `config/servers/` e `live/` não são versionados (o `server.cfg` contém a senha RCON).

#### Espectador Web (WebRTC)

O espectador permite assistir o servidor **primário** (porta host `27015`) direto no navegador, sem instalar o CS 1.6. O fluxo é:

```
Browser (Xash3D WASM) ──WebRTC──▶ watch-main (proxy 27018) ──UDP──▶ watch-hltv (relay HLTV) ──▶ Servidor primário (27015)
```

O `watch-main` é o submodule `watch/webxash3d-proxy` (fork `LeandroSalvas/webxash3d-proxy` de `bordeux/webxash3d-proxy`), um proxy Rust WebRTC→UDP com cliente Xash3D WASM. As modificações locais (ack do HLTV, DTLS vendored para Chrome, auto-recuperação, etc.) estão documentadas no `watch/webxash3d-proxy/PATCHES.md`.

**Opt-in**: ambos os serviços carregam `profiles: ["watch"]`, então a stack padrão nunca os inicia. Gerencie com:

```bash
./scripts/watch.sh up|down|build|ps|status|logs|restart|backup|restore
```

| Comando | Descrição |
|---------|-----------|
| `up` | Sobe `watch-main` + `watch-hltv` (depende de `cs16` primário) |
| `down` | Derruba a stack do espectador |
| `build` | Reconstrói o cliente do espectador (necessário após mudanças no submodule) |
| `status` | Saúde dos serviços + última queda do HLTV |
| `backup`/`restore` | Copia o `valve.zip` para/de `./backups/` |

**Assets**: `valve/valve.zip` (assets proprietários do Half-Life) é **gitignored**; o `backup`/`restore` do watch.sh o preserva. O compose o monta read-only no `watch-main`.

**Portas**:

| Porta | Uso |
|-------|-----|
| `27018` TCP | Página do espectador + signaling WebSocket (`/websocket`) |
| `27019-27050` UDP | WebRTC (ICE) |
| `27020` | Relay HLTV (interno, host) |
| `4445` TCP | HTTPS do espectador (via swag, produção) |

`watch-main` usa `network_mode: host` (anuncia o IP da LAN como ICE candidate e resolve os candidatos mDNS `.local`). Em produção, o swag serve `https://zueiracstrike.duckdns.org:4445` → `http://192.168.15.54:27018`.

**Auto-recuperação** (cliente + proxy):

- Watchdog de stall no cliente: se nenhum pacote de jogo chegar em **15s**, força `rejoin()` (disconnect + connect no mesmo canal WebRTC); após **6** tentativas, recarrega a página uma única vez (guarda em `sessionStorage`). O reload é **silencioso** (o diálogo `beforeunload` foi removido).
- Teardown de idle na bridge do proxy: **25s** sem dados do upstream derruba a bridge e sinaliza o cliente a reconectar (armado a partir do primeiro pacote ou do handshake do browser).
- Reconexão automática em `close`/`error` do canal de dados.
- Com a aba oculta: shim de `requestAnimationFrame` mantém o loop do engine vivo e o backlog de `net.incoming` foi elevado para `maxPackets: 16384` — esconder a aba por pouco tempo "avança rápido" até o ao-vivo em vez de congelar; mais de 60s oculto reconecta.
- **Congelamento com a aba ativa (overflow do buffer)**: o relay produz mais rápido que o engine consome (1 pacote/frame), o buffer enchia em ~3-7 min e o descarte do pacote mais antigo quebrava a cadeia delta do HLTV (freeze permanente, watchdog quieto pois pacotes continuam chegando). Fix: watchdog de backlog que faz `rejoin()` a 80% do buffer (reseta a cadeia antes de qualquer drop) + `rejoin()` agora limpa o backlog da sessão anterior; o relay roda com `sys_ticrate 30` para a produção acompanhar o consumo.
- **Microfone**: o glue do engine pede `getUserMedia` no boot (captura de voice); stub no `index.html` rejeita a permissão — sem prompt para o espectador.
- Loading por etapas em PT-BR com barra de progresso; erros de JS/WebGL2 aparecem na tela em vez de tela preta.

**Observação operacional**: o relay HLTV pode ficar "mudo" (processo vivo e conectado ao servidor, mas sem enviar dados). A auto-recuperação acima destrava a sessão; o destravamento definitivo é reiniciar o servidor de jogo (o HLTV reconecta sozinho em ~20s). Acompanhe `live/watch/last_hltv_crash.txt` e o `watch.sh status`.

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
| CSTV | `/cstv.html` | Espectador web (WebRTC) do servidor primário |
| Painel RCON | `/admin.html` | Autenticação e execução de comandos RCON |
| Sistema | `/system.html` | Status de todos os subsistemas |

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

> O Grafana roda em `http://<host>:3001` com datasource Prometheus e dashboard CS16 provisionados automaticamente. O Prometheus coleta também o `nginx-exporter` (`:9113`) e aceita a Admin API (`127.0.0.1:9090`) usada pelo `servers.sh prune --metrics`.

#### Login Steam

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/auth/steam` | Inicia o fluxo OpenID (redireciona para o Steam) |
| `GET` | `/api/auth/steam/callback` | Callback do Steam; valida e autentica a sessão se o SteamID estiver em `STEAM_ADMIN_IDS` |
| `GET` | `/api/auth/steam/status` | Verifica se o login Steam está configurado e o SteamID da sessão |

> O login Steam usa OpenID 2.0 e **não exige Steam Web API key**. Configuração: `STEAM_RETURN_URL` (URL pública de retorno) e `STEAM_ADMIN_IDS` (lista de SteamID64 autorizados). Sem essas variáveis o botão não aparece no painel RCON.

#### Admin (RCON)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/admin/login` | Autenticar com senha RCON (com rate limit e proteção CSRF) |
| `POST` | `/api/admin/command` | Executar comando RCON (requer sessão e token CSRF, com rate limit) |
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
./scripts/watch.sh status      # saúde dos serviços + última queda do HLTV
docker compose logs watch-main watch-hltv
```
O cliente se auto-recupera (rejoin + reload silencioso). Se o relay HLTV ficou "mudo", reinicie o servidor de jogo (`docker compose restart cs16`) — o HLTV reconecta sozinho em ~20s. Verifique também `live/watch/last_hltv_crash.txt`.

**Login admin bloqueado (429):** o `smoke-test.sh` compartilha a janela de rate limit de login (60s) com o host. Aguarde o intervalo e tente novamente.

---

## 🇺🇸 English (US)

### Overview

CS Server Stats is a complete Counter-Strike 1.6 project with an integrated statistics dashboard and **multi-server support**. Each server runs with AMX Mod X configured, collects and stores real-time match statistics, and the web panel exposes rankings, player profiles, live scoreboard, killfeed, and a **web spectator (WebRTC)**. The entire stack is orchestrated with Docker Compose: game servers, MariaDB, Redis, Node.js API, Nginx frontend, Prometheus, and Grafana.

### Architecture

The project is orchestrated with Docker Compose. The base services are:

| Service | Description |
|---------|-------------|
| `cs16` | Counter-Strike 1.6 game servers with AMX Mod X and stats plugin (one container per server; the primary is `main`) |
| `db` | MariaDB for stats storage |
| `redis` | Cache and session store |
| `api` | Node.js (Express) backend with REST endpoints |
| `web` | Static frontend served via Nginx with reverse proxy to the API |
| `prometheus` | API metrics collection (`/api/metrics`) and Nginx metrics |
| `grafana` | Monitoring dashboards (port 3001) |
| `nginx-exporter` | Nginx metrics exporter (scraped by Prometheus) |

On top of these, there are **opt-in** spectator services (`profiles: ["watch"]`, never started by plain `docker compose up` — see the [Web Spectator](#web-spectator-webrtc) section):

| Service | Description |
|---------|-------------|
| `watch-main` | WebRTC→UDP proxy: serves the spectator page and bridges to the HLTV relay |
| `watch-hltv` | HLTV relay between the game server (27015) and the browser spectator |

The production deployment also has external services: **swag** (TLS proxy, port 4445) + **duckdns** (dynamic DNS) to expose the spectator at `https://zueiracstrike.duckdns.org:4445`.

### Features

#### Game Server

- Counter-Strike 1.6 ready to run with AMX Mod X
- Centralized server configuration (`server.cfg`, `users.ini`, `mapcycle.txt`, `motd.txt`)
- PodBot bot support (2-bot floor, with a reserved slot for HLTV)
- Integrated stats plugin for automatic data collection
- Multi-server: multiple servers, each with its own port, map, name, and live files (`config/servers.list` is the source of truth)

#### Web Panel

- Real-time server status and player statistics
- Player rankings (overall, weekly, monthly, and per-map)
- Individual player profiles with kill evolution chart and daily history
- Advanced stats: top headshots, accuracy, killstreaks, assists, damage, team kills, bomb, and connected time
- Live scoreboard and killfeed (SSE)
- Admin panel with RCON commands and session-based authentication (CSRF + rate limit)
- Optional Steam login (OpenID) for administration
- Multi-server monitoring (status of several servers on the System page)
- Online/offline alerts via webhook (Slack/Discord/Teams)
- Match tracking (score, winner, and duration per map)
- Prometheus metrics + Grafana dashboards
- Bilingual support (Portuguese/English)
- Snapshot system for tracking historical progression
- Connection guide with Steam protocol support

#### Web Spectator (WebRTC)

- Watch the primary server **in the browser** via an HLTV relay (Xash3D WASM client), with no installation
- CSTV page (`/cstv.html`) with the spectator embedded in an iframe
- Self-healing: client stall watchdog (rejoin + silent reload) and proxy bridge idle teardown — the session survives even game-server restarts
- Opt-in (not part of the default stack), managed by `./scripts/watch.sh`

### Prerequisites

- Docker
- Docker Compose
- Available ports:
  - **8080** (web panel)
  - **27015** (primary server UDP/TCP), **27016+** (extra servers, one port each)
  - **27018** (spectator: page + signaling WebSocket)
  - **27019-27050** (spectator WebRTC UDP)
  - **4445** (spectator HTTPS via swag, production)
  - **3001** (Grafana) and **9090** (Prometheus, local bind)

### Quick Start

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
| `STEAM_RETURN_URL` | *(empty)* | Public Steam login return URL |
| `STEAM_ADMIN_IDS` | *(empty)* | Authorized SteamID64s (comma-separated) for admin login |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin user |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Grafana admin password |

**Web spectator (opt-in):**

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCH_PUBLIC_IP` | *(empty)* | Public IP announced as a WebRTC ICE candidate (required for access outside the LAN) |
| `WATCH_LISTEN_PORT` | `27018` | Proxy port (spectator page + signaling WebSocket) |
| `WATCH_UDP_PORT_RANGE` | `27019-27050` | Fixed UDP port range for ICE (open in firewall/NAT) |
| `WATCH_HLTV_PORT` | `27020` | HLTV relay port (internal) |
| `WATCH_CONSOLE_COMMANDS` | `spec_autodirector 1` | Console commands executed on the spectator client (auto camera) |
| `WATCH_PACKAGE_ZIP` | `/valve/valve.zip` | Path to `valve.zip` inside the proxy container |

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
| `live/watch/` | HLTV relay logs and `last_hltv_crash.txt` (spectator) |

#### AMX Mod X plugins (`cs/plugins/`)

The sources of the plugins that write the live files are versioned in `cs/plugins/` and are **compiled and mounted into the game server container** (overriding the binaries shipped in the `leandrosalvas/cs16_stats` image):

| File | Description |
|------|-------------|
| `cs/plugins/live_scoreboard.sma` | Generates `live/live_scoreboard.json` (T/CT scoreboard) |
| `cs/plugins/live_killfeed.sma` | Generates `live/live_killfeed.json` (kill feed) |
| `cs/plugins/slots_reserve.sma` | Reserves a slot for HLTV (spectator) so it never takes a player's place |
| `cs/plugins/plugins.ini` | Active AMX Mod X plugin list |

To change a plugin, edit the `.sma` and recompile:

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

The `server_name` blocks with domains in `web/nginx.conf` are specific to the production deployment (HTTP → HTTPS redirect) and can be removed for generic/local use.

#### Multi-server (automated provisioning)

The project can run multiple CS 1.6 servers at the same time, each with its own port, map, name, and live files. The **primary** server (first line of `config/servers.list`) is the only one used by snapshots/rankings, match tracking (`cs_matches`), and the web spectator.

**Usage flow:**

```bash
# Option A (recommended) — interactive wizard:
# asks how many servers you want, the name of each one, whether to rotate maps
# (and which maps), writes servers.list, creates the config/live files, and starts the stack.
./scripts/setup.sh

# Option B (manual) — edit config/servers.list (format: id name host_port map maxplayers rotate)
./scripts/servers.sh up
```

**Provisioner commands:**

| Command | Description |
|---------|-------------|
| `./scripts/setup.sh` | Interactive wizard: asks count/names, map rotation (and which maps) and starts the stack (flags: `--no-up`, `--yes`) |
| `./scripts/servers.sh init` | Creates `config/servers/<id>/` and `live/<id>/` from `servers.list` |
| `./scripts/servers.sh compose` | Generates `docker-compose.servers.yml` (override) |
| `./scripts/servers.sh config` | Validates the merged compose |
| `./scripts/servers.sh up` | `init` + `compose` + `docker compose up -d --remove-orphans` (no `--build`; builds are explicit via `servers.sh build`) |
| `./scripts/servers.sh build` | Builds the `cs16_stats:local` and `csserver_wstats-api` images |
| `./scripts/servers.sh down` | Stops the stack |
| `./scripts/servers.sh ps` | Container state |
| `./scripts/servers.sh status` | Summary of configured servers |
| `./scripts/servers.sh list` | Shows `config/servers.list` |
| `./scripts/servers.sh prune [ids]` | Deletes `config/servers/<id>` and `live/<id>` (with no ids, deletes those no longer in `servers.list`); with `--metrics`, also removes the server's Prometheus series |
| `./scripts/servers.sh rcon <id> <cmd>` | Runs an RCON command on a specific server |

**Example `config/servers.list`:**

```
main Zueira 27015 de_dust2 32 yes
frag Frag 27016 de_inferno 24 yes
dm Deathmatch 27017 fy_iceworld 20 yes
awp AWP 27018 awp_map 16 yes
```

Rules and details:

- The 1st line is the primary and must keep the id `main`.
- `host_port` is the host-published port; inside the container all servers use the internal port `27015`.
- `maxplayers` = **visible** slots (even: 8/16/24/32). The engine uses `visible + 1` (hidden slot reserved for HLTV via the `slots_reserve` plugin), except at the 32 cap (the plugin reserves the 32nd slot). `pb_minbots 2` keeps a 2-bot floor.
- `rotate`: `yes` (default) = map rotation, with the list in `config/servers/<id>/mapcycle.txt` (the wizard asks which maps from the image go into the rotation); `no` = the `mapcycle.txt` holds only the chosen map (no map changes).
- If the server's `mapcycle.txt` does not exist yet with `rotate=yes`, `init` copies the shared `config/mapcycle.txt` as the default; with `rotate=no` it rewrites the single map when the content changes.
- `server.cfg` files are generated from `config/templates/server.cfg` using the `RCON_PASSWORD` from `.env` (a single password for all servers).
- Each server writes its own live files in `live/<id>/`, which the API reads per server (`/api/live/state?server=<id>`).
- All pages have a server selector (Home, Live, Rankings, Maps, Player, Advanced, Matches, and RCON Panel); rankings, tops, maps, and matches are filtered by the selected server and RCON commands run against the target server.
- Grafana metrics are labeled per server (`cs16_players_online{server="..."}`) with a server variable in the dashboard.
- The `.env` sets `COMPOSE_FILE=docker-compose.yml:docker-compose.servers.yml`: after generation, plain `docker compose ps/logs/config/up` use the override without needing `-f` (the override is regenerated by `servers.sh compose`/`up` or `setup.sh`).

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
   surf Surf 27019 surf_ski_2 20 yes
   ```

   Format: `id name host_port map maxplayers rotate` — use a short `id`, with no spaces. For a custom rotation, create/edit `config/servers/<id>/mapcycle.txt` with the map list (or run the wizard); use `no` to disable rotation.

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

- `init` creates `config/servers/surf/` (server.cfg with hostname "Surf" and the RCON password from `.env`, `users.ini`, `mapcycle.txt`, `motd.txt`, and `plugins.ini`) and `live/surf/` with empty JSON files. The `mapcycle.txt` is only created if missing (or becomes the single chosen map with `rotate=no`), preserving the per-server rotation.
- `compose` regenerates `docker-compose.servers.yml` with the `cs16surf` container (port 27019 published) and adds the server to the API `CS_SERVERS`.
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
2. Refresh the stack (`up` uses `--remove-orphans` and already destroys the removed server's container):

   ```bash
   ./scripts/servers.sh up
   ```

3. If you also want to delete the removed server's config/live files:

   ```bash
   ./scripts/servers.sh prune surf
   ```

> Database data (stats, snapshots, and matches) of a removed server is **always preserved**; the frontend selectors stop showing it automatically. With `--metrics`, `prune` also removes the server's series from Prometheus (via the Admin API, bound to `127.0.0.1:9090`).

##### Important

- `docker-compose.servers.yml` is **auto-generated** — do not edit it by hand; change `config/servers.list` and run `./scripts/servers.sh compose`.
- The UDP **and** TCP `host_port` ports must be free on the host.
- `config/servers/` and `live/` are not versioned (the `server.cfg` contains the RCON password).

#### Web Spectator (WebRTC)

The spectator lets you watch the **primary** server (host port `27015`) directly in the browser, without installing CS 1.6. The flow is:

```
Browser (Xash3D WASM) ──WebRTC──▶ watch-main (proxy 27018) ──UDP──▶ watch-hltv (HLTV relay) ──▶ Primary server (27015)
```

`watch-main` is the `watch/webxash3d-proxy` submodule (fork `LeandroSalvas/webxash3d-proxy` of `bordeux/webxash3d-proxy`), a Rust WebRTC→UDP proxy with an Xash3D WASM client. Local modifications (HLTV connect-ack rewrite, vendored DTLS for Chrome, self-healing, etc.) are documented in `watch/webxash3d-proxy/PATCHES.md`.

**Opt-in**: both services carry `profiles: ["watch"]`, so the default stack never starts them. Manage with:

```bash
./scripts/watch.sh up|down|build|ps|status|logs|restart|backup|restore
```

| Command | Description |
|---------|-------------|
| `up` | Starts `watch-main` + `watch-hltv` (depends on primary `cs16`) |
| `down` | Stops the spectator stack |
| `build` | Rebuilds the spectator client (required after submodule changes) |
| `status` | Service health + last HLTV crash |
| `backup`/`restore` | Copies `valve.zip` to/from `./backups/` |

**Assets**: `valve/valve.zip` (proprietary Half-Life assets) is **gitignored**; `watch.sh backup`/`restore` preserves it. The compose mounts it read-only into `watch-main`.

**Ports:**

| Port | Usage |
|------|-------|
| `27018` TCP | Spectator page + signaling WebSocket (`/websocket`) |
| `27019-27050` UDP | WebRTC (ICE) |
| `27020` | HLTV relay (internal, host) |
| `4445` TCP | Spectator HTTPS (via swag, production) |

`watch-main` uses `network_mode: host` (announces the LAN IP as an ICE candidate and resolves the browser's mDNS `.local` candidates). In production, swag serves `https://zueiracstrike.duckdns.org:4445` → `http://192.168.15.54:27018`.

**Self-healing** (client + proxy):

- Client stall watchdog: if no game packet arrives for **15s**, it forces `rejoin()` (disconnect + connect on the same WebRTC channel); after **6** attempts it reloads the page once (guarded by `sessionStorage`). The reload is **silent** (the `beforeunload` dialog was removed).
- Proxy bridge idle teardown: **25s** without upstream data tears the bridge down and signals the client to reconnect (armed after the first packet or the browser handshake).
- Automatic reconnect on data-channel `close`/`error`.
- Hidden tab: a `requestAnimationFrame` shim keeps the engine loop alive and the `net.incoming` backlog is raised to `maxPackets: 16384` — short hides fast-forward to live instead of freezing; hides over 60s reconnect.
- **Active-tab freeze (buffer overflow)**: the relay produces faster than the engine consumes (1 packet/frame via `recvfrom`); the buffer filled in ~3-7min and dropping the oldest packet broke the HLTV delta chain again (permanent freeze, stall watchdog quiet because packets kept arriving). Fixed with a backlog high-watermark watchdog (`rejoin()` at 80% full) + `rejoin()` flushing the old session's backlog (`netClear()`); the relay runs `sys_ticrate 30` so production matches consumption.
- **Microphone**: the engine glue requests `getUserMedia` at boot (voice capture); a stub in `index.html` rejects it — no permission prompt for spectators.
- Staged PT-BR loading screen with a progress bar; JS/WebGL2 errors surface on screen instead of a black screen.

**Operational note**: the HLTV relay can go "silent" (process alive and connected to the server, but not sending data). The self-healing above unlocks the session; the definitive fix is restarting the game server (HLTV reconnects on its own in ~20s). Monitor `live/watch/last_hltv_crash.txt` and `watch.sh status`.

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
| CSTV | `/cstv.html` | Web spectator (WebRTC) of the primary server |
| RCON Panel | `/admin.html` | RCON authentication and command execution |
| System | `/system.html` | Status of all subsystems |

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

> Grafana runs at `http://<host>:3001` with a provisioned Prometheus datasource and CS16 dashboard. Prometheus also scrapes `nginx-exporter` (`:9113`) and exposes the Admin API (`127.0.0.1:9090`) used by `servers.sh prune --metrics`.

#### Steam Login

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/auth/steam` | Starts the OpenID flow (redirects to Steam) |
| `GET` | `/api/auth/steam/callback` | Steam callback; validates and authenticates the session if the SteamID is in `STEAM_ADMIN_IDS` |
| `GET` | `/api/auth/steam/status` | Checks whether Steam login is configured and the session SteamID |

> Steam login uses OpenID 2.0 and does **not require a Steam Web API key**. Setup: `STEAM_RETURN_URL` (public return URL) and `STEAM_ADMIN_IDS` (authorized SteamID64 list). Without these variables the button does not appear in the RCON panel.

#### Admin (RCON)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/admin/login` | Authenticate with RCON password (rate limited, CSRF protected) |
| `POST` | `/api/admin/command` | Execute RCON command (requires session + CSRF token, rate limited) |
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
./scripts/watch.sh status      # service health + last HLTV crash
docker compose logs watch-main watch-hltv
```
The client self-heals (rejoin + silent reload). If the HLTV relay went silent, restart the game server (`docker compose restart cs16`) — HLTV reconnects on its own in ~20s. Also check `live/watch/last_hltv_crash.txt`.

**Admin login blocked (429):** the `smoke-test.sh` shares the login rate-limit window (60s) with the host. Wait for the interval and retry.
