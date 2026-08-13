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
  ...helpers,
  ...db,
  ...cache,
  ...security,
  ...serverCtx,
  ...metrics,
  ...live,
  ...auth,
  ...serverManager,
  ...config
}
