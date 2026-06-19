const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

/* GET /api/prescriptions — list (pharmacy sees pending, doctor sees own) */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, limit=20, page=1 } = req.query
    const offset = (Math.max(1,parseInt(page))-1) * parseInt(limit)
    let where = ['1=1'], params = [], idx = 1

    if (status) { where.push(`pr.status=$${idx++}`); params.push(status) }
    if (req.user.role === 'Doctor') { where.push(`pr.prescriber_id=$${idx++}`); params.push(req.user.id) }

    const result = await pool.query(`
      SELECT pr.*, p.first_name||' '||p.last_name AS patient_name, p.file_no,
             u.name AS prescriber_name
      FROM prescriptions pr
      JOIN patients p ON pr.patient_id=p.id
      LEFT JOIN users u ON pr.prescriber_id=u.id
      WHERE ${where.join(' AND ')}
      ORDER BY pr.created_at DESC LIMIT $${idx} OFFSET $${idx+1}
    `, [...params, parseInt(limit), offset])

    res.json({ prescriptions: result.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch prescriptions.' })
  }
})

/* POST /api/prescriptions — create prescription */
router.post('/', requireAuth, requireRole(['Admin','Doctor']), async (req, res) => {
  try {
    const { patient_id, encounter_id, items, is_nhis, notes } = req.body
    if (!patient_id || !items?.length) return res.status(400).json({ error: 'Patient and at least one drug required.' })

    const year  = new Date().getFullYear()
    const seq   = await pool.query('SELECT COUNT(*)+1 AS n FROM prescriptions')
    const rx_no = `RX/${year}/${String(parseInt(seq.rows[0].n)).padStart(4,'0')}`

    const result = await pool.query(`
      INSERT INTO prescriptions (rx_no,patient_id,encounter_id,prescriber_id,items,is_nhis,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [rx_no,patient_id,encounter_id||null,req.user.id,JSON.stringify(items),is_nhis||false,notes||null])

    await audit(req,'CREATE_PRESCRIPTION','prescription',result.rows[0].id,{rx_no,items:items.length})
    res.status(201).json({ prescription: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to create prescription.' })
  }
})

/* PATCH /api/prescriptions/:id/dispense — pharmacist dispenses */
router.patch('/:id/dispense', requireAuth, requireRole(['Admin','Pharmacist']), async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE prescriptions SET status='Dispensed', dispensed_by=$1, dispensed_at=NOW(), updated_at=NOW()
      WHERE id=$2 RETURNING *
    `, [req.user.id, req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Prescription not found.' })
    await audit(req,'DISPENSE_PRESCRIPTION','prescription',req.params.id)
    res.json({ prescription: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispense.' })
  }
})

module.exports = router
