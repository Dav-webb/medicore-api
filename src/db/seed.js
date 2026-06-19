/**
 * MediCore AI — Database Seed
 * Inserts demo staff accounts with hashed passwords + sample patients.
 * Run: node src/db/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { Client } = require('pg')
const bcrypt = require('bcryptjs')

const STAFF = [
  { username:'admin',        password:'Admin@2025',   name:'System Administrator',    role:'Admin',        dept:'IT / Administration',  initials:'SA', color:'#374151' },
  { username:'dr.mensah',    password:'Doctor@2025',  name:'Dr. Alex Mensah',         role:'Admin',        dept:'Administration',        initials:'AM', color:'#2563EB' },
  { username:'dr.owusu',     password:'Doctor@2025',  name:'Dr. Esi Owusu',           role:'Doctor',       dept:'General Medicine',      initials:'EO', color:'#7C3AED' },
  { username:'dr.agyei',     password:'Doctor@2025',  name:'Dr. Rexford Agyei',       role:'Doctor',       dept:'OB/GYN',                initials:'RA', color:'#0891B2' },
  { username:'nurse.abena',  password:'Nurse@2025',   name:'Nurse Abena Asare',       role:'Nurse',        dept:'OPD / Triage',          initials:'AA', color:'#059669' },
  { username:'nurse.kofi',   password:'Nurse@2025',   name:'Nurse Kofi Darko',        role:'Nurse',        dept:'Paediatrics',           initials:'KD', color:'#10B981' },
  { username:'pharma.kwesi', password:'Pharma@2025',  name:'Kwesi Acheampong',        role:'Pharmacist',   dept:'Pharmacy',              initials:'KA', color:'#F59E0B' },
  { username:'lab.akua',     password:'Lab@2025',     name:'Akua Frimpong',           role:'Lab Tech',     dept:'Laboratory',            initials:'AF', color:'#EF4444' },
  { username:'rec.yaa',      password:'Recep@2025',   name:'Yaa Amponsah',            role:'Receptionist', dept:'Reception',             initials:'YA', color:'#EC4899' },
  { username:'acct.nana',    password:'Acct@2025',    name:'Nana Boateng',            role:'Accountant',   dept:'Finance & Accounts',    initials:'NB', color:'#8B5CF6' },
]

const PATIENTS = [
  { file_no:'P-1042', first_name:'Kofi',    last_name:'Asante',     gender:'Male',   dob:'1991-03-15', phone:'0244-123-456', blood_group:'O+',  nhis_no:'NHIS-109832', allergies:'Penicillin', address:'12 Legon Road, Accra' },
  { file_no:'P-1041', first_name:'Abena',   last_name:'Mensah',     gender:'Female', dob:'1997-06-22', phone:'0554-789-012', blood_group:'A+',  nhis_no:'NHIS-204411', allergies:'',           address:'45 Tema Motorway, Accra' },
  { file_no:'P-1040', first_name:'Kwame',   last_name:'Oti',        gender:'Male',   dob:'1969-11-08', phone:'0200-345-678', blood_group:'B+',  nhis_no:'NHIS-331021', allergies:'Sulfa drugs',address:'7 Ring Road West, Kumasi' },
  { file_no:'P-1039', first_name:'Yaa',     last_name:'Asantewaa',  gender:'Female', dob:'1993-04-30', phone:'0244-901-234', blood_group:'AB-', nhis_no:'NHIS-097213', allergies:'',           address:'22 Liberation Rd, Accra' },
  { file_no:'P-1038', first_name:'Ama',     last_name:'Boateng',    gender:'Female', dob:'2001-09-12', phone:'0557-567-890', blood_group:'O+',  nhis_no:'NHIS-118763', allergies:'',           address:'5 Tantra Hill, Accra' },
  { file_no:'P-1037', first_name:'Akwasi',  last_name:'Frimpong',   gender:'Male',   dob:'1980-02-18', phone:'0244-234-567', blood_group:'A-',  nhis_no:'',            allergies:'NSAIDs',     address:'18 Spintex Road, Accra' },
  { file_no:'P-1036', first_name:'Efua',    last_name:'Asare',      gender:'Female', dob:'1958-07-03', phone:'0200-890-123', blood_group:'B-',  nhis_no:'NHIS-445870', allergies:'',           address:'3 Harper Road, Cape Coast' },
  { file_no:'P-1035', first_name:'Kweku',   last_name:'Mensah',     gender:'Male',   dob:'2006-01-25', phone:'0556-456-789', blood_group:'O-',  nhis_no:'',            allergies:'',           address:'Student Hostel, Legon' },
]

async function seed() {
  const cfg = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : { host:process.env.DB_HOST, port:process.env.DB_PORT, database:process.env.DB_NAME, user:process.env.DB_USER, password:process.env.DB_PASSWORD }
  const client = new Client(cfg)
  await client.connect()

  console.log('🌱 Seeding database...')
  const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12

  // Seed staff
  for (const s of STAFF) {
    const hash = await bcrypt.hash(s.password, rounds)
    await client.query(`
      INSERT INTO users (username, password_hash, name, role, department, initials, color)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (username) DO UPDATE SET
        password_hash=$2, name=$3, role=$4, department=$5, initials=$6, color=$7
    `, [s.username, hash, s.name, s.role, s.dept, s.initials, s.color])
    console.log(`  ✅ Staff: ${s.username} (${s.role})`)
  }

  // Seed patients
  for (const p of PATIENTS) {
    await client.query(`
      INSERT INTO patients (file_no,first_name,last_name,gender,dob,phone,blood_group,nhis_no,allergies,address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (file_no) DO UPDATE SET
        first_name=$2, last_name=$3, gender=$4, phone=$6
    `, [p.file_no,p.first_name,p.last_name,p.gender,p.dob||null,p.phone,p.blood_group||null,p.nhis_no||null,p.allergies||null,p.address||null])
    console.log(`  ✅ Patient: ${p.file_no} — ${p.first_name} ${p.last_name}`)
  }

  // Seed basic drug inventory
  const drugs = [
    ['Artemether-Lumefantrine 20/120mg','Antimalarial','Tablet','20/120mg','tabs',120,50,2.50,3.80,true],
    ['Amoxicillin 500mg','Antibiotic','Capsule','500mg','caps',200,50,0.45,0.80,true],
    ['Paracetamol 500mg','Analgesic','Tablet','500mg','tabs',500,200,0.08,0.15,true],
    ['Metformin 500mg','Antidiabetic','Tablet','500mg','tabs',300,100,0.35,0.60,true],
    ['Amlodipine 5mg','Antihypertensive','Tablet','5mg','tabs',250,100,0.50,0.90,true],
    ['Artesunate IV 60mg','Antimalarial','Injection','60mg','vials',8,10,18.00,25.00,true],
    ['Ceftriaxone 1g','Antibiotic','Injection','1g','vials',15,20,8.50,14.00,true],
    ['ORS Sachet','Rehydration','Sachet','Std','sachets',150,50,0.20,0.40,true],
    ['Ferrous Sulphate 200mg','Haematinic','Tablet','200mg','tabs',400,100,0.10,0.20,true],
    ['Folic Acid 5mg','Vitamin','Tablet','5mg','tabs',350,100,0.05,0.10,true],
  ]
  const expiry = new Date(); expiry.setFullYear(expiry.getFullYear() + 2)
  for (const d of drugs) {
    await client.query(`
      INSERT INTO inventory (drug_name,category,form,strength,unit,quantity_in_stock,reorder_level,unit_cost,selling_price,ghana_edl,expiry_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT DO NOTHING
    `, [...d, expiry.toISOString().split('T')[0]])
    console.log(`  ✅ Drug: ${d[0]}`)
  }

  console.log('\n🎉 Database seeded successfully!')
  console.log('\n📋 Login Credentials (updated — stronger passwords):')
  STAFF.forEach(s => console.log(`   ${s.username.padEnd(18)} / ${s.password}  [${s.role}]`))
  await client.end()
  process.exit(0)
}

seed().catch(e => { console.error('❌ Seed error:', e.message); process.exit(1) })
