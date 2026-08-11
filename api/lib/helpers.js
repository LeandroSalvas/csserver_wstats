// Helpers genéricos compartilhados (sem dependência de estado de servidores).

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { LIVE_DATA_DIR, NOT_BOT, NOT_BOT_WHERE } = require('./config')

// Padroniza respostas de erro: log completo no servidor, mensagem genérica no cliente.
function handleError(res, err, context) {
  console.error(`Erro em ${context}:`, err)
  res.status(500).json({ error: 'Erro interno do servidor' })
}

function timingSafeEqualStr(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest()
  const hashB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

function getPagination(req, maxLimit = 50) {
  const rawLimit = parseInt(req.query.limit, 10)
  const rawPage = parseInt(req.query.page, 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : 10
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 1000) : 1
  const offset = (page - 1) * limit
  return { limit, page, offset }
}

function readLiveFile(name, dir) {
  const filePath = path.join(dir || LIVE_DATA_DIR, name)
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}

module.exports = {
  handleError,
  timingSafeEqualStr,
  withTimeout,
  getPagination,
  readLiveFile,
  NOT_BOT,
  NOT_BOT_WHERE
}
