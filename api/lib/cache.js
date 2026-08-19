// Cache de resultados em Redis para rotas pesadas (rankings/snapshots).
// Com degradação graciosa: sem Redis ou em erro de get/set, executa a query direto.
// O client Redis é injetado via setRedisClient (criado pelo módulo de sessão).

const { CACHE_RANKING_TTL, CACHE_STATS_TTL } = require('./config')
const { withTimeout } = require('./helpers')

let redisClient = null
const inFlightRequests = new Map()

function setRedisClient(client) {
  redisClient = client
}

function getRedisClient() {
  return redisClient
}

async function getCached(key, ttlMs, fn) {
  if (!redisClient || !redisClient.isReady) return fn()

  try {
    const cached = await withTimeout(redisClient.get(key), 2000)
    if (cached !== null) return JSON.parse(cached)
  } catch (err) {
    console.error(`Cache get falhou (${key}):`, err.message)
  }

  // Singleflight: se outra requisição já estiver recalculando a mesma chave, reusa a mesma Promise
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key)
  }

  const queryPromise = (async () => {
    try {
      const value = await fn()
      try {
        await withTimeout(redisClient.setEx(key, Math.ceil(ttlMs / 1000), JSON.stringify(value)), 2000)
      } catch (err) {
        console.error(`Cache set falhou (${key}):`, err.message)
      }
      return value
    } finally {
      inFlightRequests.delete(key)
    }
  })()

  inFlightRequests.set(key, queryPromise)
  return queryPromise
}

module.exports = {
  getCached,
  setRedisClient,
  getRedisClient,
  CACHE_RANKING_TTL,
  CACHE_STATS_TTL
}
