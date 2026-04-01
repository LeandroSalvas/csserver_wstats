# CS Counter-Strike 1.6 Stats

Projeto de monitoramento e API para servidor de Counter-Strike 1.6.

## Propósito

Este repositório contém:

- um servidor de jogo `cs16` com AMX Mod X configurado
- um banco de dados MariaDB para armazenar estatísticas de jogadores
- um serviço Redis para sessão/cache interno
- uma API Node.js que expõe endpoints de estatísticas e suporta websocket
- um frontend web estático servido via Nginx

O objetivo é coletar, armazenar e exibir estatísticas de partidas de CS 1.6 em um painel web.

## Estrutura do projeto

- `docker-compose.yml` - orquestração dos serviços
- `api/` - código da API Node.js
- `web/` - frontend estático e configuração do Nginx
- `config/` - arquivos de configuração do servidor CS
- `live/` - dados de placar e killfeed em tempo real

## Requisitos

- Docker
- Docker Compose

## Configuração

1. Copie o arquivo de exemplo de ambiente:

```bash
cp .env.example .env
```

2. Abra `.env` e ajuste as variáveis conforme necessário.

Variáveis importantes:

- `MYSQL_ROOT_PASSWORD` - senha do root do MariaDB
- `MYSQL_DATABASE` - nome do banco de dados
- `MYSQL_USER` - usuário do banco
- `MYSQL_PASSWORD` - senha do usuário do banco
- `DB_HOST` - host do banco de dados (padrão `db`)
- `SESSION_SECRET` - segredo para sessões Express
- `SESSION_STORE` - armazenamento de sessão (`redis` ou `memory`)
- `REDIS_HOST` - host do Redis (padrão `redis`)
- `REDIS_PORT` - porta do Redis (padrão `6379`)
- `REDIS_PASSWORD` - senha do Redis (opcional para uso local interno)
- `REDIS_DB` - índice de banco do Redis

> Observação: no cenário atual, o Redis só é usado internamente pelo `docker-compose`, então não há necessidade de expor porta ou configurar senha, a menos que deseje maior segurança.

## Executando o ambiente

No diretório raiz do projeto:

```bash
docker compose up --build
```

Isso irá criar e iniciar os serviços:

- `cs16` - servidor de jogo
- `db` - banco de dados MariaDB
- `redis` - cache/session store
- `api` - backend Node.js
- `web` - frontend Nginx

## Acesso

### Local

- Frontend: `http://localhost:8080`
- Página de status do sistema: `http://localhost:8080/system.html` — verifica se toda a stack (API, banco, Redis, servidor CS) está funcionando
- Página de estatísticas avançadas: `http://localhost:8080/advanced.html`
- API via proxy Nginx: `http://localhost:8080/api`
- Health check da API: `http://localhost:8080/api/health`

> Observação: a API não está exposta diretamente; todas as rotas devem ser acessadas via proxy Nginx em `/api`.

### Rede local / internet

- Se a máquina hospedeira estiver em uma rede local, use o IP da máquina, por exemplo: `http://192.168.x.x:8080`
- Se houver DNS ou redirecionamento público configurado, use esse nome de domínio: `http://seu-dominio:8080`
- A rota `/api` é encaminhada pelo Nginx no `web` para o backend, então você pode acessar os endpoints da API pelo mesmo host e porta do frontend.

### Proxy Nginx

O Nginx está configurado para servir o frontend e encaminhar requisições para a API em `/api`.

- Exemplo de endpoint de API via Nginx: `http://localhost:8080/api/health`

## Rotas da API

As rotas abaixo devem ser acessadas via proxy Nginx em `/api`:

- `GET /health` - checa o estado da API
- `GET /top10` - top 10 jogadores por kills
- `GET /top-headshots` - top 10 jogadores por headshots
- `GET /top-accuracy` - top 10 jogadores por precisão de headshots
- `GET /top-killstreak` - top 10 jogadores por maior aumento de kills entre snapshots
- `GET /player/:steamid` - detalhes de um jogador
- `GET /topskill` - top 10 por skill
- `GET /topkd` - top 10 por KD
- `GET /stats` - estatísticas gerais
- `GET /maps` - lista de mapas registrados
- `GET /map/:map` - ranking de jogadores por mapa
- `GET /map-ranking/:map` - ranking detalhado por mapa
- `GET /ranking/weekly` - ranking semanal
- `GET /ranking/monthly` - ranking mensal
- `GET /player-history-daily/:steamid` - histórico diário de um jogador
- `GET /player-last-map/:steamid` - último mapa jogado por um jogador
- `GET /server` - status atual do servidor CS
- `GET /live/killfeed` - killfeed em tempo real
- `GET /live/state` - estado do placar ao vivo


## Observações

- Se quiser evitar autenticação de Redis no ambiente local, deixe `REDIS_PASSWORD` vazio em `.env`.
- Se usar `SESSION_STORE=redis`, a API tentará conectar ao Redis para manter sessões.

## Desenvolvimento

Para atualizar o código da API, edite arquivos em `api/` e reinicie o serviço `api`.

Para ajustar o frontend, edite arquivos em `web/`.
