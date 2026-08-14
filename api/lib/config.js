// Configuração central: leitura de variáveis de ambiente e constantes.
// Módulo sem efeitos colaterais além de ler o ambiente.

const LIVE_DATA_DIR = process.env.LIVE_DATA_DIR || '/home/cs16/cstrike/addons/amxmodx/data/live'

const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:8080', 'http://192.168.15.54:8080']

// Filtro defensivo para excluir bots (PodBod/HLTV registram steamid "BOT")
// de rankings, tops, buscas e snapshots.
const NOT_BOT = "steamid NOT LIKE 'BOT%'"
const NOT_BOT_WHERE = `AND ${NOT_BOT}`

const dbConfig = {
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'csuser',
  password: process.env.DB_PASSWORD || 'cs123',
  database: process.env.DB_NAME || 'csstats'
}

const sessionSecret = process.env.SESSION_SECRET

const sessionStoreType = (process.env.SESSION_STORE || 'redis').toLowerCase()

const GAMEDIG_HOST = process.env.GAMEDIG_HOST || 'cs16'
const GAMEDIG_PORT = parseInt(process.env.GAMEDIG_PORT || '27015', 10)

const CACHE_RANKING_TTL = 60 * 1000
const CACHE_STATS_TTL = 30 * 1000

const SNAPSHOT_STALE_MS = 10 * 60 * 1000

const MAX_SSE_CLIENTS = 100

const alertWebhookUrl = process.env.ALERT_WEBHOOK_URL || ''

const steamReturnUrl = process.env.STEAM_RETURN_URL || ''
const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const steamRealm = steamReturnUrl ? new URL(steamReturnUrl).origin + '/' : ''

const googleClientId = process.env.GOOGLE_CLIENT_ID || ''
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || ''
const googleReturnUrl = process.env.GOOGLE_RETURN_URL || ''

// Controle dos containers de servidores (adapter em serverManager.js).
const serverManagerProvider = process.env.SERVER_MANAGER_PROVIDER || 'docker'
const serverRepoDir = process.env.SERVER_REPO_DIR || '/repo'

// Base pública dos espectadores (ex.: https://zueiracstrike.duckdns.org:4445).
// A API monta o spectatorUrl por servidor em tempo de execução a partir de
// config/servers.list (contexto), então o override do compose não precisa mais
// bakear o CS_SERVERS (api estática = sem recriação em add/remove).
const watchPublicBase = process.env.WATCH_PUBLIC_BASE || ''

// Seed do Superadmin local no boot (gera ADMIN_CREDENTIALS.txt no repo).
const seedAdminEnabled = process.env.SEED_ADMIN !== '0'

const metricsUser = process.env.METRICS_USER || ''
const metricsPass = process.env.METRICS_PASS || ''

module.exports = {
  LIVE_DATA_DIR,
  corsOrigins,
  NOT_BOT,
  NOT_BOT_WHERE,
  dbConfig,
  sessionSecret,
  sessionStoreType,
  GAMEDIG_HOST,
  GAMEDIG_PORT,
  CACHE_RANKING_TTL,
  CACHE_STATS_TTL,
  SNAPSHOT_STALE_MS,
  MAX_SSE_CLIENTS,
  alertWebhookUrl,
  steamReturnUrl,
  STEAM_OPENID_ENDPOINT,
  steamRealm,
  googleClientId,
  googleClientSecret,
  googleReturnUrl,
  serverManagerProvider,
  serverRepoDir,
  watchPublicBase,
  seedAdminEnabled,
  metricsUser,
  metricsPass
}
