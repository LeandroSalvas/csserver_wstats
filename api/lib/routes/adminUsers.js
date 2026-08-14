// Gestão de usuários/admins: a LISTAGEM é liberada para qualquer admin ativo
// (leitura); aprovar/rejeitar, alterar role e remover continuam superadmin.
// O frontend (users.js) oculta as ações para quem não é superadmin.
// O admin local (seed) é protegido: nenhum superusuário pode removê-lo,
// rebaixá-lo ou desativá-lo (reject) — evita trancamento total.

const {
  commandLimiter,
  requireAdmin,
  requireSuperadmin,
  requireCsrf,
  sendAlert,
  pushAlertEvent
} = require('../core')

const { db } = require('../core')

// Admin local = conta de superadmin criada pelo seed (auth.js seedSuperadmin).
// Identifica-se por provider 'local' + role 'superadmin' (independente do
// status, senão rejeitar antes burlaria a proteção).
function isLocalAdmin(row) {
  return !!row && row.provider === 'local' && row.role === 'superadmin'
}

function register(app) {
  app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT id, provider, provider_id, username, display_name, email, avatar_url,
                role, status, created_at, updated_at, last_login_at
         FROM users ORDER BY status = 'active' DESC, created_at DESC`
      )
      res.json({ users: rows })
    } catch (err) {
      console.error('Erro ao listar usuários:', err)
      res.status(500).json({ error: 'Falha ao listar usuários' })
    }
  })

  async function setStatus(req, res, status) {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' })
      }
      const [rows] = await db.query(
        'SELECT id, provider, username, display_name, email, role FROM users WHERE id = ?',
        [id]
      )
      if (!rows.length) {
        return res.status(404).json({ error: 'Usuário não encontrado' })
      }
      if (status === 'rejected') {
        if (isLocalAdmin(rows[0])) {
          return res.status(400).json({ error: 'O admin local não pode ser desativado' })
        }
      }
      const [result] = await db.query('UPDATE users SET status = ? WHERE id = ?', [status, id])
      if (!result.affectedRows) {
        return res.status(404).json({ error: 'Usuário não encontrado' })
      }

      const u = rows[0]
      const who = req.session?.user?.displayName || req.session?.user?.username || req.session?.user?.id
      const detail = `${u.display_name || u.username || u.email || u.id} (${u.provider})`
      if (status === 'active') {
        pushAlertEvent(id, 'user-approved', detail)
        await sendAlert(`🟢 Usuário aprovado: ${detail} — por ${who}`)
      } else if (status === 'rejected') {
        pushAlertEvent(id, 'user-rejected', detail)
        await sendAlert(`⛔ Usuário rejeitado: ${detail} — por ${who}`)
      }

      res.json({ success: true, id, status })
    } catch (err) {
      console.error(`Erro ao alterar status (${status}) do usuário ${req.params.id}:`, err)
      res.status(500).json({ error: 'Falha ao alterar status' })
    }
  }

  app.post('/admin/users/:id/approve', commandLimiter, requireSuperadmin, requireCsrf, (req, res) => {
    setStatus(req, res, 'active')
  })

  app.post('/admin/users/:id/reject', commandLimiter, requireSuperadmin, requireCsrf, (req, res) => {
    setStatus(req, res, 'rejected')
  })

  app.post('/admin/users/:id/role', commandLimiter, requireSuperadmin, requireCsrf, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      const role = String(req.body?.role || '')
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' })
      if (role !== 'admin' && role !== 'superadmin') {
        return res.status(400).json({ error: 'role deve ser admin ou superadmin' })
      }
      const [rows] = await db.query('SELECT provider, role FROM users WHERE id = ?', [id])
      if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' })

      if (isLocalAdmin(rows[0]) && role !== 'superadmin') {
        return res.status(400).json({ error: 'O admin local não pode ser rebaixado' })
      }

      // Não rebaixar/derrubar o único superadmin ativo.
      if (role !== 'superadmin' && rows[0].role === 'superadmin') {
        const [[count]] = await db.query(
          "SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND status = 'active'"
        )
        if (Number(count.n) <= 1) {
          return res.status(400).json({ error: 'Não é possível remover o último superadmin ativo' })
        }
      }

      await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id])
      res.json({ success: true, id, role })
    } catch (err) {
      console.error('Erro ao alterar role do usuário:', err)
      res.status(500).json({ error: 'Falha ao alterar role' })
    }
  })

  app.delete('/admin/users/:id', commandLimiter, requireSuperadmin, requireCsrf, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10)
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' })

      if (id === req.session.user.id) {
        return res.status(400).json({ error: 'Não é possível remover a própria conta' })
      }

      const [rows] = await db.query('SELECT provider, role, status FROM users WHERE id = ?', [id])
      if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' })

      if (isLocalAdmin(rows[0])) {
        return res.status(400).json({ error: 'O admin local não pode ser removido' })
      }

      if (rows[0].role === 'superadmin' && rows[0].status === 'active') {
        const [[count]] = await db.query(
          "SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND status = 'active'"
        )
        if (Number(count.n) <= 1) {
          return res.status(400).json({ error: 'Não é possível remover o último superadmin ativo' })
        }
      }

      await db.query('DELETE FROM users WHERE id = ?', [id])
      res.json({ success: true, id })
    } catch (err) {
      console.error('Erro ao remover usuário:', err)
      res.status(500).json({ error: 'Falha ao remover usuário' })
    }
  })
}

module.exports = { register }
