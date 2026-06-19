const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

/* GET /api/dashboard/stats — role-aware stats */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const role  = req.user.role

    // Every role gets these base counts
    const patientsToday = await pool.query(
      `SELECT COUNT(*) FROM encounters WHERE encounter_date=$1`, [today]
    )
    const totalPatients = await pool.query(`SELECT COUNT(*) FROM patients WHERE is_active=TRUE`)

    let stats = {
      patientsToday: parseInt(patientsToday.rows[0].count),
      totalPatients: parseInt(totalPatients.rows[0].count),
    }

    if (['Admin','Accountant'].includes(role)) {
      const revenue = await pool.query(
        `SELECT COALESCE(SUM(total_paid),0) AS total FROM invoices WHERE DATE(issued_at)=$1 AND status='Paid'`, [today]
      )
      const pending = await pool.query(
        `SELECT COUNT(*) FROM invoices WHERE status='Draft' OR status='Pending'`
      )
      stats.revenueToday    = parseFloat(revenue.rows[0].total)
      stats.pendingInvoices = parseInt(pending.rows[0].count)
    }

    if (['Admin','Pharmacist'].includes(role)) {
      const lowStock = await pool.query(
        `SELECT COUNT(*) FROM inventory WHERE quantity_in_stock <= reorder_level AND is_active=TRUE`
      )
      const rxPending = await pool.query(`SELECT COUNT(*) FROM prescriptions WHERE status='Pending'`)
      stats.lowStockItems = parseInt(lowStock.rows[0].count)
      stats.rxPending     = parseInt(rxPending.rows[0].count)
    }

    if (['Admin','Lab Tech'].includes(role)) {
      const labPending = await pool.query(`SELECT COUNT(*) FROM lab_orders WHERE status='Pending' OR status='Processing'`)
      const labStat    = await pool.query(`SELECT COUNT(*) FROM lab_orders WHERE priority='STAT' AND status!='Completed'`)
      stats.labPending = parseInt(labPending.rows[0].count)
      stats.labStat    = parseInt(labStat.rows[0].count)
    }

    if (['Admin','Doctor','Nurse','Receptionist'].includes(role)) {
      const queue = await pool.query(
        `SELECT status, COUNT(*) FROM encounters WHERE encounter_date=$1 GROUP BY status`, [today]
      )
      stats.queueByStatus = Object.fromEntries(queue.rows.map(r => [r.status, parseInt(r.count)]))
    }

    if (['Admin','Doctor'].includes(role)) {
      const appts = await pool.query(
        `SELECT COUNT(*) FROM appointments WHERE scheduled_date=$1`, [today]
      )
      stats.appointmentsToday = parseInt(appts.rows[0].count)
    }

    // Recent OPD queue (all clinical roles)
    const queue = await pool.query(`
      SELECT e.id, e.opd_no, e.status, e.priority, e.department, e.check_in_time,
             p.first_name||' '||p.last_name AS patient_name, p.file_no,
             EXTRACT(YEAR FROM AGE(p.dob))::int AS age,
             CASE WHEN p.nhis_no IS NOT NULL AND p.nhis_no!='' THEN true ELSE false END AS is_nhis
      FROM encounters e JOIN patients p ON e.patient_id=p.id
      WHERE e.encounter_date=$1 ORDER BY e.check_in_time ASC LIMIT 15
    `, [today])
    stats.liveQueue = queue.rows

    res.json({ stats, role, timestamp: new Date().toISOString() })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to load dashboard.' })
  }
})

/* GET /api/dashboard/notifications */
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20
    `, [req.user.id])
    res.json({ notifications: result.rows })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' })
  }
})

module.exports = router
