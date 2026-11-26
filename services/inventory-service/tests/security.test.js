const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');

const TEST_SIGNING_KEY = 'synthetic-signing-key-for-tests-only-123456';
let db;
let stockExporter;
let app;

function authorization(role) {
  const credential = jwt.sign({ sub: role === 'admin' ? '2' : '1', role, name: 'Test User' }, TEST_SIGNING_KEY, {
    algorithm: 'HS256', expiresIn: '5m',
  });
  return { Authorization: `Bearer ${credential}` };
}

beforeEach(() => {
  db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  stockExporter = { exportCurrentStock: jest.fn() };
  app = createApp({
    db, jwtSecret: TEST_SIGNING_KEY, stockExporter,
    audit: { donationCreated: jest.fn() },
  });
});

describe('Inventory authentication boundary', () => {
  test.each([
    ['GET', '/api/items'],
    ['POST', '/api/items'],
    ['PATCH', '/api/items/1'],
    ['DELETE', '/api/items/1'],
    ['POST', '/api/items/export'],
  ])('%s %s rejects a missing credential', async (method, route) => {
    const response = await request(app)[method.toLowerCase()](route).send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Authentication required' });
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('Inventory authorization boundary', () => {
  test.each([
    ['delete an item', 'delete', '/api/items/1'],
    ['export stock', 'post', '/api/items/export'],
  ])('staff cannot %s', async (description, method, route) => {
    const response = await request(app)[method](route).set(authorization('staff'));
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/permission/i);
    expect(db.query).not.toHaveBeenCalled();
    expect(stockExporter.exportCurrentStock).not.toHaveBeenCalled();
  });
});

describe('Inventory input hardening', () => {
  test('malformed JSON returns 400 without database access or a stack trace', async () => {
    const response = await request(app)
      .post('/api/items')
      .set(authorization('admin'))
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Request body is not valid JSON' });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|syntaxerror/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('mass-assignment fields are rejected before database access', async () => {
    const response = await request(app).post('/api/items').set(authorization('staff')).send({
      name: 'Synthetic item', category: 'dry', quantity: 1, unit: 'box',
      expiry_date: '2099-12-31', donor_type: 'organization', created_by: 999,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/unsupported field/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('invalid category and injected ids are rejected before database access', async () => {
    const category = await request(app).get('/api/items?category=dry%27%20OR%201%3D1--').set(authorization('staff'));
    const id = await request(app).patch('/api/items/1%20OR%201%3D1').set(authorization('staff')).send({ quantity: 0 });
    expect(category.status).toBe(400);
    expect(id.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('free-text search stays in a query parameter, never SQL text', async () => {
    const input = "beans%' OR 1=1--";
    const response = await request(app).get(`/api/items?q=${encodeURIComponent(input)}`).set(authorization('staff'));
    expect(response.status).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain(input);
    expect(params).toEqual([`%${input}%`]);
  });
});

describe('Inventory database least-privilege contract', () => {
  test('roles.sql grants Inventory only its table and narrow cross-service read columns', () => {
    const rolesPath = path.resolve(__dirname, '..', '..', '..', 'database', 'roles.sql');
    const sql = fs.readFileSync(rolesPath, 'utf8')
      .split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join(' ')
      .replace(/\s+/g, ' ');

    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON food_items TO inventory_service;/);
    expect(sql).toMatch(/GRANT SELECT \(user_id, name, role\) ON users TO inventory_service;/);
    expect(sql).toMatch(/GRANT SELECT \(item_id\) ON distribution_items TO inventory_service;/);
    expect(sql).not.toMatch(/GRANT SELECT ON users TO inventory_service;/);
    expect(sql).not.toMatch(/GRANT SELECT ON distribution_items TO inventory_service;/);
    expect(sql).not.toMatch(/GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]* ON users TO inventory_service;/);
    expect(sql).not.toMatch(/GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]* ON distribution_items TO inventory_service;/);
    expect(sql).not.toMatch(/password_hash[^;]*TO inventory_service/);
  });
});
