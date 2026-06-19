const jwt = require('jsonwebtoken')
const pool = require('../db/pool')

const JWT_SECRET = process.env.JWT_SECRET

/**
 * Verifies JWT in Authorization header.
 * Attaches decoded user to req.user.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided.' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = jwt.verify(token, JWT_SECRET)

    // Verify user still exists and is active
    const result = await pool.query(
      'SELECT id, username, name, role, department, initials, color, is_active FROM users WHERE id=$1',
      [decoded.sub]
    )
    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or deactivated.' })
    }

    req.user = result.rows[0]
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' })
    }
    return res.status(401).json({ error: 'Invalid token.' })
  }
}

/**
 * Role-based access control.
 * Usage: requireRole(['Admin', 'Doctor'])
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
        yourRole: req.user.role
      })
    }
    next()
  }
}

module.exports = { requireAuth, requireRole }
