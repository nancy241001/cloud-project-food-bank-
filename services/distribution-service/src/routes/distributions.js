const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parse } = require('../utils/validate');
const { httpError } = require('../utils/httpError');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth, requireRole('staff', 'admin'));

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

const createSchema = z.object({
  family_id: z.number().int().min(1),
  items: z.array(z.object({
    item_id: z.number().int().min(1),
    quantity: z.number().int().min(1).max(100000),
  }).strict()).min(1).max(20),
  notes: z.string().trim().max(500).optional(),
}).strict().refine((v) => new Set(v.items.map((i) => i.item_id)).size === v.items.length, 'duplicate item_id in items');

// Fetch distributions (with their lines) by optional filters.
async function fetchDistributions(db, { id, familyId, from, to } = {}) {
  const where = []; const vals = [];
  if (id) { vals.push(id); where.push(`d.distribution_id = $${vals.length}`); }
  if (familyId) { vals.push(familyId); where.push(`d.family_id = $${vals.length}`); }
  if (from) { vals.push(from); where.push(`d.distributed_at::date >= $${vals.length}`); }
  if (to) { vals.push(to); where.push(`d.distributed_at::date <= $${vals.length}`); }
  const { rows } = await db.query(
    `SELECT d.distribution_id AS id, d.family_id, f.household_ref, d.staff_user_id, u.name AS staff_name,
            d.distributed_at, d.notes
       FROM distributions d
       JOIN families f ON f.family_id = d.family_id
       JOIN users u ON u.user_id = d.staff_user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.distributed_at DESC, d.distribution_id DESC`, vals);
  if (!rows.length) return [];
  const lines = await db.query(
    `SELECT di.distribution_id, di.item_id, fi.name, di.quantity
       FROM distribution_items di JOIN food_items fi ON fi.item_id = di.item_id
      WHERE di.distribution_id = ANY($1::int[]) ORDER BY di.item_id`, [rows.map((r) => r.id)]);
  const byId = new Map(rows.map((r) => [r.id, { ...r, items: [] }]));
  for (const l of lines.rows) byId.get(l.distribution_id).items.push({ item_id: l.item_id, name: l.name, quantity: l.quantity });
  return [...byId.values()];
}

router.get('/', async (req, res, next) => {
  try {
    const { family_id: fam, from, to } = req.query;
    let familyId;
    if (fam !== undefined) {
      familyId = Number(fam);
      if (!Number.isInteger(familyId) || familyId < 1) throw httpError(400, 'family_id must be a positive integer');
    }
    if (from !== undefined && !isDate(from)) throw httpError(400, 'from must be a real date YYYY-MM-DD');
    if (to !== undefined && !isDate(to)) throw httpError(400, 'to must be a real date YYYY-MM-DD');
    if (from && to && from > to) throw httpError(400, 'from must not be after to');
    const list = await fetchDistributions(pool, { familyId, from, to });
    res.json({ count: list.length, distributions: list });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  let client;
  try {
    const b = parse(createSchema, req.body);
    client = await pool.connect();
    try {
      await client.query('BEGIN');

      const fam = await client.query('SELECT status FROM families WHERE family_id = $1', [b.family_id]);
      if (!fam.rows[0]) throw httpError(404, 'Family not found');
      if (fam.rows[0].status !== 'active') throw httpError(409, 'Family is not active');

      // Lock the stock rows so two staff members cannot both take the last units.
      const ids = b.items.map((i) => i.item_id).sort((x, y) => x - y);
      const stock = await client.query(
        `SELECT item_id, name, quantity, expiry_date < CURRENT_DATE AS expired
           FROM food_items WHERE item_id = ANY($1::int[]) ORDER BY item_id FOR UPDATE`, [ids]);
      const have = new Map(stock.rows.map((r) => [r.item_id, r]));
      for (const it of b.items) {
        const row = have.get(it.item_id);
        if (!row) throw httpError(404, `Food item ${it.item_id} not found`);
        if (row.expired) throw httpError(409, `${row.name} is expired`);
        if (row.quantity < it.quantity) throw httpError(409, `Not enough stock for ${row.name} (available: ${row.quantity})`);
      }

      // Staff id comes from the verified token, never from the request body.
      const d = await client.query(
        'INSERT INTO distributions (family_id, staff_user_id, notes) VALUES ($1,$2,$3) RETURNING distribution_id',
        [b.family_id, req.user.id, b.notes || null]);
      const distId = d.rows[0].distribution_id;
      for (const it of b.items) {
        await client.query('INSERT INTO distribution_items (distribution_id, item_id, quantity) VALUES ($1,$2,$3)', [distId, it.item_id, it.quantity]);
        const upd = await client.query(
          'UPDATE food_items SET quantity = quantity - $2, updated_at = now() WHERE item_id = $1 AND quantity >= $2', [it.item_id, it.quantity]);
        if (upd.rowCount !== 1) throw httpError(409, 'Stock changed, try again');
      }
      await client.query('COMMIT');

      const [created] = await fetchDistributions(client, { id: distId });
      logger.info('DISTRIBUTION_RECORDED', { by: req.user.id, distributionId: distId, familyId: b.family_id, lines: b.items.length });
      res.status(201).json(created);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.status === 404 || e.status === 409) logger.warn('DISTRIBUTION_REJECTED', { by: req.user.id, familyId: b.family_id, reason: e.message });
      throw e;
    }
  } catch (e) { next(e); } finally { if (client) client.release(); }
});

module.exports = router;
