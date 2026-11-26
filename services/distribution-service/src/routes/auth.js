const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

// Brute-force protection: few login attempts per minute per IP.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, limit: config.loginRateLimit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
  handler: (req, res, next, options) => { logger.warn('LOGIN_RATE_LIMITED', { ip: req.ip }); res.status(429).json(options.message); },
});

// Compared against when the email does not exist, so response time does not reveal which emails are real.
let dummyHash;
const getDummyHash = () => (dummyHash ||= bcrypt.hashSync('not-a-real-password', 10));

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Enter your email and password' });
    }
    const { rows } = await pool.query(
      'SELECT user_id, name, password_hash, role, is_active FROM users WHERE email = lower($1)', [email.trim()]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : getDummyHash());
    if (!user || !user.is_active || !ok) {
      logger.warn('LOGIN_FAILED', { reason: !user ? 'unknown_user' : !user.is_active ? 'inactive' : 'bad_password', ip: req.ip });
      return res.status(401).json({ error: 'Invalid email or password' }); // same message for every failure
    }
    const token = jwt.sign({ sub: String(user.user_id), role: user.role, name: user.name }, config.jwtSecret,
      { algorithm: 'HS256', expiresIn: config.tokenTtl });
    logger.info('LOGIN_SUCCESS', { userId: user.user_id, role: user.role });
    return res.json({ token, user: { id: Number(user.user_id), name: user.name, role: user.role } });
  } catch (e) { return next(e); }
});

module.exports = router;
