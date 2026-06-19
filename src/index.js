require('dotenv').config()
const express    = require('express')
const cors       = require('cors')
const helmet     = require('helmet')
const morgan     = require('morgan')
const cookieParser = require('cookie-parser')
const rateLimit  = require('express-rate-limit')

const authRoutes        = require('./routes/auth')
const patientRoutes     = require('./routes/patients')
const encounterRoutes   = require('./routes/encounters')
const dashboardRoutes   = require('./routes/dashboard')
const prescriptionRoutes = require('./routes/prescriptions')
const labRoutes         = require('./routes/lab')
const inventoryRoutes   = require('./routes/inventory')
const appointmentRoutes = require('./routes/appointments')
const billingRoutes     = require('./routes/billing')
const userRoutes        = require('./routes/users')

const { auditMiddleware } = require('./middleware/audit')

const app  = express()
const PORT = process.env.PORT || 3001

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',').map(s => s.trim())

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: ${origin} not allowed`))
  },
  credentials: true,
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}))

// ── Body parsing & cookies ────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())

// ── HTTP logging ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('[:date[iso]] :method :url :status :response-time ms'))
}

// ── Global rate limit (100 req / 15 min per IP) ───────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
}))

// ── Audit middleware (auto-logs mutations) ────────────────────────────────────
app.use(auditMiddleware)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes)
app.use('/api/patients',      patientRoutes)
app.use('/api/encounters',    encounterRoutes)
app.use('/api/dashboard',     dashboardRoutes)
app.use('/api/prescriptions', prescriptionRoutes)
app.use('/api/lab',           labRoutes)
app.use('/api/inventory',     inventoryRoutes)
app.use('/api/appointments',  appointmentRoutes)
app.use('/api/billing',       billingRoutes)
app.use('/api/users',         userRoutes)

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }))

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message)
  const status = err.status || 500
  const msg    = process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message
  res.status(status).json({ error: msg })
})

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  MediCore AI API running on port ${PORT}`)
  console.log(`  Environment : ${process.env.NODE_ENV || 'development'}`)
  console.log(`  CORS origin : ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`)
  console.log(`  Health      : http://localhost:${PORT}/health\n`)
})

module.exports = app
