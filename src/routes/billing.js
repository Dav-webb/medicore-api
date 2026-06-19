const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

const canBill = ['Admin','Accountant','Receptionist']

/* GET /api/billing */
router.get('/', requireAuth, requireRole(['Admin','Accountant']), async (req, res) => {
  try {
    const { status, date, limit=20, page=1 } = req.query
    const offset = (Math.max(1,parseInt(page))-1) * parseInt(limit)
    let where = ['1=1'], params = [], idx = 1
    if (status) { where.push(`i.status=$${idx++}`); params.push(status) }
    if (date)   { where.push(`DATE(i.issued_at)=$${idx++}`); params.push(date) }

    const result = await pool.query(`
      SELECT i.*, p.first_name||' '||p.last_name AS patient_name, p.file_no,
             u.name AS created_by_name
      FROM invoices i
      JOIN patients p ON i.patient_id=p.id
      LEFT JOIN users u ON i.created_by=u.id
      WHERE ${where.join(' AND ')}
      ORDER BY i.issued_at DESC LIMIT $${idx} OFFSET $${idx+1}
    `, [...params, parseInt(limit), offset])

    const totals = await pool.query(`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount
      FROM invoices GROUP BY status
    `)
    res.json({ invoices: result.rows, summary: totals.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch invoices.' })
  }
})

/* POST /api/billing — create invoice */
router.post('/', requireAuth, requireRole(canBill), async (req, res) => {
  try {
    const { patient_id, encounter_id, items, is_nhis, nhis_claim_no, payment_method, notes } = req.body
    if (!patient_id || !items?.length) return res.status(400).json({ error: 'Patient and items required.' })

    const year  = new Date().getFullYear()
    const seq   = await pool.query('SELECT COUNT(*)+1 AS n FROM invoices')
    const inv_no = `INV/${year}/${String(parseInt(seq.rows[0].n)).padStart(5,'0')}`

    const subtotal    = items.reduce((s,i) => s + (i.qty * i.unit_price), 0)
    const nhis_amount = is_nhis ? items.reduce((s,i) => s + (i.nhis_covered||0), 0) : 0
    const total_amount = subtotal
    const total_paid   = payment_method ? total_amount - nhis_amount : 0
    const status       = total_paid >= total_amount ? 'Paid' : (payment_method ? 'Partial' : 'Pending')

    const result = await pool.query(`
      INSERT INTO invoices (inv_no,patient_id,encounter_id,items,subtotal,nhis_amount,
        total_amount,total_paid,status,is_nhis,nhis_claim_no,payment_method,notes,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [inv_no,patient_id,encounter_id||null,JSON.stringify(items),subtotal,nhis_amount,
        total_amount,total_paid,status,is_nhis||false,nhis_claim_no||null,
        payment_method||null,notes||null,req.user.id])

    await audit(req,'CREATE_INVOICE','invoice',result.rows[0].id,{inv_no,total_amount,status})
    res.status(201).json({ invoice: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to create invoice.' })
  }
})

/* PATCH /api/billing/:id/pay — record payment */
router.patch('/:id/pay', requireAuth, requireRole(canBill), async (req, res) => {
  try {
    const { amount_paid, payment_method } = req.body
    if (!amount_paid || !payment_method) return res.status(400).json({ error: 'Amount and method required.' })

    const inv = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id])
    if (!inv.rows.length) return res.status(404).json({ error: 'Invoice not found.' })
    const invoice = inv.rows[0]

    const new_paid  = parseFloat(invoice.total_paid) + parseFloat(amount_paid)
    const new_status = new_paid >= parseFloat(invoice.total_amount) ? 'Paid' : 'Partial'

    const result = await pool.query(`
      UPDATE invoices SET total_paid=$1, status=$2, payment_method=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [new_paid, new_status, payment_method, req.params.id])

    await audit(req,'RECORD_PAYMENT','invoice',req.params.id,{amount_paid,payment_method,new_status})
    res.json({ invoice: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to record payment.' })
  }
})

/* GET /api/billing/revenue — revenue summary for admin/accountant */
router.get('/revenue', requireAuth, requireRole(['Admin','Accountant']), async (req, res) => {
  try {
    const { period='week' } = req.query
    const interval = period==='month' ? '30 days' : period==='year' ? '365 days' : '7 days'

    const daily = await pool.query(`
      SELECT DATE(issued_at) AS date, COALESCE(SUM(total_paid),0) AS revenue,
             COUNT(*) AS invoices, SUM(CASE WHEN is_nhis THEN total_paid ELSE 0 END) AS nhis_revenue
      FROM invoices
      WHERE issued_at >= NOW()-INTERVAL '${interval}' AND status IN ('Paid','Partial')
      GROUP BY DATE(issued_at) ORDER BY date
    `)
    const breakdown = await pool.query(`
      SELECT payment_method, COUNT(*) AS count, SUM(total_paid) AS total
      FROM invoices WHERE issued_at >= NOW()-INTERVAL '${interval}' AND payment_method IS NOT NULL
      GROUP BY payment_method
    `)
    res.json({ daily: daily.rows, breakdown: breakdown.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch revenue.' })
  }
})

module.exports = router
