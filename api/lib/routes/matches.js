// Rotas de partidas (histórico, detalhes e jogadores).

const {
  db,
  getPagination,
  getServerFilter,
  handleError
} = require('../core')

function register(app) {
  app.get('/matches', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
        FROM cs_matches
        ${sf ? 'WHERE server = ?' : ''}
        ORDER BY ended_at DESC
        LIMIT ? OFFSET ?
      `, [...(sf ? sf.params : []), limit, offset])

      res.json(rows)
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

      res.json(rows[0] || null)
    } catch (err) {
      handleError(res, err, 'última partida')
    }
  })

  app.get('/matches/:id', async (req, res) => {
    try {
      const [rows] = await db.query(`
        SELECT id, server, map, round_t, round_ct, winner, duration_sec, started_at, ended_at
        FROM cs_matches
        WHERE id = ?
      `, [req.params.id])

      res.json(rows[0] || null)
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
