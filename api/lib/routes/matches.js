// Rotas de partidas (histórico, detalhes e jogadores).

const {
  db,
  getPagination,
  getServerFilter,
  handleError,
  getServerList
} = require('../core')

// Mapa id -> nome de exibição. A coluna cs_matches.server guarda o id; o nome
// (ex.: "Zueira") vive apenas na config servers.list. Usamos o mapa para anexar
// `serverName` às respostas sem trocar o `server` (id), que serve de filtro/link.

function getServerNameMap() {
  const list = getServerList()
  const map = {}
  for (const srv of list) map[srv.id] = srv.name || srv.id
  return map
}

function getServerName(row) {
  if (!row) return row
  const map = getServerNameMap()
  return { ...row, serverName: map[row.server] || row.server }
}

function register(app) {
  app.get('/matches', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const countQry = sf
        ? 'SELECT COUNT(*) AS total FROM cs_matches WHERE server = ?'
        : 'SELECT COUNT(*) AS total FROM cs_matches'
      const [[{ total }]] = await db.query(countQry, sf ? sf.params : [])

      const [rows] = await db.query(`
        SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
        FROM cs_matches
        ${sf ? 'WHERE server = ?' : ''}
        ORDER BY ended_at DESC
        LIMIT ? OFFSET ?
      `, [...(sf ? sf.params : []), limit, offset])

      res.json({ matches: rows.map(getServerName), total })
    } catch (err) {
      handleError(res, err, 'listagem de partidas')
    }
  })

  app.get('/matches/latest', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
        FROM cs_matches
        ${sf ? 'WHERE server = ?' : ''}
        ORDER BY ended_at DESC
        LIMIT 1
      `, sf ? sf.params : [])

      res.json(getServerName(rows[0] || null))
    } catch (err) {
      handleError(res, err, 'última partida')
    }
  })

  app.get('/matches/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de partida inválido' })
      }
      const [rows] = await db.query(`
        SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
        FROM cs_matches
        WHERE id = ?
      `, [id])

      res.json(getServerName(rows[0] || null))
    } catch (err) {
      handleError(res, err, 'partida')
    }
  })

  app.get('/matches/:id/players', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de partida inválido' })
      }

      const [rows] = await db.query(`
        SELECT id, match_id, steamid, name, team, kills, deaths, hs
        FROM cs_matches_players
        WHERE match_id = ?
        ORDER BY kills DESC
      `, [id])

      res.json(rows)
    } catch (err) {
      handleError(res, err, 'jogadores da partida')
    }
  })
}

module.exports = { register }
