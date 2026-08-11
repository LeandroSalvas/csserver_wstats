// Camada de banco: pool MySQL, trackedQuery (contabiliza erros de query) e
// ensureSchema/ensureKey com as migrações idempotentes do schema.

const mysql = require('mysql2/promise')
const { dbConfig } = require('./config')
const { dbQueryErrorsTotal } = require('./metrics')

const db = mysql.createPool({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database
})

// Wrap de db.query para contabilizar erros de query sem quebrar o pool.
// Todas as queries do app passam por aqui (db.query é substituído abaixo).
const originalQuery = db.query.bind(db)
async function trackedQuery(...args) {
  try {
    return await originalQuery(...args)
  } catch (err) {
    dbQueryErrorsTotal.inc()
    throw err
  }
}
db.query = trackedQuery

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cs_matches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      server VARCHAR(32) NOT NULL DEFAULT 'main',
      map VARCHAR(64) NOT NULL,
      round_t INT NOT NULL DEFAULT 0,
      round_ct INT NOT NULL DEFAULT 0,
      winner ENUM('T','CT','DRAW') NULL,
      duration_sec INT NULL,
      started_at DATETIME NULL,
      ended_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_match (server, map, ended_at)
    )
  `)

  // Jogadores registrados em cada partida (enviados pelo plugin live_scoreboard
  // dentro de last_match.players). Criada separadamente para bancos antigos.
  await db.query(`
    CREATE TABLE IF NOT EXISTS cs_matches_players (
      id INT AUTO_INCREMENT PRIMARY KEY,
      match_id INT NOT NULL,
      server VARCHAR(32) NOT NULL DEFAULT 'main',
      pid INT NOT NULL DEFAULT 0,
      steamid VARCHAR(32) NOT NULL,
      name VARCHAR(64) NOT NULL DEFAULT '',
      team VARCHAR(16) NULL,
      kills INT NOT NULL DEFAULT 0,
      deaths INT NOT NULL DEFAULT 0,
      hs INT NOT NULL DEFAULT 0,
      UNIQUE KEY uq_match_player (match_id, pid),
      KEY idx_mp_match (match_id)
    )
  `)

  // Migrações idempotentes para bancos existentes (multi-servidor).
  const ensureColumn = async (table, column, ddl) => {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    )
    if (!row.n) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`)
  }

  const ensureKey = async (table, key, ddl) => {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, key]
    )
    if (!row.n) await db.query(`ALTER TABLE \`${table}\` ADD ${ddl}`)
  }

  await ensureColumn('csstats', 'server_name', "`server_name` varchar(32) NOT NULL DEFAULT 'main' AFTER `session_map`")
  await ensureKey('csstats', 'server_steamid', 'UNIQUE KEY `server_steamid` (`server_name`, `steamid`(16))')

  await ensureColumn('csstats_snapshots', 'server_name', "`server_name` varchar(32) NOT NULL DEFAULT 'main'")
  await ensureKey('csstats_snapshots', 'idx_snap_server', 'KEY `idx_snap_server` (`server_name`)')

  await ensureColumn('cs_matches', 'server', "`server` varchar(32) NOT NULL DEFAULT 'main'")

  // uq_match precisa incluir `server` (bancos antigos tinham apenas map+ended_at).
  // Se o índice não existir, apenas cria; se existir sem `server`, recria.
  try {
    const [[uqMatchExists]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cs_matches' AND INDEX_NAME = 'uq_match'`
    )
    if (!uqMatchExists.n) {
      await db.query('ALTER TABLE `cs_matches` ADD UNIQUE KEY `uq_match` (`server`, `map`, `ended_at`)')
    } else {
      const [[uqMatchCols]] = await db.query(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cs_matches'
           AND INDEX_NAME = 'uq_match' AND COLUMN_NAME = 'server'`
      )
      if (uqMatchCols.n === 0) {
        await db.query('ALTER TABLE `cs_matches` DROP INDEX `uq_match`')
        await db.query('ALTER TABLE `cs_matches` ADD UNIQUE KEY `uq_match` (`server`, `map`, `ended_at`)')
      }
    }
  } catch (err) {
    console.error('Migração uq_match falhou:', err)
  }

  // csstats_snapshots.skill: INT → FLOAT (alinhar com csstats.skill, evitar truncamento).
  try {
    const [[skillCol]] = await db.query(
      `SELECT DATA_TYPE AS t FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'csstats_snapshots' AND COLUMN_NAME = 'skill'`
    )
    if (skillCol && skillCol.t && String(skillCol.t).toUpperCase() !== 'FLOAT') {
      await db.query('ALTER TABLE `csstats_snapshots` MODIFY `skill` float NULL')
    }
  } catch (err) {
    console.error('Migração skill FLOAT falhou:', err)
  }

  // Índice composto para as CTEs de LAG por (server_name, steamid, created_at).
  await ensureKey('csstats_snapshots', 'idx_snap_server_steamid_time',
    'KEY `idx_snap_server_steamid_time` (`server_name`, `steamid`, `created_at`)')

  // Índices para consultas por data (active7d/30d) e por mapa (GROUP BY /maps).
  await ensureKey('csstats_snapshots', 'idx_snap_server_time',
    'KEY `idx_snap_server_time` (`server_name`, `created_at`)')
  await ensureKey('csstats_snapshots', 'idx_snap_server_map',
    'KEY `idx_snap_server_map` (`server_name`, `map`)')
}

module.exports = {
  db,
  trackedQuery,
  ensureSchema
}
