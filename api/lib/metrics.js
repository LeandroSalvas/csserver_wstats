// Métricas Prometheus: registro e definições de métricas customizadas.
// Exporta o `register`, o cliente prom-client e todos os contadores/gauges
// usados pelos serviços e rotas.

const client = require('prom-client')

client.collectDefaultMetrics({ timeout: 10000 })

const httpRequestsTotal = new client.Counter({
  name: 'cs16_http_requests_total',
  help: 'Total de requisições HTTP processadas',
  labelNames: ['method', 'path', 'status']
})

const playersOnlineGauge = new client.Gauge({
  name: 'cs16_players_online',
  help: 'Jogadores online por servidor',
  labelNames: ['server']
})

const dbUpGauge = new client.Gauge({
  name: 'cs16_db_up',
  help: 'Banco de dados acessível (1 = sim, 0 = não)'
})

const matchesTotal = new client.Counter({
  name: 'cs16_matches_total',
  help: 'Partidas registradas no banco',
  labelNames: ['server']
})

const httpRequestDuration = new client.Histogram({
  name: 'cs16_http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
})

const redisUpGauge = new client.Gauge({
  name: 'cs16_redis_up',
  help: 'Redis acessível (1 = sim, 0 = não)'
})

const dbQueryErrorsTotal = new client.Counter({
  name: 'cs16_db_query_errors_total',
  help: 'Queries SQL com erro'
})

const matchDurationHistogram = new client.Histogram({
  name: 'cs16_match_duration_seconds',
  help: 'Duração das partidas registradas',
  labelNames: ['server', 'map', 'winner'],
  buckets: [300, 600, 900, 1200, 1800, 2400, 3600, 5400, 7200]
})

const serverOnlineGauge = new client.Gauge({
  name: 'cs16_server_online',
  help: 'Servidor online (1 = sim, 0 = não)',
  labelNames: ['server']
})

const serverInfoGauge = new client.Gauge({
  name: 'cs16_server_info',
  help: 'Informações do servidor (mapa e hostname atuais)',
  labelNames: ['server', 'map', 'hostname']
})

const maxPlayersGauge = new client.Gauge({
  name: 'cs16_max_players',
  help: 'Lotação máxima do servidor',
  labelNames: ['server']
})

const roundTGauge = new client.Gauge({
  name: 'cs16_round_t',
  help: 'Rodadas vencidas pelo Terrorista (placar ao vivo)',
  labelNames: ['server']
})

const roundCTGauge = new client.Gauge({
  name: 'cs16_round_ct',
  help: 'Rodadas vencidas pela Contra-Terrorista (placar ao vivo)',
  labelNames: ['server']
})

const mapTimeGauge = new client.Gauge({
  name: 'cs16_map_time_seconds',
  help: 'Tempo decorrido no mapa atual',
  labelNames: ['server']
})

const playersRegisteredGauge = new client.Gauge({
  name: 'cs16_players_registered',
  help: 'Jogadores registrados no banco',
  labelNames: ['server']
})

const statsTotalGauge = new client.Gauge({
  name: 'cs16_stats_total',
  help: 'Totais agregados de estatísticas por servidor',
  labelNames: ['server', 'stat']
})

const accuracyGauge = new client.Gauge({
  name: 'cs16_accuracy',
  help: 'Precisão média (hits/shots) por servidor',
  labelNames: ['server']
})

const skillAvgGauge = new client.Gauge({
  name: 'cs16_skill_avg',
  help: 'Skill médio por servidor',
  labelNames: ['server']
})

const skillMaxGauge = new client.Gauge({
  name: 'cs16_skill_max',
  help: 'Skill máximo por servidor',
  labelNames: ['server']
})

const connectionTimeGauge = new client.Gauge({
  name: 'cs16_connection_time_seconds',
  help: 'Tempo total conectado (soma) por servidor',
  labelNames: ['server']
})

const activePlayersGauge = new client.Gauge({
  name: 'cs16_active_players',
  help: 'Jogadores distintos ativos no período (dias)',
  labelNames: ['server', 'period']
})

const killsGauge = new client.Gauge({
  name: 'cs16_kills_period_total',
  help: 'Kills no período (delta de snapshots) por servidor',
  labelNames: ['server', 'period']
})

const snapshotsByMapGauge = new client.Gauge({
  name: 'cs16_snapshots_total',
  help: 'Snapshots (popularidade) por servidor e mapa',
  labelNames: ['server', 'map']
})

module.exports = {
  register: client.register,
  httpRequestsTotal,
  playersOnlineGauge,
  dbUpGauge,
  matchesTotal,
  httpRequestDuration,
  redisUpGauge,
  dbQueryErrorsTotal,
  matchDurationHistogram,
  serverOnlineGauge,
  serverInfoGauge,
  maxPlayersGauge,
  roundTGauge,
  roundCTGauge,
  mapTimeGauge,
  playersRegisteredGauge,
  statsTotalGauge,
  accuracyGauge,
  skillAvgGauge,
  skillMaxGauge,
  connectionTimeGauge,
  activePlayersGauge,
  killsGauge,
  snapshotsByMapGauge
}
