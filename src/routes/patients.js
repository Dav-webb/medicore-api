const router = require('express').Router()
const { body, query, validationResult } = require('express-validator')
const pool = require('../db/pool')
const { requireAuth, requireRole } = require('../middleware/auth')
const { audit } = require('../middleware/audit')

const canViewPatients  = ['Admin','Doctor','Nurse','Receptionist']
const canWritePatients = ['Admin','Receptionist']

/* GET /api/patients — search + paginate */
router.get('/', requireAuth, requireRole(canViewPatients), async (req, res) => {
  try {
    const { search='', gender='', insurance='', status='', sort='name', page=1, limit=20 } = req.query
    const offset = (Math.max(1,parseInt(page))-1) * Math.min(50,parseInt(limit))
    const lim    = Math.min(50, parseInt(limit))

    let where = ['1=1']
    let params = []
    let idx = 1

    if (search) {
      where.push(`(LOWER(first_name||' '||last_name) LIKE $${idx} OR file_no LIKE $${idx} OR phone LIKE $${idx} OR nhis_no LIKE $${idx})`)
      params.push(`%${search.toLowerCase()}%`)
      idx++
    }
    if (gender)    { where.push(`gender=$${idx++}`);    params.push(gender) }
    if (insurance) { where.push(`CASE WHEN nhis_no IS NOT NULL AND nhis_no!='' THEN 'NHIS' ELSE 'Cash' END=$${idx++}`); params.push(insurance) }
    if (status)    { where.push(`is_active=$${idx++}`); params.push(status==='Active') }

    const orderMap = { name:'last_name,first_name', date:'created_at DESC', file:'file_no' }
    const orderBy  = orderMap[sort] || 'last_name,first_name'

    const countRes = await pool.query(`SELECT COUNT(*) FROM patients WHERE ${where.join(' AND ')}`, params)
    const dataRes  = await pool.query(
      `SELECT id,file_no,first_name,last_name,gender,dob,phone,blood_group,nhis_no,allergies,is_active,created_at,
              EXTRACT(YEAR FROM AGE(dob)) AS age,
              CASE WHEN nhis_no IS NOT NULL AND nhis_no!='' THEN 'NHIS' ELSE 'Cash' END AS insurance
       FROM patients WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, lim, offset]
    )

    await audit(req, 'LIST_PATIENTS', 'patient', null, { search, count: dataRes.rows.length })

    res.json({
      patients: dataRes.rows,
      total:    parseInt(countRes.rows[0].count),
      page:     parseInt(page),
      pages:    Math.ceil(parseInt(countRes.rows[0].count) / lim)
    })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch patients.' })
  }
})

/* GET /api/patients/:id */
router.get('/:id', requireAuth, requireRole(canViewPatients), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *, EXTRACT(YEAR FROM AGE(dob)) AS age,
              CASE WHEN nhis_no IS NOT NULL AND nhis_no!='' THEN 'NHIS' ELSE 'Cash' END AS insurance
       FROM patients WHERE id=$1 OR file_no=$1`, [req.params.id]
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Patient not found.' })

    await audit(req, 'VIEW_PATIENT', 'patient', result.rows[0].id)
    res.json({ patient: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch patient.' })
  }
})

/* POST /api/patients — register new patient */
const patientValidation = [
  body('first_name').trim().isLength({min:1,max:80}).withMessage('First name required.'),
  body('last_name').trim().isLength({min:1,max:80}).withMessage('Last name required.'),
  body('gender').isIn(['Male','Female','Other']).withMessage('Valid gender required.'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number required.'),
]
router.post('/', requireAuth, requireRole(canWritePatients), patientValidation, async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg })

  try {
    const { first_name, last_name, other_names, gender, dob, phone, alt_phone, email,
            blood_group, nhis_no, nhis_expiry, nhis_type, ghana_card, religion,
            marital_status, occupation, employer, region, district, address,
            next_of_kin, nok_relation, nok_phone, allergies, ref_source } = req.body

    // Generate file number
    const seq = await pool.query('SELECT COUNT(*)+1 AS n FROM patients')
    const year = new Date().getFullYear()
    const file_no = `P-${String(parseInt(seq.rows[0].n) + 1000).padStart(4,'0')}`

    const result = await pool.query(`
      INSERT INTO patients
        (file_no,first_name,last_name,other_names,gender,dob,phone,alt_phone,email,
         blood_group,nhis_no,nhis_expiry,nhis_type,ghana_card,religion,marital_status,
         occupation,employer,region,district,address,next_of_kin,nok_relation,nok_phone,
         allergies,ref_source,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      RETURNING *
    `, [file_no,first_name,last_name,other_names||null,gender,dob||null,phone||null,
        alt_phone||null,email||null,blood_group||null,nhis_no||null,nhis_expiry||null,
        nhis_type||null,ghana_card||null,religion||null,marital_status||null,
        occupation||null,employer||null,region||null,district||null,address||null,
        next_of_kin||null,nok_relation||null,nok_phone||null,allergies||null,
        ref_source||null,req.user.id])

    await audit(req, 'REGISTER_PATIENT', 'patient', result.rows[0].id, { file_no, name:`${first_name} ${last_name}` })
    res.status(201).json({ patient: result.rows[0], message: `Patient registered as ${file_no}` })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to register patient.' })
  }
})

/* PUT /api/patients/:id */
router.put('/:id', requireAuth, requireRole(['Admin','Receptionist','Doctor']), async (req, res) => {
  try {
    const allowed = ['first_name','last_name','other_names','phone','alt_phone','email','address',
                     'nhis_no','nhis_expiry','nhis_type','allergies','blood_group','region','district',
                     'next_of_kin','nok_relation','nok_phone','occupation','employer']
    const updates = []
    const values  = []
    let idx = 1
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field}=$${idx++}`)
        values.push(req.body[field])
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' })
    values.push(req.params.id)
    const result = await pool.query(
      `UPDATE patients SET ${updates.join(',')},updated_at=NOW() WHERE id=$${idx} RETURNING *`,
      values
    )
    if (!result.rows.length) return res.status(404).json({ error: 'Patient not found.' })
    await audit(req, 'UPDATE_PATIENT', 'patient', req.params.id, { fields: Object.keys(req.body) })
    res.json({ patient: result.rows[0] })
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update patient.' })
  }
})

module.exports = router
