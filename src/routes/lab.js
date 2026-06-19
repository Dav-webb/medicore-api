const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

/* GET /api/lab — list lab orders */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, priority, limit=20, page=1 } = req.query
    const offset = (Math.max(1,parseInt(page))-1) * parseInt(limit)
    let where = ['1=1'], params = [], idx = 1
    if (status)   { where.push(`lo.status=$${idx++}`);   params.push(status) }
    if (priority) { where.push(`lo.priority=$${idx++}`); params.push(priority) }

    const result = await pool.query(`
      SELECT lo.*, p.first_name||' '||p.last_name AS patient_name, p.file_no,
             req.name AS requested_by_name, tech.name AS tech_name
      FROM lab_orders lo
      JOIN patients p ON lo.patient_id=p.id
      LEFT JOIN users req  ON lo.requested_by=req.id
      LEFT JOIN users tech ON lo.assigned_tech=tech.id
      WHERE ${where.join(' AND ')}
      ORDER BY lo.priority DESC, lo.created_at ASC
      LIMIT $${idx} OFFSET $${idx+1}
    `, [...params, parseInt(limit), offset])
    res.json({ orders: result.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch lab orders.' })
  }
})

/* POST /api/lab — request lab test */
router.post('/', requireAuth, requireRole(['Admin','Doctor','Nurse']), async (req, res) => {
  try {
    const { patient_id, encounter_id, tests, priority, clinical_notes } = req.body
    if (!patient_id || !tests?.length) return res.status(400).json({ error: 'Patient and tests required.' })

    const year = new Date().getFullYear()
    const seq  = await pool.query('SELECT COUNT(*)+1 AS n FROM lab_orders')
    const lab_no = `LAB/${year}/${String(parseInt(seq.rows[0].n)).padStart(4,'0')}`

    const result = await pool.query(`
      INSERT INTO lab_orders (lab_no,patient_id,encounter_id,requested_by,tests,priority,clinical_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [lab_no,patient_id,encounter_id||null,req.user.id,
        JSON.stringify(tests),priority||'Routine',clinical_notes||null])

    await audit(req,'REQUEST_LAB','lab_order',result.rows[0].id,{lab_no,tests:tests.length})
    res.status(201).json({ order: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to create lab order.' })
  }
})

/* PATCH /api/lab/:id/result — lab tech enters results */
router.patch('/:id/result', requireAuth, requireRole(['Admin','Lab Tech']), async (req, res) => {
  try {
    const { results, interpretation, status='Completed' } = req.body
    const result = await pool.query(`
      UPDATE lab_orders SET results=$1, interpretation=$2, status=$3,
        assigned_tech=$4, completed_at=NOW(), updated_at=NOW()
      WHERE id=$5 RETURNING *
    `, [JSON.stringify(results||{}), interpretation||null, status, req.user.id, req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Lab order not found.' })
    await audit(req,'ENTER_LAB_RESULT','lab_order',req.params.id)
    res.json({ order: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to enter results.' })
  }
})

module.exports = router
