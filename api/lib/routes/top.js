// Rotas de tops, jogador, busca, skill/KD e estatísticas gerais.

const {
  db,
  getCached,
  CACHE_RANKING_TTL,
  CACHE_STATS_TTL,
  getPagination,
  getServerFilter,
  handleError,
  searchLimiter,
  NOT_BOT,
  NOT_BOT_WHERE
} = require('../core')

function register(app) {
  // TOP 10
  app.get('/top10', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`top10:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            ROUND(SUM(kills) / IF(SUM(deaths) = 0, 1, SUM(deaths)), 2) AS kd,
            MAX(skill) AS skill,
            MAX(last_join) AS last_join
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          ORDER BY kills DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)

    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/top-headshots', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`tophs:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            SUM(hs) AS hs,
            MAX(skill) AS skill,
            ROUND(SUM(hs) / IF(SUM(kills) = 0, 1, SUM(kills)) * 100, 2) AS accuracy
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          ORDER BY hs DESC, kills DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/top-accuracy', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`topacc:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            SUM(hs) AS hs,
            MAX(skill) AS skill,
            ROUND(SUM(hs) / IF(SUM(kills) = 0, 1, SUM(kills)) * 100, 2) AS accuracy
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          HAVING SUM(kills) >= 10
          ORDER BY accuracy DESC, hs DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/top-killstreak', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`killstreak:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          WITH ordered AS (
            SELECT
              steamid,
              name,
              created_at,
              kills,
              LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills
            FROM csstats_snapshots
            ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
          )
          SELECT
            steamid,
            MAX(name) AS name,
            MAX(GREATEST(kills - COALESCE(prev_kills, 0), 0)) AS streak
          FROM ordered
          GROUP BY steamid
          HAVING streak > 0
          ORDER BY streak DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  // TOP ASSISTS
  app.get('/top-assists', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`topassists:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(assists) AS assists,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            MAX(skill) AS skill,
            ROUND(SUM(assists) / IF(SUM(kills) = 0, 1, SUM(kills)), 2) AS assists_per_kill
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          ORDER BY assists DESC, kills DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  // TOP DAMAGE
  app.get('/top-damage', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`topdmg:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(dmg) AS dmg,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            MAX(skill) AS skill,
            ROUND(SUM(dmg) / IF(SUM(kills) = 0, 1, SUM(kills)), 1) AS dmg_per_kill
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          ORDER BY dmg DESC, kills DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  // TOP TEAM KILLS
  app.get('/top-tk', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`toptk:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(tks) AS tks,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            MAX(skill) AS skill
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          ORDER BY tks DESC, kills DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  // TOP BOMB
  app.get('/top-bomb', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`topbomb:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(bombplants) AS bombplants,
            SUM(bombdefused) AS bombdefused,
            SUM(bombdef) AS bombdef,
            SUM(bombexplosions) AS bombexplosions,
            MAX(skill) AS skill
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          ORDER BY (SUM(bombplants) + SUM(bombdefused) + SUM(bombdef) + SUM(bombexplosions)) DESC, SUM(bombplants) DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  // TOP CONNECT TIME
  app.get('/top-connect-time', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`topconn:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            MAX(name) AS name,
            steamid,
            SUM(connection_time) AS connection_time,
            SUM(connects) AS connects,
            SUM(kills) AS kills,
            SUM(deaths) AS deaths,
            MAX(skill) AS skill,
            ROUND(SUM(connection_time) / 3600, 1) AS hours_played
          FROM csstats
          WHERE ${NOT_BOT}
          ${sf ? sf.where : ''}
          GROUP BY steamid
          HAVING SUM(connection_time) > 0
          ORDER BY connection_time DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  // PLAYER
  app.get('/player/:steamid', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT
          steamid,
          MAX(name) AS name,
          MAX(skill) AS skill,
          SUM(kills) AS kills,
          SUM(deaths) AS deaths,
          SUM(hs) AS hs,
          SUM(tks) AS tks,
          SUM(shots) AS shots,
          SUM(hits) AS hits,
          SUM(dmg) AS dmg,
          SUM(bombdef) AS bombdef,
          SUM(bombdefused) AS bombdefused,
          SUM(bombplants) AS bombplants,
          SUM(bombexplosions) AS bombexplosions,
          SUM(connection_time) AS connection_time,
          SUM(connects) AS connects,
          SUM(assists) AS assists,
          MIN(first_join) AS first_join,
          MAX(last_join) AS last_join,
          SUM(roundt) AS roundt,
          SUM(wint) AS wint,
          SUM(roundct) AS roundct,
          SUM(winct) AS winct,
          GROUP_CONCAT(DISTINCT server_name ORDER BY server_name) AS server_name
        FROM csstats
        WHERE steamid = ?
        ${sf ? sf.where : ''}
        ${NOT_BOT_WHERE}
        GROUP BY steamid
      `, [req.params.steamid, ...(sf ? sf.params : [])])

      res.json(rows[0] || null)

    } catch (err) {
      handleError(res, err)
    }
  })

  // BUSCA DE JOGADOR
  app.get('/player-search', searchLimiter, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim()
      if (!q) {
        return res.json([])
      }
      if (q.length > 64) {
        return res.status(400).json({ error: 'Busca muito longa' })
      }

      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT steamid, MAX(name) AS name, SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(hs) AS hs, MAX(skill) AS skill
        FROM csstats
        WHERE (name LIKE ? OR steamid LIKE ?)
        ${sf ? sf.where : ''}
        ${NOT_BOT_WHERE}
        GROUP BY steamid
        ORDER BY kills DESC
        LIMIT 10
      `, [`%${q}%`, `%${q}%`, ...(sf ? sf.params : [])])

      res.json(rows)

    } catch (err) {
      handleError(res, err, 'busca de jogador')
    }
  })

  // TOP SKILL
  app.get('/topskill', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT MAX(name) AS name, steamid, MAX(skill) AS skill
        FROM csstats
        WHERE ${NOT_BOT}
        ${sf ? sf.where : ''}
        GROUP BY steamid
        ORDER BY skill DESC
        LIMIT ? OFFSET ?
      `, [...(sf ? sf.params : []), limit, offset])

      res.json(rows)

    } catch (err) {
      handleError(res, err)
    }
  })

  // TOP KD
  app.get('/topkd', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT
          MAX(name) AS name,
          steamid,
          SUM(kills) AS kills,
          SUM(deaths) AS deaths,
          ROUND(SUM(kills) / IF(SUM(deaths) = 0, 1, SUM(deaths)), 2) AS kd
        FROM csstats
        WHERE ${NOT_BOT}
        ${sf ? sf.where : ''}
        GROUP BY steamid
        HAVING SUM(kills) > 10
        ORDER BY kd DESC
        LIMIT ? OFFSET ?
      `, [...(sf ? sf.params : []), limit, offset])

      res.json(rows)

    } catch (err) {
      handleError(res, err)
    }
  })

  //STATUS GERAIS
  app.get('/stats', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const stats = await getCached(`stats:${sf ? sf.server : '*'}`, CACHE_STATS_TTL, async () => {
        const [[players]] = await db.query(
          `SELECT COUNT(DISTINCT steamid) total FROM csstats ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}`,
          sf ? sf.params : []
        )

        const [[kills]] = await db.query(
          `SELECT COALESCE(SUM(kills), 0) total FROM csstats ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}`,
          sf ? sf.params : []
        )

        const [[maps]] = await db.query(
          `SELECT COUNT(DISTINCT map) total FROM csstats_snapshots ${sf ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}`,
          sf ? sf.params : []
        )

        return {
          players: players.total,
          kills: kills.total,
          maps: maps.total,
        }
      })

      res.json(stats)
    } catch (err) {
      handleError(res, err)
    }
  })
}

module.exports = { register }
