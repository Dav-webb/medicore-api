const router = require('express').Router()
const bcrypt = require('bcryptjs')
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

/* GET /api/users — admin only */
router.get('/', requireAuth, requireRole(['Admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id,username,name,email,role,department,phone,is_active,last_login,created_at
      FROM users ORDER BY role, name
    `)
    res.json({ users: result.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch users.' })
  }
})

/* POST /api/users — create staff account */
router.post('/', requireAuth, requireRole(['Admin']), async (req, res) => {
  try {
    const { username, password, name, email, role, department, phone } = req.body
    if (!username || !password || !name || !role) return res.status(400).json({ error: 'Username, password, name and role required.' })

    const exists = await pool.query('SELECT id FROM users WHERE username=$1', [username])
    if (exists.rows.length) return res.status(409).json({ error: 'Username already taken.' })

    const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12
    const hash   = await bcrypt.hash(password, rounds)

    const result = await pool.query(`
      INSERT INTO users (username,password_hash,name,email,role,department,phone)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,name,email,role,department,phone,is_active,created_at
    `, [username, hash, name, email||null, role, department||null, phone||null])

    await audit(req,'CREATE_USER','user',result.rows[0].id,{username,role})
    res.status(201).json({ user: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to create user.' })
  }
})

/* PATCH /api/users/:id — update staff */
router.patch('/:id', requireAuth, requireRole(['Admin']), async (req, res) => {
  try {
    const allowed = ['name','email','role','department','phone','is_active']
    const updates = [], values = []
    let idx = 1
    for (const field of allowed) {
      if (req.body[field] !== undefined) { updates.push(`${field}=$${idx++}`); values.push(req.body[field]) }
    }
    if (req.body.password) {
      const hash = await bcrypt.hash(req.body.password, parseInt(process.env.BCRYPT_ROUNDS)||12)
      updates.push(`password_hash=$${idx++}`)
      values.push(hash)
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' })
    values.push(req.params.id)
    const result = await pool.query(
      `UPDATE users SET ${updates.join(',')},updated_at=NOW() WHERE id=$${idx}
       RETURNING id,username,name,email,role,department,phone,is_active`, values
    )
    if (!result.rows.length) return res.status(404).json({ error: 'User not found.' })
    await audit(req,'UPDATE_USER','user',req.params.id,{fields:Object.keys(req.body)})
    res.json({ user: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update user.' })
  }
})

/* DELETE /api/users/:id — deactivate (never hard delete) */
router.delete('/:id', requireAuth, requireRole(['Admin']), async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate your own account.' })
    await pool.query('UPDATE users SET is_active=FALSE,updated_at=NOW() WHERE id=$1', [req.params.id])
    await audit(req,'DEACTIVATE_USER','user',req.params.id)
    res.json({ message: 'User deactivated.' })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to deactivate user.' })
  }
})

module.exports = router
