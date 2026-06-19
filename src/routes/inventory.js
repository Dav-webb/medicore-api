const router = require('express').Router()
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

/* GET /api/inventory */
router.get('/', requireAuth, requireRole(['Admin','Pharmacist']), async (req, res) => {
  try {
    const { search='', lowStock, limit=50, page=1 } = req.query
    const offset = (Math.max(1,parseInt(page))-1) * parseInt(limit)
    let where = ['is_active=TRUE'], params = [], idx = 1
    if (search) { where.push(`LOWER(drug_name) LIKE $${idx++}`); params.push(`%${search.toLowerCase()}%`) }
    if (lowStock==='true') where.push('quantity_in_stock <= reorder_level')

    const result = await pool.query(`
      SELECT * FROM inventory WHERE ${where.join(' AND ')} ORDER BY drug_name LIMIT $${idx} OFFSET $${idx+1}
    `, [...params, parseInt(limit), offset])
    res.json({ items: result.rows })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch inventory.' })
  }
})

/* POST /api/inventory — add drug */
router.post('/', requireAuth, requireRole(['Admin','Pharmacist']), async (req, res) => {
  try {
    const { drug_name, generic_name, category, dosage_form, strength, unit_price,
            nhis_price, quantity_in_stock, reorder_level, expiry_date, supplier, batch_no } = req.body
    if (!drug_name) return res.status(400).json({ error: 'Drug name required.' })

    const result = await pool.query(`
      INSERT INTO inventory (drug_name,generic_name,category,dosage_form,strength,unit_price,
        nhis_price,quantity_in_stock,reorder_level,expiry_date,supplier,batch_no,added_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [drug_name,generic_name||null,category||null,dosage_form||null,strength||null,
        unit_price||0,nhis_price||null,quantity_in_stock||0,reorder_level||10,
        expiry_date||null,supplier||null,batch_no||null,req.user.id])

    await audit(req,'ADD_DRUG','inventory',result.rows[0].id,{drug_name})
    res.status(201).json({ item: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to add drug.' })
  }
})

/* PATCH /api/inventory/:id/stock — adjust stock quantity */
router.patch('/:id/stock', requireAuth, requireRole(['Admin','Pharmacist']), async (req, res) => {
  try {
    const { adjustment, reason } = req.body
    if (adjustment === undefined) return res.status(400).json({ error: 'Adjustment quantity required.' })

    const result = await pool.query(`
      UPDATE inventory SET quantity_in_stock=quantity_in_stock+$1, updated_at=NOW()
      WHERE id=$2 RETURNING *
    `, [parseInt(adjustment), req.params.id])
    if (!result.rows.length) return res.status(404).json({ error: 'Drug not found.' })
    await audit(req,'ADJUST_STOCK','inventory',req.params.id,{adjustment,reason})
    res.json({ item: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to adjust stock.' })
  }
})

/* PUT /api/inventory/:id */
router.put('/:id', requireAuth, requireRole(['Admin','Pharmacist']), async (req, res) => {
  try {
    const allowed = ['drug_name','generic_name','category','dosage_form','strength',
                     'unit_price','nhis_price','reorder_level','expiry_date','supplier','batch_no']
    const updates = [], values = []
    let idx = 1
    for (const field of allowed) {
      if (req.body[field] !== undefined) { updates.push(`${field}=$${idx++}`); values.push(req.body[field]) }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' })
    values.push(req.params.id)
    const result = await pool.query(
      `UPDATE inventory SET ${updates.join(',')},updated_at=NOW() WHERE id=$${idx} RETURNING *`, values
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Drug not found.' })
    res.json({ item: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update drug.' })
  }
})

module.exports = router
