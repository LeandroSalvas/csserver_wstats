// Agregador central: re-exporta todos os módulos do domínio para que os
// arquivos de rotas importem de um único lugar (evita ciclos).

const config = require('./config')
const metrics = require('./metrics')
const db = require('./db')
const cache = require('./cache')
const helpers = require('./helpers')
const security = require('./security')
const serverCtx = require('./serverCtx')
const live = require('./live')
const auth = require('./auth')
const serverManager = require('./serverManager')
const alerts = require('./alerts')

const modules = [config, metrics, db, cache, helpers, security, serverCtx, live, auth, serverManager, alerts]
const seen = new Set()
for (const mod of modules) {
  for (const key of Object.keys(mod)) {
    if (seen.has(key)) {
      console.warn(`[core.js] Export duplicado detectado: "${key}" — segunda definição ignorada`)
    }
    seen.add(key)
  }
}

module.exports = {
  config,
  metrics,
  db,
  cache,
  helpers,
  security,
  serverCtx,
  live,
  auth,
  serverManager,
  alerts,
  ...helpers,
  ...db,
  ...cache,
  ...security,
  ...serverCtx,
  ...alerts,
  ...metrics,
  ...live,
  ...auth,
  ...serverManager,
  ...config
}
