// Rotas de mapas, rankings (weekly/monthly), histórico por jogador e rank history.

const {
  db,
  getCached,
  CACHE_RANKING_TTL,
  getPagination,
  getServerFilter,
  handleError,
  NOT_BOT,
  NOT_BOT_WHERE
} = require('../core')

async function getMapRanking(map, limit, offset = 0, server = null) {
  const [rows] = await db.query(`
    WITH ordered AS (
      SELECT
        steamid,
        name,
        map,
        kills,
        deaths,
        hs,
        skill,
        created_at,
        LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
        LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
        LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
      FROM csstats_snapshots
      ${server ? 'WHERE server_name = ? AND ' : 'WHERE '}${NOT_BOT}
    ),
    deltas AS (
      SELECT
        steamid,
        name,
        map,
        GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
        GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
        GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
        skill
      FROM ordered
    )
    SELECT
      steamid,
      MAX(name) AS name,
      SUM(kills_delta) AS kills,
      SUM(deaths_delta) AS deaths,
      SUM(hs_delta) AS hs,
      MAX(skill) AS skill,
      ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
    FROM deltas
    WHERE map = ?
    GROUP BY steamid
    HAVING kills > 0 OR deaths > 0 OR hs > 0
    ORDER BY kills DESC, kd DESC
    LIMIT ? OFFSET ?
  `, [...(server ? [server] : []), map, limit, offset])

  return rows
}

function register(app) {
  app.get('/maps', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`maps:${sf ? sf.server : '*'}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
          SELECT
            map,
            COUNT(*) AS snapshots
          FROM csstats_snapshots
          WHERE map IS NOT NULL
            AND map <> ''
            AND map <> 'unknown'
          ${sf ? sf.where : ''}
          ${NOT_BOT_WHERE}
          GROUP BY map
          ORDER BY snapshots DESC, map ASC
        `, sf ? sf.params : [])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/map-ranking/:map', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req, 20)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(
        `mapranking:${req.params.map}:${sf ? sf.server : '*'}:${limit}:${offset}`,
        CACHE_RANKING_TTL,
        () => getMapRanking(req.params.map, limit, offset, sf ? sf.server : null)
      )
      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/ranking/weekly', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`ranking:weekly:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        // A janela vai DENTRO do CTE (limita o scan), com baseline pré-janela
        // (último snapshot por jogador antes da janela) para o LAG preservar
        // exatamente a semântica de delta do ranking sem perder o histórico.
        const [rows] = await db.query(`
          WITH baseline AS (
            SELECT s.steamid, s.server_name, s.name, s.map, s.kills, s.deaths, s.hs, s.skill, s.created_at
            FROM csstats_snapshots s
            JOIN (
              SELECT steamid, server_name, MAX(created_at) AS max_created
              FROM csstats_snapshots
              WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
                AND ${NOT_BOT}
                ${sf ? sf.where : ''}
              GROUP BY steamid, server_name
            ) b ON b.steamid = s.steamid AND b.server_name = s.server_name AND b.max_created = s.created_at
          ),
          windowed AS (
            SELECT steamid, server_name, name, map, kills, deaths, hs, skill, created_at
            FROM csstats_snapshots
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
              AND ${NOT_BOT}
              ${sf ? sf.where : ''}
          ),
          combined AS (
            SELECT * FROM windowed
            UNION ALL
            SELECT * FROM baseline
          ),
          ordered AS (
            SELECT steamid, name, map, kills, deaths, hs, skill, created_at,
              LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
              LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
              LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
            FROM combined
          ),
          deltas AS (
            SELECT
              steamid,
              name,
              created_at,
              GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
              GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
              GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
              skill
            FROM ordered
          )
          SELECT
            steamid,
            MAX(name) AS name,
            SUM(kills_delta) AS kills,
            SUM(deaths_delta) AS deaths,
            SUM(hs_delta) AS hs,
            MAX(skill) AS skill,
            ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
          FROM deltas
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          GROUP BY steamid
          HAVING kills > 0 OR deaths > 0 OR hs > 0
          ORDER BY kills DESC, kd DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), ...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/ranking/monthly', async (req, res) => {
    try {
      const { limit, offset } = getPagination(req)
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const rows = await getCached(`ranking:monthly:${sf ? sf.server : '*'}:${limit}:${offset}`, CACHE_RANKING_TTL, async () => {
        // Mesma técnica da weekly: janela dentro do CTE + baseline pré-janela.
        const [rows] = await db.query(`
          WITH baseline AS (
            SELECT s.steamid, s.server_name, s.name, s.map, s.kills, s.deaths, s.hs, s.skill, s.created_at
            FROM csstats_snapshots s
            JOIN (
              SELECT steamid, server_name, MAX(created_at) AS max_created
              FROM csstats_snapshots
              WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND ${NOT_BOT}
                ${sf ? sf.where : ''}
              GROUP BY steamid, server_name
            ) b ON b.steamid = s.steamid AND b.server_name = s.server_name AND b.max_created = s.created_at
          ),
          windowed AS (
            SELECT steamid, server_name, name, map, kills, deaths, hs, skill, created_at
            FROM csstats_snapshots
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
              AND ${NOT_BOT}
              ${sf ? sf.where : ''}
          ),
          combined AS (
            SELECT * FROM windowed
            UNION ALL
            SELECT * FROM baseline
          ),
          ordered AS (
            SELECT steamid, name, map, kills, deaths, hs, skill, created_at,
              LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
              LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
              LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
            FROM combined
          ),
          deltas AS (
            SELECT
              steamid,
              name,
              created_at,
              GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
              GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
              GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
              skill
            FROM ordered
          )
          SELECT
            steamid,
            MAX(name) AS name,
            SUM(kills_delta) AS kills,
            SUM(deaths_delta) AS deaths,
            SUM(hs_delta) AS hs,
            MAX(skill) AS skill,
            ROUND(SUM(kills_delta) / IF(SUM(deaths_delta) = 0, 1, SUM(deaths_delta)), 2) AS kd
          FROM deltas
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY steamid
          HAVING kills > 0 OR deaths > 0 OR hs > 0
          ORDER BY kills DESC, kd DESC
          LIMIT ? OFFSET ?
        `, [...(sf ? sf.params : []), ...(sf ? sf.params : []), limit, offset])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/player-history-daily/:steamid', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      // Query por jogador (indexada por steamid) — mantém todo o histórico, sem
      // janela: limitar por data esconderia atividade antiga (mesma linha da
      // decisão do map-ranking) sem ganho real de scan.
      const [rows] = await db.query(`
        WITH ordered AS (
          SELECT
            steamid,
            created_at,
            kills,
            deaths,
            hs,
            skill,
            LAG(kills) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_kills,
            LAG(deaths) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_deaths,
            LAG(hs) OVER (PARTITION BY steamid, server_name ORDER BY created_at) AS prev_hs
          FROM csstats_snapshots
          WHERE steamid = ?
          ${sf ? sf.where : ''}
          ${NOT_BOT_WHERE}
        ),
        deltas AS (
          SELECT
            created_at,
            GREATEST(kills - COALESCE(prev_kills, 0), 0) AS kills_delta,
            GREATEST(deaths - COALESCE(prev_deaths, 0), 0) AS deaths_delta,
            GREATEST(hs - COALESCE(prev_hs, 0), 0) AS hs_delta,
            skill
          FROM ordered
        )
        SELECT
          DATE(created_at) AS day,
          SUM(kills_delta) AS kills,
          SUM(deaths_delta) AS deaths,
          SUM(hs_delta) AS hs,
          MAX(skill) AS skill
        FROM deltas
        GROUP BY day
        HAVING kills > 0 OR deaths > 0 OR hs > 0
        ORDER BY day DESC
        LIMIT 60
      `, [req.params.steamid, ...(sf ? sf.params : [])])

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })

  app.get('/player-last-map/:steamid', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await db.query(`
        SELECT map, created_at
        FROM csstats_snapshots
        WHERE steamid = ?
          AND map IS NOT NULL
          AND map <> ''
          AND map <> 'unknown'
        ${sf ? sf.where : ''}
        ${NOT_BOT_WHERE}
        ORDER BY created_at DESC
        LIMIT 1
      `, [req.params.steamid, ...(sf ? sf.params : [])])

      res.json(rows[0] || null)
    } catch (err) {
      handleError(res, err)
    }
  })

  // HISTÓRICO DE POSIÇÃO NO RANKING
  app.get('/player-rank-history/:steamid', async (req, res) => {
    try {
      const sf = getServerFilter(req)
      if (sf && sf.invalid) return res.status(400).json({ error: `Servidor não configurado: ${sf.invalid}` })

      const [rows] = await getCached(`rankhistory:${req.params.steamid}:${sf ? sf.server : '*'}`, CACHE_RANKING_TTL, async () => {
        const [rows] = await db.query(`
        WITH daily AS (
          SELECT
            steamid,
            DATE(created_at) AS day,
            MAX(skill) AS skill
          FROM csstats_snapshots
          WHERE steamid = ?
          ${sf ? sf.where : ''}
          ${NOT_BOT_WHERE}
          GROUP BY steamid, day
        ),
        all_players_daily AS (
          SELECT
            steamid,
            DATE(created_at) AS day,
            MAX(skill) AS skill
          FROM csstats_snapshots
          WHERE created_at >= COALESCE((SELECT MIN(day) FROM daily), NOW() - INTERVAL 90 DAY)
          ${sf ? sf.where : ''}
          ${NOT_BOT_WHERE}
          GROUP BY steamid, day
        ),
        ranked AS (
          SELECT
            day,
            steamid,
            skill,
            RANK() OVER (PARTITION BY day ORDER BY skill DESC) AS position
          FROM all_players_daily
        )
        SELECT
          r.day,
          r.position,
          r.skill,
          d.total_players
        FROM ranked r
        JOIN (
          SELECT day, COUNT(*) AS total_players
          FROM all_players_daily
          GROUP BY day
        ) d ON d.day = r.day
        WHERE r.steamid = ?
        ORDER BY r.day ASC
      `, [req.params.steamid, ...(sf ? sf.params : []), ...(sf ? sf.params : []), req.params.steamid])
        return rows
      })

      res.json(rows)
    } catch (err) {
      handleError(res, err)
    }
  })
}

module.exports = { register }
