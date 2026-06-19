/**
 * MediCore AI — Database Initialisation
 * Creates all tables, indexes, and constraints.
 * Run: node src/db/init.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { Client } = require('pg')

async function initDatabase() {
  // First connect to default postgres DB to create medicore_db if needed
  const adminClient = new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: 'postgres', user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  })

  try {
    await adminClient.connect()
    const exists = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`, [process.env.DB_NAME]
    )
    if (exists.rows.length === 0) {
      await adminClient.query(`CREATE DATABASE ${process.env.DB_NAME}`)
      console.log(`✅ Database '${process.env.DB_NAME}' created.`)
    } else {
      console.log(`ℹ️  Database '${process.env.DB_NAME}' already exists.`)
    }
    await adminClient.end()
  } catch (e) {
    await adminClient.end().catch(() => {})
    console.error('❌ Could not create database:', e.message)
    process.exit(1)
  }

  // Now connect to medicore_db and create schema
  const client = new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  })

  try {
    await client.connect()
    console.log(`🔗 Connected to ${process.env.DB_NAME}`)

    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`)

    // ── USERS ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username      VARCHAR(50)  UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name          VARCHAR(150) NOT NULL,
        role          VARCHAR(50)  NOT NULL CHECK (role IN (
                        'Admin','Doctor','Nurse','Pharmacist',
                        'Lab Tech','Receptionist','Accountant')),
        department    VARCHAR(100),
        email         VARCHAR(150),
        phone         VARCHAR(20),
        staff_id      VARCHAR(30),
        initials      VARCHAR(5),
        color         VARCHAR(10) DEFAULT '#2563EB',
        is_active     BOOLEAN DEFAULT TRUE,
        last_login    TIMESTAMPTZ,
        failed_logins INT DEFAULT 0,
        locked_until  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── REFRESH TOKENS ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
        token       TEXT NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        is_revoked  BOOLEAN DEFAULT FALSE
      )
    `)

    // ── AUDIT LOGS ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id            BIGSERIAL PRIMARY KEY,
        user_id       UUID REFERENCES users(id),
        username      VARCHAR(50),
        action        VARCHAR(100) NOT NULL,
        resource_type VARCHAR(50),
        resource_id   UUID,
        details       JSONB,
        ip_address    VARCHAR(45),
        user_agent    VARCHAR(500),
        status        VARCHAR(10) DEFAULT 'success',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── PATIENTS ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_no          VARCHAR(30) UNIQUE NOT NULL,
        ghana_card       VARCHAR(30),
        nhis_no          VARCHAR(30),
        nhis_expiry      DATE,
        nhis_type        VARCHAR(50),
        nhis_status      VARCHAR(20) DEFAULT 'Unknown',
        first_name       VARCHAR(80) NOT NULL,
        last_name        VARCHAR(80) NOT NULL,
        other_names      VARCHAR(80),
        dob              DATE,
        gender           VARCHAR(10),
        blood_group      VARCHAR(5),
        phone            VARCHAR(20),
        alt_phone        VARCHAR(20),
        email            VARCHAR(150),
        religion         VARCHAR(50),
        marital_status   VARCHAR(20),
        nationality      VARCHAR(60) DEFAULT 'Ghanaian',
        occupation       VARCHAR(100),
        employer         VARCHAR(150),
        region           VARCHAR(100),
        district         VARCHAR(100),
        address          TEXT,
        next_of_kin      VARCHAR(150),
        nok_relation     VARCHAR(50),
        nok_phone        VARCHAR(20),
        allergies        TEXT,
        chronic_conditions TEXT,
        ref_source       VARCHAR(50),
        is_active        BOOLEAN DEFAULT TRUE,
        created_by       UUID REFERENCES users(id),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── APPOINTMENTS ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id     UUID REFERENCES patients(id),
        doctor_id      UUID REFERENCES users(id),
        patient_name   VARCHAR(200),
        patient_pid    VARCHAR(30),
        department     VARCHAR(100),
        type           VARCHAR(80),
        scheduled_date DATE NOT NULL,
        scheduled_time VARCHAR(10),
        duration_min   INT DEFAULT 20,
        status         VARCHAR(30) DEFAULT 'Scheduled',
        notes          TEXT,
        is_nhis        BOOLEAN DEFAULT FALSE,
        booked_by      UUID REFERENCES users(id),
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── OPD ENCOUNTERS ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS encounters (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id       UUID REFERENCES patients(id),
        opd_no           VARCHAR(30) UNIQUE NOT NULL,
        encounter_date   DATE DEFAULT CURRENT_DATE,
        check_in_time    TIMESTAMPTZ DEFAULT NOW(),
        check_out_time   TIMESTAMPTZ,
        status           VARCHAR(30) DEFAULT 'Registered',
        department       VARCHAR(100),
        priority         VARCHAR(20) DEFAULT 'Normal',
        triage_level     VARCHAR(10),
        assigned_doctor  UUID REFERENCES users(id),
        assigned_nurse   UUID REFERENCES users(id),
        visit_type       VARCHAR(30) DEFAULT 'New',
        is_nhis          BOOLEAN DEFAULT FALSE,
        created_by       UUID REFERENCES users(id),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── VITAL SIGNS ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS vitals (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id     UUID REFERENCES encounters(id),
        patient_id       UUID REFERENCES patients(id),
        recorded_by      UUID REFERENCES users(id),
        bp_systolic      SMALLINT,
        bp_diastolic     SMALLINT,
        pulse            SMALLINT,
        temperature      DECIMAL(4,1),
        spo2             SMALLINT,
        respiratory_rate SMALLINT,
        weight_kg        DECIMAL(5,1),
        height_cm        DECIMAL(5,1),
        blood_glucose    DECIMAL(5,1),
        pain_score       SMALLINT CHECK (pain_score BETWEEN 0 AND 10),
        notes            TEXT,
        recorded_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── CONSULTATIONS ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        encounter_id     UUID REFERENCES encounters(id),
        patient_id       UUID REFERENCES patients(id),
        doctor_id        UUID REFERENCES users(id),
        chief_complaint  TEXT,
        history          TEXT,
        examination      TEXT,
        assessment       TEXT,
        plan             TEXT,
        diagnoses        JSONB DEFAULT '[]',
        follow_up_date   DATE,
        follow_up_notes  TEXT,
        status           VARCHAR(20) DEFAULT 'Draft',
        signed_at        TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── PRESCRIPTIONS ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS prescriptions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rx_no           VARCHAR(30) UNIQUE NOT NULL,
        patient_id      UUID REFERENCES patients(id),
        encounter_id    UUID REFERENCES encounters(id),
        prescriber_id   UUID REFERENCES users(id),
        items           JSONB DEFAULT '[]',
        status          VARCHAR(20) DEFAULT 'Pending',
        is_nhis         BOOLEAN DEFAULT FALSE,
        notes           TEXT,
        dispensed_by    UUID REFERENCES users(id),
        dispensed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── INVENTORY (PHARMACY) ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        drug_name        VARCHAR(200) NOT NULL,
        generic_name     VARCHAR(200),
        category         VARCHAR(100),
        form             VARCHAR(50),
        strength         VARCHAR(50),
        unit             VARCHAR(30) DEFAULT 'tabs',
        batch_no         VARCHAR(50),
        expiry_date      DATE,
        quantity_in_stock INT DEFAULT 0,
        reorder_level    INT DEFAULT 20,
        unit_cost        DECIMAL(10,2) DEFAULT 0,
        selling_price    DECIMAL(10,2) DEFAULT 0,
        ghana_edl        BOOLEAN DEFAULT FALSE,
        is_active        BOOLEAN DEFAULT TRUE,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT positive_stock CHECK (quantity_in_stock >= 0)
      )
    `)

    // ── LAB ORDERS ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS lab_orders (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_no         VARCHAR(30) UNIQUE NOT NULL,
        patient_id       UUID REFERENCES patients(id),
        encounter_id     UUID REFERENCES encounters(id),
        requested_by     UUID REFERENCES users(id),
        tests            JSONB DEFAULT '[]',
        priority         VARCHAR(20) DEFAULT 'Routine',
        status           VARCHAR(30) DEFAULT 'Pending',
        results          JSONB DEFAULT '[]',
        clinical_notes   TEXT,
        is_nhis          BOOLEAN DEFAULT FALSE,
        completed_by     UUID REFERENCES users(id),
        completed_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── BILLING / INVOICES ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_no      VARCHAR(30) UNIQUE NOT NULL,
        patient_id      UUID REFERENCES patients(id),
        encounter_id    UUID REFERENCES encounters(id),
        items           JSONB DEFAULT '[]',
        subtotal        DECIMAL(10,2) DEFAULT 0,
        discount        DECIMAL(10,2) DEFAULT 0,
        nhis_covered    DECIMAL(10,2) DEFAULT 0,
        patient_due     DECIMAL(10,2) DEFAULT 0,
        total_paid      DECIMAL(10,2) DEFAULT 0,
        payment_method  VARCHAR(50),
        status          VARCHAR(30) DEFAULT 'Draft',
        is_nhis         BOOLEAN DEFAULT FALSE,
        issued_by       UUID REFERENCES users(id),
        issued_at       TIMESTAMPTZ DEFAULT NOW(),
        paid_at         TIMESTAMPTZ,
        notes           TEXT
      )
    `)

    // ── NOTIFICATIONS ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID REFERENCES users(id),
        type          VARCHAR(50),
        title         VARCHAR(200) NOT NULL,
        message       TEXT NOT NULL,
        priority      VARCHAR(20) DEFAULT 'Normal',
        is_read       BOOLEAN DEFAULT FALSE,
        resource_type VARCHAR(50),
        resource_id   UUID,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // ── INDEXES ───────────────────────────────────────────
    const indexes = [
      `CREATE INDEX IF NOT EXISTS idx_patients_file_no    ON patients(file_no)`,
      `CREATE INDEX IF NOT EXISTS idx_patients_nhis       ON patients(nhis_no)`,
      `CREATE INDEX IF NOT EXISTS idx_patients_name       ON patients(last_name, first_name)`,
      `CREATE INDEX IF NOT EXISTS idx_encounters_date     ON encounters(encounter_date)`,
      `CREATE INDEX IF NOT EXISTS idx_encounters_patient  ON encounters(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_date   ON appointments(scheduled_date)`,
      `CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_lab_orders_status   ON lab_orders(status)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_patient    ON invoices(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_user          ON audit_logs(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_expiry    ON inventory(expiry_date)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_user          ON notifications(user_id, is_read)`,
    ]
    for (const idx of indexes) await client.query(idx)

    console.log('✅ All tables and indexes created successfully.')
    await client.end()
    process.exit(0)
  } catch (e) {
    console.error('❌ Schema error:', e.message)
    await client.end().catch(() => {})
    process.exit(1)
  }
}

initDatabase()
