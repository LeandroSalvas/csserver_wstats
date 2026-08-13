#!/usr/bin/env node
// seed-admin.js — cria/recupera o Superadmin local e grava as credenciais em
// ADMIN_CREDENTIALS.txt (repo root, gitignored).
//
// Uso:
//   docker compose exec api node scripts/seed-admin.js          # idempotente
//   docker compose exec api node scripts/seed-admin.js --reset  # regenera a senha

const { db } = require('../lib/db')
const {
  hashPassword,
  generatePassword,
  writeCredentialsFile,
  seedSuperadmin
} = require('../lib/auth')

async function main() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim()
  const reset = process.argv.includes('--reset')

  if (reset) {
    const password = generatePassword()
    const passwordHash = await hashPassword(password)
    const [result] = await db.query(
      "UPDATE users SET password_hash = ? WHERE provider = 'local' AND role = 'superadmin' AND status = 'active'",
      [passwordHash]
    )
    if (result.affectedRows > 0) {
      const filePath = writeCredentialsFile(username, password)
      console.log(`Superadmin local '${username}' — senha regenerada. Credenciais em ${filePath}`)
    } else {
      console.log('Nenhum superadmin local ativo encontrado; criando novo...')
      await seedSuperadmin()
    }
  } else {
    const id = await seedSuperadmin()
    if (id) {
      console.log(`Superadmin local presente (id=${id}). Nada a fazer (use --reset para regenerar a senha).`)
    } else {
      console.log('SEED_ADMIN está desabilitado (SEED_ADMIN=0) — nada a fazer.')
    }
  }

  await db.end()
}

main().catch((err) => {
  console.error('seed-admin falhou:', err)
  process.exit(1)
})
