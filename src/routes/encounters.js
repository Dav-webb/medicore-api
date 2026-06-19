const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

/* GET /api/encounters/today — today's OPD queue */
router.get('/today', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const result = await pool.query(`
      SELECT e.*,
             p.first_name||' '||p.last_name AS patient_name, p.file_no, p.phone, p.allergies,
             EXTRACT(YEAR FROM AGE(p.dob))::int AS age,
             CASE WHEN p.nhis_no IS NOT NULL AND p.nhis_no!='' THEN true ELSE false END AS is_nhis,
             u.name AS doctor_name
      FROM encounters e
      JOIN patients p ON e.patient_id=p.id
      LEFT JOIN users u ON e.assigned_doctor=u.id
      WHERE e.encounter_date=$1
      ORDER BY e.check_in_time ASC
    `, [today])
    res.json({ encounters: result.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch queue.' })
  }
})

/* POST /api/encounters — check in patient to OPD */
router.post('/', requireAuth, requireRole(['Admin','Receptionist','Nurse']), async (req, res) => {
  try {
    const { patient_id, department, priority, visit_type, is_nhis, assigned_doctor } = req.body
    if (!patient_id) return res.status(400).json({ error: 'Patient ID required.' })

    const today = new Date().toISOString().split('T')[0]
    const year  = new Date().getFullYear()
    const seq   = await pool.query('SELECT COUNT(*)+1 AS n FROM encounters WHERE encounter_date=$1', [today])
    const opd_no = `OPD/${year}/${String(parseInt(seq.rows[0].n)).padStart(4,'0')}`

    const result = await pool.query(`
      INSERT INTO encounters (patient_id,opd_no,department,priority,visit_type,is_nhis,assigned_doctor,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [patient_id,opd_no,department||'General Medicine',priority||'Normal',
        visit_type||'New',is_nhis||false,assigned_doctor||null,req.user.id])

    await audit(req,'CHECK_IN_PATIENT','encounter',result.rows[0].id,{opd_no,patient_id})
    res.status(201).json({ encounter: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to create encounter.' })
  }
})

/* PATCH /api/encounters/:id/status — advance queue status */
const STATUS_FLOW = {
  'Registered': 'Triage', 'Triage': 'Waiting', 'Waiting': 'With Doctor',
  'With Doctor': 'In Lab', 'In Lab': 'Pharmacy', 'Pharmacy': 'Billing', 'Billing': 'Completed'
}
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body
    const current = await pool.query('SELECT * FROM encounters WHERE id=$1', [req.params.id])
    if (!current.rows.length) return res.status(404).json({ error: 'Encounter not found.' })

    const checkOut = status === 'Completed' ? 'NOW()' : 'check_out_time'
    const result = await pool.query(
      `UPDATE encounters SET status=$1, check_out_time=${checkOut}, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    )
    await audit(req,'UPDATE_ENCOUNTER_STATUS','encounter',req.params.id,{from:current.rows[0].status,to:status})
    res.json({ encounter: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update status.' })
  }
})

/* POST /api/encounters/:id/vitals */
router.post('/:id/vitals', requireAuth, requireRole(['Admin','Nurse','Doctor']), async (req, res) => {
  try {
    const enc = await pool.query('SELECT * FROM encounters WHERE id=$1', [req.params.id])
    if (!enc.rows.length) return res.status(404).json({ error: 'Encounter not found.' })

    const { bp_systolic,bp_diastolic,pulse,temperature,spo2,respiratory_rate,weight_kg,height_cm,blood_glucose,pain_score,notes } = req.body
    const result = await pool.query(`
      INSERT INTO vitals (encounter_id,patient_id,recorded_by,bp_systolic,bp_diastolic,pulse,temperature,spo2,respiratory_rate,weight_kg,height_cm,blood_glucose,pain_score,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [req.params.id,enc.rows[0].patient_id,req.user.id,
        bp_systolic||null,bp_diastolic||null,pulse||null,temperature||null,spo2||null,
        respiratory_rate||null,weight_kg||null,height_cm||null,blood_glucose||null,
        pain_score||null,notes||null])

    // Advance status to Waiting after vitals
    await pool.query(`UPDATE encounters SET status='Waiting',updated_at=NOW() WHERE id=$1 AND status='Triage'`, [req.params.id])
    await audit(req,'RECORD_VITALS','encounter',req.params.id)
    res.status(201).json({ vitals: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to record vitals.' })
  }
})

/* GET /api/encounters/:id/vitals */
router.get('/:id/vitals', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.*, u.name AS recorded_by_name FROM vitals v LEFT JOIN users u ON v.recorded_by=u.id WHERE v.encounter_id=$1 ORDER BY v.recorded_at DESC`,
      [req.params.id]
    )
    res.json({ vitals: result.rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vitals.' })
  }
})

module.exports = router
