// Autenticação: hash de senha (scrypt), login local, usuários sociais
// (Google/Steam) com fluxo de aprovação e seed do Superadmin local.

const crypto = require('crypto')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')

const { db } = require('./db')
const { timingSafeEqualStr } = require('./helpers')
const { serverRepoDir, seedAdminEnabled } = require('./config')

const scrypt = promisify(crypto.scrypt)

const SCRYPT_KEYLEN = 64

async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(String(password), salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false
  const parts = String(stored).split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, saltHex, hashHex] = parts
  try {
    const hash = await scrypt(String(password), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN)
    return timingSafeEqualStr(hash.toString('hex'), hashHex)
  } catch (err) {
    return false
  }
}

// Converte a linha do banco em um objeto seguro para a sessão (nunca a hash).
function serializeUser(row) {
  if (!row) return null
  return {
    id: row.id,
    provider: row.provider,
    username: row.username,
    displayName: row.display_name || row.username || '',
    email: row.email,
    role: row.role,
    status: row.status
  }
}

async function loginLocal(username, password) {
  const clean = String(username || '').trim()
  if (!clean || !password) return null

  const [[row]] = await db.query(
    "SELECT * FROM users WHERE provider = 'local' AND username = ? LIMIT 1",
    [clean]
  )
  if (!row || !row.password_hash) return null

  const ok = await verifyPassword(password, row.password_hash)
  if (!ok) return null

  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [row.id])
  return row
}

// Encontra um usuário social; na primeira visita cria com status 'pending'
// (aguardando aprovação de um admin ativo). Atualiza dados de perfil sempre.
async function findOrCreateUser(provider, providerId, profile = {}) {
  const [[existing]] = await db.query(
    'SELECT * FROM users WHERE provider = ? AND provider_id = ? LIMIT 1',
    [provider, String(providerId)]
  )
  if (existing) {
    await db.query(
      'UPDATE users SET display_name = ?, email = ?, avatar_url = ?, last_login_at = NOW() WHERE id = ?',
      [
        profile.displayName || existing.display_name || null,
        profile.email || existing.email || null,
        profile.avatarUrl || existing.avatar_url || null,
        existing.id
      ]
    )
    return { ...existing, display_name: profile.displayName || existing.display_name }
  }

  const [result] = await db.query(
    `INSERT INTO users (provider, provider_id, display_name, email, avatar_url, role, status, last_login_at)
     VALUES (?, ?, ?, ?, ?, 'admin', 'pending', NOW())`,
    [
      provider,
      String(providerId),
      profile.displayName || null,
      profile.email || null,
      profile.avatarUrl || null
    ]
  )
  return {
    id: result.insertId,
    provider,
    provider_id: String(providerId),
    display_name: profile.displayName || null,
    email: profile.email || null,
    role: 'admin',
    status: 'pending'
  }
}

function generatePassword(length = 22) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length)
}

// Caminho do arquivo de credenciais: prioriza o repo montado (SERVER_REPO_DIR);
// senão cai no diretório de trabalho do container.
function credentialsFilePath() {
  const candidates = [serverRepoDir, process.cwd()]
  for (const dir of candidates) {
    try {
      fs.accessSync(dir, fs.constants.W_OK)
      return path.join(dir, 'ADMIN_CREDENTIALS.txt')
    } catch (err) {
      /* tenta o próximo */
    }
  }
  return path.join(process.cwd(), 'ADMIN_CREDENTIALS.txt')
}

function writeCredentialsFile(username, password) {
  const filePath = credentialsFilePath()
  const content = [
    'CS 1.6 Server Stats — Superadmin local',
    'Acesse /login e entre com as credenciais abaixo.',
    `username: ${username}`,
    `password: ${password}`,
    'Guarde em local seguro e remova este arquivo.'
  ].join('\n')
  fs.writeFileSync(filePath, content + '\n', { mode: 0o600 })
  try {
    // No container (roda como root) o arquivo nasceria root:root no bind mount;
    // transfere para o dono do diretório (o usuário do host) para que o host
    // consiga ler. Fora do container (host/dev) o chown falharia — ignorado.
    const dirStat = fs.statSync(path.dirname(filePath))
    fs.chownSync(filePath, dirStat.uid, dirStat.gid)
  } catch (err) {
    /* melhor esforço */
  }
  return filePath
}

// Garante que o arquivo de credenciais existente pertença ao dono do diretório
// (no container a API roda como root e o bind mount nasceria root:root).
function chownCredentialsFileIfNeeded() {
  try {
    const filePath = credentialsFilePath()
    if (!fs.existsSync(filePath)) return
    const dirStat = fs.statSync(path.dirname(filePath))
    const fileStat = fs.statSync(filePath)
    if (fileStat.uid !== dirStat.uid || fileStat.gid !== dirStat.gid) {
      fs.chownSync(filePath, dirStat.uid, dirStat.gid)
    }
  } catch (err) {
    /* melhor esforço */
  }
}

// Idempotente: cria o Superadmin local no primeiro boot (se SEED_ADMIN=1).
// Gera uma senha aleatória e a grava em ADMIN_CREDENTIALS.txt (gitignored).
async function seedSuperadmin() {
  if (!seedAdminEnabled) return null

  const [[active]] = await db.query(
    "SELECT id FROM users WHERE provider = 'local' AND role = 'superadmin' AND status = 'active' LIMIT 1"
  )
  if (active) {
    chownCredentialsFileIfNeeded()
    return active.id
  }

  const username = (process.env.ADMIN_USERNAME || 'admin').trim()
  const [[nameTaken]] = await db.query(
    "SELECT id, role, status FROM users WHERE provider = 'local' AND username = ? LIMIT 1",
    [username]
  )
  if (nameTaken) {
    console.warn(`seedSuperadmin: usuário local '${username}' já existe (role=${nameTaken.role}, status=${nameTaken.status}); não promovendo automaticamente.`)
    return nameTaken.id
  }

  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  const [result] = await db.query(
    `INSERT INTO users (provider, username, password_hash, display_name, role, status)
     VALUES ('local', ?, ?, ?, 'superadmin', 'active')`,
    [username, passwordHash, username]
  )

  const filePath = writeCredentialsFile(username, password)
  console.log(`seedSuperadmin: Superadmin local '${username}' criado (id=${result.insertId}). Credenciais em ${filePath}`)
  return result.insertId
}

module.exports = {
  hashPassword,
  verifyPassword,
  serializeUser,
  loginLocal,
  findOrCreateUser,
  generatePassword,
  writeCredentialsFile,
  seedSuperadmin
}
