const pool = require('../db/pool')

/**
 * Audit logger — writes every significant action to audit_logs.
 * Call: audit(req, action, resourceType, resourceId, details)
 */
async function audit(req, action, resourceType = null, resourceId = null, details = null) {
  try {
    const userId   = req.user?.id   || null
    const username = req.user?.username || 'anonymous'
    const ip       = req.ip || req.connection?.remoteAddress || null
    const ua       = req.headers?.['user-agent']?.substring(0, 500) || null

    await pool.query(`
      INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, details, ip_address, user_agent)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [userId, username, action, resourceType, resourceId, details ? JSON.stringify(details) : null, ip, ua])
  } catch (err) {
    // Audit failures must never crash the main request
    console.error('Audit log error:', err.message)
  }
}

/**
 * Express middleware — auto-logs all API requests.
 */
function auditMiddleware(req, res, next) {
  const start = Date.now()
  res.on('finish', () => {
    // Only log mutating actions or sensitive reads
    const method = req.method
    if (['POST','PUT','PATCH','DELETE'].includes(method) || req.path.includes('/auth/')) {
      audit(req, `${method} ${req.path}`, null, null, {
        status: res.statusCode,
        ms: Date.now() - start
      }).catch(() => {})
    }
  })
  next()
}

module.exports = { audit, auditMiddleware }
