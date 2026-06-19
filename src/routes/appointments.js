const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

/* GET /api/appointments */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { date, status, doctor_id, limit=20, page=1 } = req.query
    const offset = (Math.max(1,parseInt(page))-1) * parseInt(limit)
    let where = ['1=1'], params = [], idx = 1

    if (date)      { where.push(`a.scheduled_date=$${idx++}`);   params.push(date) }
    if (status)    { where.push(`a.status=$${idx++}`);           params.push(status) }
    if (doctor_id) { where.push(`a.assigned_doctor=$${idx++}`);  params.push(doctor_id) }
    if (req.user.role === 'Doctor') { where.push(`a.assigned_doctor=$${idx++}`); params.push(req.user.id) }

    const result = await pool.query(`
      SELECT a.*, p.first_name||' '||p.last_name AS patient_name, p.file_no, p.phone,
             EXTRACT(YEAR FROM AGE(p.dob))::int AS age,
             u.name AS doctor_name
      FROM appointments a
      JOIN patients p ON a.patient_id=p.id
      LEFT JOIN users u ON a.assigned_doctor=u.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.scheduled_date, a.scheduled_time LIMIT $${idx} OFFSET $${idx+1}
    `, [...params, parseInt(limit), offset])
    res.json({ appointments: result.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch appointments.' })
  }
})

/* POST /api/appointments */
router.post('/', requireAuth, requireRole(['Admin','Receptionist','Doctor']), async (req, res) => {
  try {
    const { patient_id, assigned_doctor, scheduled_date, scheduled_time, department, visit_type, notes, is_nhis } = req.body
    if (!patient_id || !scheduled_date) return res.status(400).json({ error: 'Patient and date required.' })

    const result = await pool.query(`
      INSERT INTO appointments (patient_id,assigned_doctor,scheduled_date,scheduled_time,
        department,visit_type,notes,is_nhis,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [patient_id,assigned_doctor||null,scheduled_date,scheduled_time||null,
        department||'General Medicine',visit_type||'New',notes||null,is_nhis||false,req.user.id])

    await audit(req,'BOOK_APPOINTMENT','appointment',result.rows[0].id,{patient_id,scheduled_date})
    res.status(201).json({ appointment: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to book appointment.' })
  }
})

/* PATCH /api/appointments/:id */
router.patch('/:id', requireAuth, requireRole(['Admin','Receptionist','Doctor']), async (req, res) => {
  try {
    const allowed = ['status','scheduled_date','scheduled_time','assigned_doctor','department','notes']
    const updates = [], values = []
    let idx = 1
    for (const field of allowed) {
      if (req.body[field] !== undefined) { updates.push(`${field}=$${idx++}`); values.push(req.body[field]) }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' })
    values.push(req.params.id)
    const result = await pool.query(
      `UPDATE appointments SET ${updates.join(',')},updated_at=NOW() WHERE id=$${idx} RETURNING *`, values
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Appointment not found.' })
    await audit(req,'UPDATE_APPOINTMENT','appointment',req.params.id,{fields:Object.keys(req.body)})
    res.json({ appointment: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update appointment.' })
  }
})

/* DELETE /api/appointments/:id — cancel */
router.delete('/:id', requireAuth, requireRole(['Admin','Receptionist']), async (req, res) => {
  try {
    await pool.query(`UPDATE appointments SET status='Cancelled',updated_at=NOW() WHERE id=$1`, [req.params.id])
    await audit(req,'CANCEL_APPOINTMENT','appointment',req.params.id)
    res.json({ message: 'Appointment cancelled.' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel.' })
  }
})

module.exports = router
