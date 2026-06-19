require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const { Pool } = require('pg')

// Strip libpq-only params that the pg library doesn't support
const dbUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/[?&]channel_binding=[^&]*/g, '').replace(/\?$/, '')
  : null

const pool = new Pool(
  dbUrl
    ? {
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        host:     process.env.DB_HOST || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'medicore_db',
        user:     process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
)

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err)
})

module.exports = pool
