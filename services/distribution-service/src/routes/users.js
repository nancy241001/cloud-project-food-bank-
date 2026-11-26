const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parse } = require('../utils/validate');
const { httpError } = require('../utils/httpError');
const logger = require('../utils/logger');
const { breachCount } = require('../services/pwnedPasswords');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const COLS = 'user_id AS id, name, email, role, is_active, created_at';

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid email'),
  password: z.string().min(10).max(128),
  role: z.enum(['staff', 'admin']),
}).strict();

const patchSchema = z.object({
  role: z.enum(['staff', 'admin']).optional(),
  is_active: z.boolean().optional(),
}).strict().refine((v) => v.role !== undefined || v.is_active !== undefined, 'send role and/or is_active');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${COLS} FROM users ORDER BY user_id`);
    res.json({ count: rows.length, users: rows });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const b = parse(createSchema, req.body);
    // External API: refuse passwords that appeared in known data breaches (fails open if the API is down).
    const breached = await breachCount(b.password);
    if (breached > 0) {
      logger.warn('PASSWORD_REJECTED_BREACHED', { by: req.user.id });
      throw httpError(400, 'This password appeared in a known data breach, choose a different one');
    }
    const hash = await bcrypt.hash(b.password, 12);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING ${COLS}`,
        [b.name, b.email, hash, b.role]);
      logger.info('USER_CREATED', { by: req.user.id, userId: rows[0].id, role: b.role });
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') throw httpError(409, 'A user with this email already exists');
      throw e;
    }
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid user id');
    const b = parse(patchSchema, req.body);
    // An admin cannot lock themselves out.
    if (id === req.user.id && (b.role === 'staff' || b.is_active === false)) {
      throw httpError(409, 'You cannot demote or deactivate your own account');
    }
    const sets = []; const vals = [id];
    if (b.role !== undefined) { vals.push(b.role); sets.push(`role = $${vals.length}`); }
    if (b.is_active !== undefined) { vals.push(b.is_active); sets.push(`is_active = $${vals.length}`); }
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = $1 RETURNING ${COLS}`, vals);
    if (!rows[0]) throw httpError(404, 'User not found');
    logger.info('USER_UPDATED', { by: req.user.id, userId: id, changes: Object.keys(b).join(',') });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;