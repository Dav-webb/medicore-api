const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const pool     = require('../db/pool')
const { audit } = require('../middleware/audit')

const JWT_SECRET         = process.env.JWT_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET
const JWT_EXPIRES        = process.env.JWT_EXPIRES_IN || '15m'
const REFRESH_EXPIRES    = process.env.JWT_REFRESH_EXPIRES_IN || '7d'
const MAX_ATTEMPTS       = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5
const LOCKOUT_MIN        = parseInt(process.env.LOCKOUT_MINUTES) || 15

function signAccess(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  )
}
function signRefresh(userId) {
  return jwt.sign({ sub: userId }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES })
}

const ROLE_PAGES = {
  Admin:        ['dashboard','patients','appointments','reception','consultation','laboratory','ward','pharmacy','prescriptions','billing','reports','ai','settings'],
  Doctor:       ['dashboard','patients','appointments','consultation','laboratory','ward','prescriptions','ai'],
  Nurse:        ['dashboard','patients','appointments','reception','ward'],
  Pharmacist:   ['dashboard','prescriptions','pharmacy'],
  'Lab Tech':   ['dashboard','laboratory','reception'],
  Receptionist: ['dashboard','patients','appointments','reception','billing'],
  Accountant:   ['dashboard','billing','reports'],
}

/* POST /api/auth/login */
async function login(req, res) {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' })
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username=$1', [username.trim().toLowerCase()]
    )
    const user = result.rows[0]

    if (!user) {
      await audit(req, 'LOGIN_FAILED', 'auth', null, { username, reason: 'user_not_found' })
      return res.status(401).json({ error: 'Invalid username or password.' })
    }

    // Check lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const unlockAt = new Date(user.locked_until).toLocaleTimeString()
      return res.status(423).json({ error: `Account locked. Try again after ${unlockAt}.` })
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact administrator.' })
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash)

    if (!valid) {
      const newFails = user.failed_logins + 1
      const lockedUntil = newFails >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MIN * 60000)
        : null

      await pool.query(
        'UPDATE users SET failed_logins=$1, locked_until=$2 WHERE id=$3',
        [newFails, lockedUntil, user.id]
      )
      await audit(req, 'LOGIN_FAILED', 'auth', user.id, { username, attempts: newFails })

      const remaining = MAX_ATTEMPTS - newFails
      if (remaining <= 0) {
        return res.status(423).json({ error: `Account locked for ${LOCKOUT_MIN} minutes after too many failed attempts.` })
      }
      return res.status(401).json({ error: `Invalid password. ${remaining} attempt${remaining!==1?'s':''} remaining.` })
    }

    // Success — reset failed logins, update last_login
    await pool.query(
      'UPDATE users SET failed_logins=0, locked_until=NULL, last_login=NOW() WHERE id=$1',
      [user.id]
    )

    // Issue tokens
    const accessToken  = signAccess(user)
    const refreshToken = signRefresh(user.id)

    // Store refresh token in DB
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, refreshToken, expiresAt]
    )

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })

    await audit(req, 'LOGIN_SUCCESS', 'auth', user.id, { username, role: user.role })

    res.json({
      accessToken,
      user: {
        id:         user.id,
        username:   user.username,
        name:       user.name,
        role:       user.role,
        department: user.department,
        initials:   user.initials,
        color:      user.color,
        allowedPages: ROLE_PAGES[user.role] || []
      }
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Internal server error.' })
  }
}

/* POST /api/auth/refresh */
async function refresh(req, res) {
  const token = req.cookies?.refreshToken
  if (!token) return res.status(401).json({ error: 'No refresh token.' })

  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET)

    const stored = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token=$1 AND user_id=$2 AND is_revoked=FALSE AND expires_at>NOW()',
      [token, decoded.sub]
    )
    if (!stored.rows.length) return res.status(401).json({ error: 'Invalid or expired refresh token.' })

    const userResult = await pool.query(
      'SELECT id,username,name,role,department,initials,color FROM users WHERE id=$1 AND is_active=TRUE',
      [decoded.sub]
    )
    if (!userResult.rows.length) return res.status(401).json({ error: 'User not found.' })

    const user = userResult.rows[0]
    const newAccessToken = signAccess(user)

    res.json({ accessToken: newAccessToken })
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token.' })
  }
}

/* POST /api/auth/logout */
async function logout(req, res) {
  const token = req.cookies?.refreshToken
  if (token) {
    await pool.query('UPDATE refresh_tokens SET is_revoked=TRUE WHERE token=$1', [token]).catch(() => {})
    await audit(req, 'LOGOUT', 'auth', req.user?.id)
  }
  res.clearCookie('refreshToken')
  res.json({ message: 'Logged out successfully.' })
}

/* GET /api/auth/me */
async function me(req, res) {
  res.json({
    user: {
      id:         req.user.id,
      username:   req.user.username,
      name:       req.user.name,
      role:       req.user.role,
      department: req.user.department,
      initials:   req.user.initials,
      color:      req.user.color,
      allowedPages: ROLE_PAGES[req.user.role] || []
    }
  })
}

module.exports = { login, refresh, logout, me }
