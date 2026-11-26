const express = require('express');
const { requireRole } = require('./auth');
const { CATEGORIES, DONOR_TYPES, isDate, today, nonEmpty, optionalString, validId } = require('./validation');

const ITEM_SELECT = `
  SELECT f.item_id, f.name, f.category, f.quantity, f.unit,
         f.donation_date::text AS donation_date, f.expiry_date::text AS expiry_date,
         (f.expiry_date - CURRENT_DATE)::int AS days_left,
         f.donor_type, f.donor_name, f.lot, f.storage_location,
         u.name AS created_by_name
  FROM food_items f
  LEFT JOIN users u ON u.user_id = f.created_by`;

function itemRouter(db, { stockExporter, audit } = {}) {
  const router = express.Router();
  router.use(requireRole('staff', 'admin'));

  router.get('/', async (req, res, next) => {
    try {
      const allowed = new Set(['q', 'category', 'expiring_before', 'in_stock', 'low_stock']);
      if (Object.keys(req.query).some((key) => !allowed.has(key))) return res.status(400).json({ error: 'Invalid inventory filter' });
      const where = [];
      const params = [];
      if (req.query.q !== undefined) {
        if (typeof req.query.q !== 'string' || req.query.q.trim().length > 120) return res.status(400).json({ error: 'Invalid search filter' });
        params.push(`%${req.query.q.trim()}%`); where.push(`f.name ILIKE $${params.length}`);
      }
      if (req.query.category !== undefined) {
        if (!CATEGORIES.has(req.query.category)) return res.status(400).json({ error: 'Invalid category filter' });
        params.push(req.query.category); where.push(`f.category = $${params.length}`);
      }
      if (req.query.expiring_before !== undefined) {
        if (!isDate(req.query.expiring_before)) return res.status(400).json({ error: 'Invalid expiring_before date' });
        params.push(req.query.expiring_before); where.push(`f.expiry_date <= $${params.length}::date`);
      }
      for (const key of ['in_stock', 'low_stock']) {
        if (req.query[key] !== undefined && req.query[key] !== 'true') return res.status(400).json({ error: `${key} must be true` });
      }
      if (req.query.in_stock === 'true') where.push('f.quantity > 0');
      if (req.query.low_stock === 'true') where.push('f.quantity <= 10');
      const sql = `${ITEM_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.expiry_date ASC, f.item_id ASC`;
      const { rows } = await db.query(sql, params);
      return res.json({ count: rows.length, items: rows });
    } catch (err) { return next(err); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body || {};
      const allowed = new Set(['name', 'category', 'quantity', 'unit', 'donation_date', 'expiry_date', 'donor_type', 'donor_name', 'lot', 'storage_location']);
      if (Object.keys(body).some((key) => !allowed.has(key))) return res.status(400).json({ error: 'Request contains an unsupported field' });
      const donationDate = body.donation_date === undefined ? today() : body.donation_date;
      if (!nonEmpty(body.name, 120)) return res.status(400).json({ error: 'Name is required and must be at most 120 characters' });
      if (!CATEGORIES.has(body.category)) return res.status(400).json({ error: 'Invalid category' });
      if (!Number.isInteger(body.quantity) || body.quantity < 1) return res.status(400).json({ error: 'Quantity must be a whole number of at least 1' });
      if (!nonEmpty(body.unit, 20)) return res.status(400).json({ error: 'Unit is required and must be at most 20 characters' });
      if (!isDate(donationDate) || !isDate(body.expiry_date)) return res.status(400).json({ error: 'Donation and expiry dates must use YYYY-MM-DD' });
      if (body.expiry_date < today()) return res.status(400).json({ error: 'Expiry date has already passed' });
      if (body.expiry_date < donationDate) return res.status(400).json({ error: 'Expiry date cannot be before donation date' });
      if (!DONOR_TYPES.has(body.donor_type)) return res.status(400).json({ error: 'Invalid donor type' });
      if (!optionalString(body.donor_name, 120) || !optionalString(body.lot, 50) || !optionalString(body.storage_location, 50)) {
        return res.status(400).json({ error: 'Optional text field is invalid or too long' });
      }
      const values = [body.name.trim(), body.category, body.quantity, body.unit.trim(), donationDate, body.expiry_date,
        body.donor_type, body.donor_name?.trim() || null, body.lot?.trim() || null, body.storage_location?.trim() || null, req.user.id];
      const inserted = await db.query(
        `INSERT INTO food_items (name, category, quantity, unit, donation_date, expiry_date, donor_type, donor_name, lot, storage_location, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11) RETURNING item_id`, values);
      if (audit) {
        try {
          await audit.donationCreated({ itemId: inserted.rows[0].item_id, quantity: body.quantity, actorId: req.user.id });
        } catch (err) {
          console.error('Inventory audit delivery failed', err.message);
        }
      }
      const { rows } = await db.query(
        `SELECT f.item_id, f.name, f.category, f.quantity, f.unit,
                f.donation_date::text AS donation_date, f.expiry_date::text AS expiry_date,
                (f.expiry_date - CURRENT_DATE)::int AS days_left,
                f.donor_type, f.donor_name, f.lot, f.storage_location,
                $2::text AS created_by_name
         FROM food_items f WHERE f.item_id = $1`,
        [inserted.rows[0].item_id, req.user.name || null],
      );
      return res.status(201).json(rows[0]);
    } catch (err) { return next(err); }
  });

  router.post('/export', requireRole('admin'), async (req, res, next) => {
    try {
      if (!stockExporter) throw new Error('Stock export is not configured');
      const { rows } = await db.query(
        `SELECT item_id, name, category, quantity, unit, expiry_date::text AS expiry_date, storage_location
         FROM food_items WHERE quantity > 0 ORDER BY expiry_date ASC, item_id ASC`, []);
      const location = await stockExporter.exportCurrentStock(rows, req.user.id);
      return res.status(201).json({ count: rows.length, ...location });
    } catch (err) { return next(err); }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
      const body = req.body || {};
      const allowed = new Set(['quantity', 'expiry_date', 'storage_location', 'lot', 'name']);
      const keys = Object.keys(body);
      if (!keys.length || keys.some((key) => !allowed.has(key))) return res.status(400).json({ error: 'Provide at least one supported field' });
      if (body.quantity !== undefined && (!Number.isInteger(body.quantity) || body.quantity < 0)) return res.status(400).json({ error: 'Quantity must be a whole number of 0 or more' });
      if (body.expiry_date !== undefined && !isDate(body.expiry_date)) return res.status(400).json({ error: 'Expiry date must use YYYY-MM-DD' });
      if (body.name !== undefined && !nonEmpty(body.name, 120)) return res.status(400).json({ error: 'Name must not be blank and must be at most 120 characters' });
      if (!optionalString(body.storage_location, 50) || !optionalString(body.lot, 50)) return res.status(400).json({ error: 'Optional text field is invalid or too long' });
      const current = await db.query('SELECT donation_date::text AS donation_date FROM food_items WHERE item_id = $1', [Number(req.params.id)]);
      if (!current.rows.length) return res.status(404).json({ error: 'Item not found' });
      if (body.expiry_date !== undefined && body.expiry_date < current.rows[0].donation_date) return res.status(400).json({ error: 'Expiry date cannot be before donation date' });
      const params = [];
      const sets = [];
      for (const key of keys) {
        let value = body[key];
        if (typeof value === 'string') value = value.trim();
        if (['storage_location', 'lot'].includes(key) && value === '') value = null;
        params.push(value); sets.push(`${key} = $${params.length}${key === 'expiry_date' ? '::date' : ''}`);
      }
      params.push(Number(req.params.id));
      await db.query(`UPDATE food_items SET ${sets.join(', ')}, updated_at = now() WHERE item_id = $${params.length}`, params);
      const { rows } = await db.query(`${ITEM_SELECT} WHERE f.item_id = $1`, [Number(req.params.id)]);
      return res.json(rows[0]);
    } catch (err) { return next(err); }
  });

  router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
      const id = Number(req.params.id);
      const found = await db.query('SELECT 1 FROM food_items WHERE item_id = $1', [id]);
      if (!found.rows.length) return res.status(404).json({ error: 'Item not found' });
      const history = await db.query('SELECT 1 FROM distribution_items WHERE item_id = $1 LIMIT 1', [id]);
      if (history.rows.length) return res.status(409).json({ error: 'This item has distribution history; set its quantity to 0 instead' });
      await db.query('DELETE FROM food_items WHERE item_id = $1', [id]);
      return res.status(204).send();
    } catch (err) { return next(err); }
  });

  return router;
}

module.exports = itemRouter;
