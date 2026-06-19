const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const { body, validationResult } = require('express-validator')
const { login, refresh, logout, me } = require('../controllers/authController')
const { requireAuth } = require('../middleware/auth')

// Strict rate limit on login: 10 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const loginValidation = [
  body('username').trim().isLength({ min:2, max:50 }).withMessage('Username required.'),
  body('password').isLength({ min:4, max:100 }).withMessage('Password required.'),
]

router.post('/login', loginLimiter, loginValidation, (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg })
  next()
}, login)

router.post('/refresh', refresh)
router.post('/logout',  requireAuth, logout)
router.get('/me',       requireAuth, me)

module.exports = router
