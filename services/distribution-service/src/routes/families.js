const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parse } = require('../utils/validate');
const { httpError } = require('../utils/httpError');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth, requireRole('staff', 'admin'));

const SELECT = `SELECT f.family_id AS id, f.household_ref, f.household_size, f.contact_phone, f.status, f.created_at,
  (SELECT max(d.distributed_at) FROM distributions d WHERE d.family_id = f.family_id) AS last_distribution_at
  FROM families f`;

const phone = z.string().trim().regex(/^[0-9+\-\s]{6,30}$/, 'invalid phone');
const createSchema = z.object({
  household_ref: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/, 'use 3-30 letters, digits or -'),
  household_size: z.number().int().min(1).max(30),
  contact_phone: phone.optional(),
}).strict();
const patchSchema = z.object({
  household_size: z.number().int().min(1).max(30).optional(),
  contact_phone: phone.nullable().optional(),
  status: z.enum(['active', 'suspended']).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'send at least one field');

router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 50) : '';
    const status = req.query.status;
    if (status !== undefined && !['active', 'suspended'].includes(status)) throw httpError(400, 'status must be active or suspended');
    const where = []; const vals = [];
    if (q) { vals.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`f.household_ref ILIKE $${vals.length}`); }
    if (status) { vals.push(status); where.push(`f.status = $${vals.length}`); }
    const { rows } = await pool.query(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY f.family_id`, vals);
    res.json({ count: rows.length, families: rows });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const b = parse(createSchema, req.body);
    try {
      const { rows } = await pool.query(
        'INSERT INTO families (household_ref, household_size, contact_phone) VALUES ($1,$2,$3) RETURNING family_id',
        [b.household_ref, b.household_size, b.contact_phone || null]);
      const out = await pool.query(`${SELECT} WHERE f.family_id = $1`, [rows[0].family_id]);
      logger.info('FAMILY_CREATED', { by: req.user.id, familyId: rows[0].family_id });
      res.status(201).json(out.rows[0]);
    } catch (e) {
      if (e.code === '23505') throw httpError(409, 'A family with this household reference already exists');
      throw e;
    }
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Invalid family id');
    const b = parse(patchSchema, req.body);
    const sets = ['updated_at = now()']; const vals = [id];
    for (const k of ['household_size', 'contact_phone', 'status']) {
      if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${k} = $${vals.length}`); }
    }
    const { rows } = await pool.query(`UPDATE families SET ${sets.join(', ')} WHERE family_id = $1 RETURNING family_id`, vals);
    if (!rows[0]) throw httpError(404, 'Family not found');
    const out = await pool.query(`${SELECT} WHERE f.family_id = $1`, [id]);
    logger.info('FAMILY_UPDATED', { by: req.user.id, familyId: id });
    res.json(out.rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
