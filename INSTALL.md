# Instalação do CS Server Stats

Guia completo para subir a stack do zero. Ao final, você terá servidores de CS 1.6 rodando, painel web com stats, alertas,monitoramento e (opcionalmente) HTTPS + espectadores web.

---

## Pré-requisitos

### Sistema operacional

- **Linux** (Ubuntu 22.04+, Debian 12+, ou equivalente)
- Acesso `sudo` ou root

### Docker

- **Docker Engine** 24+ com suporte a `network_mode: host` e `privileged`
- **Docker Compose** v2 plugin (`docker compose` versão 2.29+)

```bash
# Verificar versões
docker --version        # Docker 24+
docker compose version  # Compose v2
```

### Espaço em disco

| Componente | Espaço aproximado |
|-----------|-------------------|
| Imagens Docker (cs16, api, web, cadvisor, etc.) | ~2 GB |
| `db_data` (MariaDB) | ~100 MB (cresce com o tempo) |
| `valve.zip` (assets do espectador) | ~449 MB |
| Prometheus (30 dias de métricas) | ~500 MB |
| Grafana + dashboards | ~50 MB |
| **Total mínimo recomendado** | **5 GB livres** |

### Portas

As seguintes portas precisam estar livres no host:

| Porta | Protocolo | Serviço | Público? |
|-------|-----------|---------|----------|
| `8080` | TCP | Frontend (Nginx) | Interno (swag proxy) |
| `27015` | UDP+TCP | CS 1.6 primário (`main`) | Sim (jogadores) |
| `27016`–`27018` | UDP+TCP | CS 1.6 adicionais | Sim (jogadores) |
| `3001` | TCP | Grafana | Interno |
| `8000` | TCP | swag HTTP (redirect) | Sim (redireciona p/ HTTPS) |
| `4443` | TCP | swag HTTPS (site principal) | Sim |
| `4445` | TCP | swag HTTPS (espectadores) | Sim |

> **Nota:** As portas de espectador (`27100+` UDP, `27200+` TCP, `27300+` UDP) ficam no `network_mode: host` e são acessadas internamente pelo swag — **não precisam de forward no roteador**.

### Recursos de hardware

- **CPU:** 2+ cores (cada servidor de CS consome ~1 core em partida cheia)
- **RAM:** 4 GB mínimo, 8 GB recomendado (MariaDB + Redis + API + N servidores)
- **Rede:** Conexão estável (para jogadores e espectadores)

---

## Passo 1 — Clonar o repositório

```bash
git clone <url-do-repositorio> csserver_wstats
cd csserver_wstats
```

---

## Passo 2 — Configurar variáveis de ambiente

Copie o template e edite com seus valores:

```bash
cp .env.example .env
nano .env
```

### Variáveis obrigatórias

Essas **precisam** ser alteradas para algo seguro:

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `MYSQL_ROOT_PASSWORD` | Senha root do MariaDB | `MinhaS3nh@Fort3` |
| `MYSQL_DATABASE` | Nome do banco de dados | `csstats` (padrão já serve) |
| `MYSQL_USER` | Usuário do banco | `csuser` (padrão já serve) |
| `MYSQL_PASSWORD` | Senha do usuário do banco | `OutraS3nh@Segura` |
| `SESSION_SECRET` | Chave de assinatura de sessões (string longa e aleatória) | `g8k3j5h2f9d7s1a4...` |
| `RCON_PASSWORD` | Senha RCON dos servidores (aplicada em todos) | `cqz1xr4u` |

Para gerar um `SESSION_SECRET` seguro:

```bash
openssl rand -hex 32
```

### Variáveis recomendadas

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `COMPOSE_FILE` | Arquivos compose carregados automaticamente | `docker-compose.yml:docker-compose.servers.yml:docker-compose.duckdns.yml` |
| `DUCKDNS_TOKEN` | Token do DuckDNS para HTTPS (ver seção HTTPS abaixo) | (vazio) |
| `GRAFANA_ADMIN_USER` | Usuário admin do Grafana (só no primeiro boot) | `admin` |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin do Grafana (só no primeiro boot) | `admin` |

### Variáveis opcionais

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `ALERT_WEBHOOK_URL` | Webhook Discord para alertas | (vazio — desabilitado) |
| `DISCORD_BOT_TOKEN` | Token do bot Discord | (vazio — desabilitado) |
| `METRICS_USER` / `METRICS_PASS` | Basic Auth para métricas Prometheus | (vazio — sem auth) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login Google OAuth2 | (vazio) |
| `STEAM_RETURN_URL` | Callback URL do login Steam | (vazio) |

> **Dica:** Não configure Discord/Steam/Google agora. A stack funciona 100% sem eles. Adicione depois que tudo estiver rodando.

---

## Passo 3 — Configurar servidores de jogo

### Opção A: Assistente interativo (recomendado)

```bash
./scripts/setup.sh
```

O assistente pergunta:
1. Quantos servidores você quer
2. Nome de cada um
3. Se quer rotação de mapas (e quais mapas)
4. Porta, mapa inicial e slots

Ele gera o `config/servers.list` e toda a config automaticamente.

### Opção B: Edição manual

Edite `config/servers.list` — cada linha é um servidor:

```
# Formato: id name host_port map maxplayers rotate context mode cstv
main Zueira 27015 de_dust2 30 yes zueira standard yes
```

| Coluna | Descrição | Valores |
|--------|-----------|---------|
| `id` | Identificador (sem espaços) | `main`, `gungame`, `zombies` |
| `name` | Nome exibido | `Zueira`, `GunGame` |
| `host_port` | Porta no host | `27015`, `27016`, `27017` |
| `map` | Mapa inicial | `de_dust2`, `fy_iceworld` |
| `maxplayers` | Slots visíveis (par, 2–30) | `30`, `16`, `8` |
| `rotate` | Rotação de mapas | `yes` ou `no` |
| `context` | Slug do espectador web | `zueira`, `gungame` |
| `mode` | Modo de jogo | `standard`, `zombies`, `csdm`, `surf`, `gungame` |
| `cstv` | Espectador web habilitado | `yes` ou `no` |

> **Regras importantes:**
> - A primeira linha **sempre** deve ser o `main`
> - `maxplayers` = slots visíveis (o engine usa `visible + 1` para o HLTV)
> - `cstv=no` para modo `zombies` (restrição técnica)
> - Modos `zombies`, `csdm`, `surf`, `gungame` precisam dos plugins específicos (já incluídos na imagem)

---

## Passo 4 — Construir e subir a stack

### Primeira execução

```bash
# Build das imagens + start completo
./scripts/setup.sh
# OU manualmente:
./scripts/servers.sh build
./scripts/servers.sh up
```

O `setup.sh` faz tudo: gera configs, builda imagens e sobe a stack.

### Sequência de startup (automática via Compose)

```
db + redis (healthcheck OK)
  → api (espera db + redis saudáveis)
    → web (nginx, depende da api)
      → prometheus (depende da api)
        → grafana (depende do prometheus)
  → cs16(s) (depende do db)
  → swag + duckdns (independentes, precisam do DUCKDNS_TOKEN)
  → cadvisor, node-exporter, nginx-exporter (independentes)
```

### Subsequentes

```bash
# Após editar config/servers.list:
./scripts/servers.sh up

# Ou diretamente com docker compose:
docker compose up -d
```

---

## Passo 5 — Verificar e acessar

### Verificar containers

```bash
docker compose ps
```

Todos os serviços devem estar `Up` (ou `Up (healthy)` para `db`, `redis`, `api`).

### Acessar o painel web

- **URL:** `http://<IP_DO_HOST>:8080`
- **Login:** veja o arquivo `ADMIN_CREDENTIALS.txt` gerado no primeiro boot

```bash
cat ADMIN_CREDENTIALS.txt
```

O arquivo contém:
```
username: admin
password: <senha_gerada_aleatoriamente>
```

> **Importante:** a senha é gerada uma única vez no primeiro boot. Anote-a. O arquivo é gitignored.

### Verificar servidores de jogo

```bash
# Status via API
curl -s http://localhost:8080/api/servers | jq .

# Status via servers.sh
./scripts/servers.sh status

# RCON
./scripts/servers.sh rcon main status
```

### Verificar métricas

- **Grafana:** `http://<IP_DO_HOST>:3001` (credenciais do `.env`, default admin/admin)
- **Prometheus:** `http://127.0.0.1:9090` (apenas local)

---

## Opcional: HTTPS com TLS/DDNS

Para acessar o site via `https://zueiracstrike.duckdns.org:4443`:

1. **Criar conta no DuckDNS:** https://duckdns.org
2. **Criar um subdomínio** (ex.: `zueiracstrike`)
3. **Obter o token** na página do subdomínio
4. **Configurar no `.env`:**
   ```bash
   DUCKDNS_TOKEN=seu_token_aqui
   WATCH_PUBLIC_BASE=https://zueiracstrike.duckdns.org:4445
   ```
5. **Reiniciar o swag:**
   ```bash
   docker compose restart swag duckdns
   ```

O swag obtém um certificado Let's Encrypt via DNS-01 (sem precisar de porta 80 pública para o desafio). O duckdns atualiza seu IP público automaticamente.

**Backup dos certificados:**

```bash
./duckdns/backup.sh    # salva em duckdns/backups/
./duckdns/backup.sh --restore  # restaura de backups/
```

---

## Opcional: Espectador web (CSTV)

O espectador permite assistir servidores direto no navegador via WebRTC.

### Requisitos

1. **`valve.zip`** — assets proprietários do Half-Life/CS 1.6. Copie de uma instalação existente:
   ```bash
   mkdir -p valve
   cp /caminho/para/valve.zip valve/
   ```
2. **`cstv=yes`** no `servers.list` para os servidores desejados
3. **HTTPS habilitado** (swag + duckdns) — os espectadores servem em `https://...:4445/<context>/`

### Subir o espectador

```bash
./scripts/watch.sh up
```

### Gerenciar

```bash
./scripts/watch.sh ps       # listar containers
./scripts/watch.sh status   # health + último crash do HLTV
./scripts/watch.sh logs     # logs
./scripts/watch.sh down     # derrubar apenas o espectador
./scripts/watch.sh restart  # reiniciar
```

### Backup/restore do valve.zip

```bash
./scripts/watch.sh backup   # copia valve.zip para backups/
./scripts/watch.sh restore  # restaura de backups/
```

---

## Opcional: Bot Discord

O bot gerencia a stack por comandos de texto no Discord.

### Configuração

1. **Criar application:** https://discord.com/developers/applications → New Application → Bot
2. **Copiar o token** e colar no `.env`:
   ```bash
   DISCORD_BOT_TOKEN=seu_token_aqui
   ```
3. **Ativar intent MESSAGE CONTENT:** Bot → Privileged Gateway Intents → MESSAGE CONTENT Intent → On
4. **Convidar o bot:** OAuth2 → URL Generator → bot → `Send Messages`, `Read Message History` → copiar URL e abrir no navegador
5. **Configurar permissões** (no `.env`):
   ```bash
   # Por role:
   DISCORD_ALLOWED_ROLE_IDS=123456789,987654321
   # Ou por usuário:
   DISCORD_ALLOWED_USER_IDS=111222333
   ```

### Comandos disponíveis

| Comando | Descrição |
|---------|-----------|
| `!status` | Status geral da stack |
| `!servidores` | Lista de servidores |
| `!start <id>` | Iniciar um servidor |
| `!stop <id>` | Parar um servidor |
| `!restart <id>` | Reiniciar um servidor |
| `!rcon <id> <cmd>` | Executar comando RCON |
| `!changelevel <id> <mapa>` | Trocar mapa |
| `!player <nome>` | Buscar jogador |
| `!logs <id> [n]` | Últimas N linhas de log |
| `!ajuda` | Lista de comandos |

---

## Opcional: Login social (Steam/Google)

### Steam OpenID

1. Criar application em https://steamcommunity.com/dev/apikey
2. Configurar no `.env`:
   ```bash
   STEAM_RETURN_URL=https://seudominio:4443/api/auth/steam/callback
   ```

### Google OAuth2

1. Criar projeto em https://console.cloud.google.com/apis/credentials
2. Criar OAuth 2.0 Client ID (Web Application)
3. Adicionar Authorized redirect URI: `https://seudominio:4443/api/auth/google/callback`
4. Configurar no `.env`:
   ```bash
   GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxx
   GOOGLE_RETURN_URL=https://seudominio:4443/api/auth/google/callback
   ```

> **Nota:** O primeiro login social sempre nasce como `pending`. O superadmin precisa aprovar em `/usuarios`.

---

## Opcional: Métricas e monitoramento

### Proteger endpoints de métricas

Edite o `.env`:

```bash
METRICS_USER=meu_usuario
METRICS_PASS=minha_senha_simples
```

> **Importante:** use apenas caracteres alfanuméricos (sem `/ & \`). Reinicie a API após alterar:
> ```bash
> docker compose restart api prometheus
> ```

### Acessar Grafana

- URL: `http://<IP_DO_HOST>:3001`
- Login: `admin` / (senha definida no `.env`, padrão `admin`)
- Dashboards pré-configurados:
  - **cs16-game** — stats do jogo (jogadores, kills, etc.)
  - **cs16-infra** — infraestrutura (CPU, memória, rede, latência)

> **Nota:** a senha do Grafana só é aplicada no primeiro boot. Para alterar depois, use a interface do Grafana.

---

## Operações comuns

### Adicionar um servidor

```bash
# Interativo:
./scripts/setup.sh

# Ou manualmente:
# 1. Adicionar linha em config/servers.list
# 2. Gerar configs e compose:
./scripts/servers.sh init
./scripts/servers.sh compose
# 3. Subir:
./scripts/servers.sh up
```

### Remover um servidor

```bash
# 1. Remover linha de config/servers.list
# 2. Atualizar stack:
./scripts/servers.sh up
# 3. Remover container e configs:
./scripts/servers.sh prune <id>
```

### Atualizar o código

```bash
git pull
# Reconstruir imagens e reiniciar:
./scripts/servers.sh build
./scripts/servers.sh up
```

### Ver logs

```bash
# Todos os serviços:
docker compose logs -f

# Serviço específico:
docker compose logs -f api
docker compose logs -f cs16

# Espectador:
./scripts/watch.sh logs

# Últimas 100 linhas da API:
./scripts/servers.sh logs api 100
```

### Backup do banco de dados

```bash
docker compose exec db mariadb-dump -u root -p<senha> csstats > backup_$(date +%Y%m%d).sql
```

### Restaurar banco de dados

```bash
cat backup_20260101.sql | docker compose exec -T db mariadb -u root -p<senha> csstats
```

---

## Solução de problemas

### API não sobe (erro de conexão com DB)

```
Error: connect ECONNREFUSED db:3306
```

**Causa:** MariaDB ainda não está pronto. A API espera o healthcheck do DB (timeout 30s).

**Solução:**
```bash
docker compose restart api
# Ou esperar e verificar:
docker compose logs db | tail -5
```

### Servidor de jogo não aparece no painel

```
servers: 0/0
```

**Causas possíveis:**
1. O `config/servers.list` não foi gerado → rode `./scripts/servers.sh init`
2. Porta já em uso → verifique com `ss -lntp | grep 27015`
3. Imagem `cs16_stats:local` não existe → rode `./scripts/servers.sh build`

### Web espectador mostra "Not Found"

**Causa:** Containers do espectador não estão rodando.

```bash
./scripts/watch.sh status
./scripts/watch.sh up
```

### Erro de permissão em arquivos

```
Permission denied: .../config/servers/...
```

**Causa:** Arquivos criados por containers (root) ficam com owner root.

```bash
sudo chown -R $(id -u):$(id -g) config/ live/
```

### Grafana não mostra dados

**Causas:**
1. Prometheus não está scrapando → `http://127.0.0.1:9090/targets` (verificar status)
2. Métricas protegidas mas senha errada → verifique `METRICS_USER/PASS` no `.env`
3. Dashboard não provisionado → verifique `Grafana → Dashboards → Browse`

### Containers do espectador ficam restartando

```bash
./scripts/watch.sh logs watch-hltv-main
```

**Causa comum:** `valve.zip` não encontrado. Verifique se o arquivo existe em `valve/valve.zip`.

### swag não obtém certificado

**Causas:**
1. `DUCKDNS_TOKEN` não configurado → verifique o `.env`
2. Subdomínio não apontando para seu IP → verifique em https://duckdns.org
3. Cota do Let's Encrypt atingida → verifique `docker compose logs swag | grep -i error`

### RCON não funciona

```
Bad rcon_password
```

**Causa:** `RCON_PASSWORD` no `.env` não bate com o `rcon_password` no `server.cfg`.

```bash
# Verificar senha no server.cfg:
cat config/servers/main/server.cfg | grep rcon_password

# Regenerar todos os configs:
./scripts/servers.sh init
docker compose restart cs16
```

---

## Referências rápidas

| Comando | O que faz |
|---------|-----------|
| `./scripts/setup.sh` | Assistente interativo completo |
| `./scripts/servers.sh build` | Constroi imagens Docker |
| `./scripts/servers.sh up` | Gera configs + sobe a stack |
| `./scripts/servers.sh status` | Mostra status de todos os servidores |
| `./scripts/servers.sh init` | Gera configs dos servidores (sem subir) |
| `./scripts/servers.sh compose` | Gera os arquivos compose override |
| `./scripts/servers.sh rcon <id> <cmd>` | Executa comando RCON |
| `./scripts/servers.sh prune [ids]` | Remove container/configs de servidores |
| `./scripts/watch.sh up` | Sobe o espectador web |
| `./scripts/watch.sh status` | Status do espectador |
| `docker compose ps` | Lista containers |
| `docker compose logs -f <svc>` | Logs em tempo real |
| `docker compose restart <svc>` | Reinicia um serviço |
