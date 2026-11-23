const request = require('supertest');
const jwt = require('jsonwebtoken');
const { newDb, DataType } = require('pg-mem');
const createApp = require('../src/app');

const SECRET = 'local-test-secret-only-0123456789abcdef';
let memory;
let db;
let app;
let staffToken;
let adminToken;

function token(id, role, algorithm = 'HS256') {
  return jwt.sign({ sub: String(id), role, name: role }, SECRET, { algorithm, expiresIn: '1h' });
}

async function seed() {
  memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({ name: 'current_date', returns: DataType.date, implementation: () => new Date() });
  memory.public.none(`
    CREATE TABLE users (user_id serial PRIMARY KEY, name varchar(100) NOT NULL);
    CREATE TABLE food_items (
      item_id serial PRIMARY KEY, name varchar(120) NOT NULL, category varchar(30) NOT NULL,
      quantity integer NOT NULL, unit varchar(20) NOT NULL DEFAULT 'unit', donation_date date NOT NULL,
      expiry_date date NOT NULL, donor_type varchar(15) NOT NULL, donor_name varchar(120), lot varchar(50),
      storage_location varchar(50), created_by integer REFERENCES users(user_id), created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE distribution_items (distribution_item_id serial PRIMARY KEY, item_id integer NOT NULL REFERENCES food_items(item_id));
    INSERT INTO users (name) VALUES ('Staff One'), ('Admin One');
    INSERT INTO food_items (name, category, quantity, unit, donation_date, expiry_date, donor_type, donor_name, created_by)
    VALUES
      ('Canned beans', 'canned', 8, 'can', '2026-11-01', '2099-11-28', 'shop', 'Hyper One', 1),
      ('Rice', 'dry', 50, 'bag', '2026-11-02', '2099-12-01', 'organization', NULL, 1),
      ('Milk', 'dairy', 4, 'carton', '2026-11-03', '2099-11-25', 'individual', NULL, 1);
    INSERT INTO distribution_items (item_id) VALUES (2);
  `);
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  db = {
    query: async (text, params) => {
      // pg-mem cannot perform PostgreSQL's valid DATE::text cast. Keep the
      // production query unchanged and normalize the emulator result here.
      const compatibleSql = text
        .replace(/::text/g, '')
        .replace(/\(f\.expiry_date - CURRENT_DATE\)::int AS days_left/g, '0 AS days_left');
      const result = await pool.query(compatibleSql, params);
      for (const row of result.rows) {
        for (const key of ['donation_date', 'expiry_date']) {
          if (row[key] instanceof Date) row[key] = row[key].toISOString().slice(0, 10);
        }
        if (row.expiry_date && Object.hasOwn(row, 'days_left')) {
          row.days_left = Math.round((new Date(`${row.expiry_date}T00:00:00Z`) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
        }
      }
      return result;
    },
  };
  app = createApp({ db, jwtSecret: SECRET });
  staffToken = token(1, 'staff');
  adminToken = token(2, 'admin');
}

function auth(value = staffToken) { return { Authorization: `Bearer ${value}` }; }

beforeEach(seed);

describe('authentication and permissions', () => {
  test('requires a valid HS256 JWT on every inventory request', async () => {
    expect((await request(app).get('/api/items')).status).toBe(401);
    expect((await request(app).get('/api/items').set(auth(token(1, 'staff', 'HS384')))).status).toBe(401);
    expect((await request(app).get('/api/items').set(auth(token(1, 'viewer')))).status).toBe(403);
  });

  test('allows only admins to delete', async () => {
    expect((await request(app).delete('/api/items/1').set(auth(staffToken))).status).toBe(403);
  });
});

describe('GET /api/items', () => {
  test('returns the frontend item shape in FEFO order', async () => {
    const response = await request(app).get('/api/items').set(auth());
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(3);
    expect(response.body.items[0]).toEqual(expect.objectContaining({
      item_id: 3, name: 'Milk', donation_date: '2026-11-03', expiry_date: '2099-11-25',
      donor_type: 'individual', created_by_name: 'Staff One', days_left: expect.any(Number),
    }));
  });

  test('applies all documented filters and rejects invalid filters', async () => {
    const filtered = await request(app).get('/api/items?q=beans&category=canned&expiring_before=2099-11-30&in_stock=true&low_stock=true').set(auth());
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map((item) => item.name)).toEqual(['Canned beans']);
    expect((await request(app).get('/api/items?low_stock=false').set(auth())).status).toBe(400);
    expect((await request(app).get('/api/items?category=invalid').set(auth())).status).toBe(400);
  });
});

describe('POST /api/items', () => {
  test('records a donation and defaults donation_date to today', async () => {
    const response = await request(app).post('/api/items').set(auth()).send({
      name: 'Pasta', category: 'dry', quantity: 12, unit: 'pack', expiry_date: '2099-12-30',
      donor_type: 'shop', donor_name: 'Local Shop', lot: 'P1', storage_location: 'Shelf 2',
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({ name: 'Pasta', quantity: 12, created_by_name: 'Staff One' }));
    expect(response.body.donation_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('rejects invalid quantities, dates, categories, and donor types', async () => {
    const base = { name: 'Bad', category: 'dry', quantity: 1, unit: 'box', donation_date: '2099-01-02', expiry_date: '2099-01-03', donor_type: 'shop' };
    expect((await request(app).post('/api/items').set(auth()).send({ ...base, quantity: 0 })).status).toBe(400);
    expect((await request(app).post('/api/items').set(auth()).send({ ...base, category: 'food' })).status).toBe(400);
    expect((await request(app).post('/api/items').set(auth()).send({ ...base, donor_type: 'unknown' })).status).toBe(400);
    expect((await request(app).post('/api/items').set(auth()).send({ ...base, expiry_date: '2098-12-31' })).status).toBe(400);
  });
});

describe('PATCH /api/items/:id', () => {
  test.each([['staff', () => staffToken], ['admin', () => adminToken]])('allows %s to set quantity to 0', async (role, getToken) => {
    const response = await request(app).patch('/api/items/1').set(auth(getToken())).send({ quantity: 0 });
    expect(response.status).toBe(200);
    expect(response.body.quantity).toBe(0);
  });

  test('updates documented details, including clearing optional strings', async () => {
    const response = await request(app).patch('/api/items/1').set(auth()).send({
      name: 'Beans', expiry_date: '2099-11-29', storage_location: '', lot: 'B12',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ name: 'Beans', expiry_date: '2099-11-29', storage_location: null, lot: 'B12' }));
  });

  test('returns 400 for bad input and 404 for a missing item', async () => {
    expect((await request(app).patch('/api/items/1').set(auth()).send({ quantity: -1 })).status).toBe(400);
    expect((await request(app).patch('/api/items/999').set(auth()).send({ quantity: 0 })).status).toBe(404);
  });
});

describe('DELETE /api/items/:id', () => {
  test('deletes an undistributed item', async () => {
    expect((await request(app).delete('/api/items/1').set(auth(adminToken))).status).toBe(204);
    expect((await db.query('SELECT 1 FROM food_items WHERE item_id = $1', [1])).rows).toHaveLength(0);
  });

  test('protects distribution history and reports missing items', async () => {
    const conflict = await request(app).delete('/api/items/2').set(auth(adminToken));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/quantity to 0/i);
    expect((await request(app).delete('/api/items/999').set(auth(adminToken))).status).toBe(404);
  });
});
