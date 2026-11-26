jest.mock('../src/db/pool', () => ({ query: jest.fn(), connect: jest.fn() }));
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const app = require('../src/app');
const { token, auth } = require('./helpers');

beforeEach(() => { pool.query.mockReset(); pool.connect.mockReset(); });

const routes = [
  ['get', '/api/users'], ['post', '/api/users'], ['patch', '/api/users/1'],
  ['get', '/api/families'], ['post', '/api/families'], ['patch', '/api/families/1'],
  ['get', '/api/distributions'], ['post', '/api/distributions'],
];

describe('authentication on every protected route', () => {
  test.each(routes)('%s %s without token -> 401', async (m, p) => {
    expect((await request(app)[m](p).send({})).status).toBe(401);
  });
  test('forged token (wrong secret) -> 401', async () => {
    const t = jwt.sign({ sub: '1', role: 'admin' }, 'another-secret-another-secret', { algorithm: 'HS256' });
    expect((await request(app).get('/api/users').set(auth(t))).status).toBe(401);
  });
  test('expired token -> 401', async () => {
    expect((await request(app).get('/api/families').set(auth(token('staff', 5, { expiresIn: -10 })))).status).toBe(401);
  });
  test('alg none token -> 401', async () => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b({ alg: 'none', typ: 'JWT' })}.${b({ sub: '1', role: 'admin' })}.`;
    expect((await request(app).get('/api/users').set(auth(t))).status).toBe(401);
  });
  test('unknown role -> 403', async () => {
    expect((await request(app).get('/api/families').set(auth(token('hacker')))).status).toBe(403);
  });
});

describe('roles', () => {
  test('staff cannot use /api/users -> 403', async () => {
    expect((await request(app).get('/api/users').set(auth(token('staff')))).status).toBe(403);
  });
  test('admin can list users, no hashes returned', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, name: 'A', email: 'a@x.com', role: 'admin', is_active: true }] });
    const r = await request(app).get('/api/users').set(auth(token('admin', 1)));
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/hash/);
  });
  test('admin cannot demote themselves -> 409', async () => {
    const r = await request(app).patch('/api/users/1').set(auth(token('admin', 1))).send({ role: 'staff' });
    expect(r.status).toBe(409);
  });
  test('create user with weak password -> 400', async () => {
    const r = await request(app).post('/api/users').set(auth(token('admin', 1)))
      .send({ name: 'N', email: 'n@x.com', password: 'short', role: 'staff' });
    expect(r.status).toBe(400);
  });
  test('create user with extra field -> 400', async () => {
    const r = await request(app).post('/api/users').set(auth(token('admin', 1)))
      .send({ name: 'N', email: 'n@x.com', password: 'longenough123', role: 'staff', is_admin: true });
    expect(r.status).toBe(400);
  });
});

describe('login', () => {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('correct-password', 4);
  test('missing fields -> 400', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
  });
  test('unknown email -> 401 generic', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const r = await request(app).post('/api/auth/login').send({ email: 'no@x.com', password: 'x' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Invalid email or password');
  });
  test('wrong password -> same 401', async () => {
    pool.query.mockResolvedValue({ rows: [{ user_id: 1, name: 'A', password_hash: hash, role: 'staff', is_active: true }] });
    const r = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Invalid email or password');
  });
  test('deactivated user -> 401 even with right password', async () => {
    pool.query.mockResolvedValue({ rows: [{ user_id: 1, name: 'A', password_hash: hash, role: 'staff', is_active: false }] });
    expect((await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'correct-password' })).status).toBe(401);
  });
  test('success -> HS256 token with sub/role/name and exp', async () => {
    pool.query.mockResolvedValue({ rows: [{ user_id: 7, name: 'Ali', password_hash: hash, role: 'admin', is_active: true }] });
    const r = await request(app).post('/api/auth/login').send({ email: 'A@X.com', password: 'correct-password' });
    expect(r.status).toBe(200);
    expect(r.body.user).toEqual({ id: 7, name: 'Ali', role: 'admin' });
    const p = jwt.verify(r.body.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    expect(p).toMatchObject({ sub: '7', role: 'admin', name: 'Ali' });
    expect(p.exp - p.iat).toBe(7200);
  });
});

describe('families validation', () => {
  test('bad household_size -> 400', async () => {
    const r = await request(app).post('/api/families').set(auth(token())).send({ household_ref: 'FAM-001', household_size: 0 });
    expect(r.status).toBe(400);
  });
  test('bad status filter -> 400', async () => {
    expect((await request(app).get('/api/families?status=x').set(auth(token()))).status).toBe(400);
  });
});

describe('distributions', () => {
  // Fake transaction client: answers by SQL text.
  function fakeClient({ family = { status: 'active' }, stock = [], failUpdate = false }) {
    const calls = [];
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        calls.push(sql);
        if (/FROM families WHERE family_id/.test(sql)) return { rows: family ? [family] : [] };
        if (/FOR UPDATE/.test(sql)) return { rows: stock };
        if (/INSERT INTO distributions/.test(sql)) return { rows: [{ distribution_id: 9 }] };
        if (/UPDATE food_items/.test(sql)) return { rowCount: failUpdate ? 0 : 1, rows: [] };
        if (/FROM distributions d/.test(sql)) return { rows: [{ id: 9, family_id: 1, household_ref: 'FAM-001', staff_user_id: 5, staff_name: 'T', distributed_at: 'now', notes: null }] };
        if (/FROM distribution_items/.test(sql)) return { rows: [{ distribution_id: 9, item_id: 1, name: 'Rice', quantity: 2 }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    client.calls = calls;
    return client;
  }
  const body = { family_id: 1, items: [{ item_id: 1, quantity: 2 }] };
  const rice = (o = {}) => ({ item_id: 1, name: 'Rice', quantity: 10, expired: false, ...o });
  const post = (b = body) => request(app).post('/api/distributions').set(auth(token('staff', 5))).send(b);

  test('success: 201, committed, stock reduced', async () => {
    const c = fakeClient({ stock: [rice()] }); pool.connect.mockResolvedValue(c);
    const r = await post();
    expect(r.status).toBe(201);
    expect(r.body.items[0]).toMatchObject({ item_id: 1, quantity: 2 });
    expect(c.calls).toContain('COMMIT');
    expect(c.calls.some((s) => /UPDATE food_items/.test(s))).toBe(true);
    expect(c.release).toHaveBeenCalled();
  });
  test('not enough stock -> 409 and ROLLBACK', async () => {
    const c = fakeClient({ stock: [rice({ quantity: 1 })] }); pool.connect.mockResolvedValue(c);
    expect((await post()).status).toBe(409);
    expect(c.calls).toContain('ROLLBACK');
    expect(c.calls).not.toContain('COMMIT');
  });
  test('expired item -> 409', async () => {
    pool.connect.mockResolvedValue(fakeClient({ stock: [rice({ expired: true })] }));
    expect((await post()).status).toBe(409);
  });
  test('unknown food item -> 404', async () => {
    pool.connect.mockResolvedValue(fakeClient({ stock: [] }));
    expect((await post()).status).toBe(404);
  });
  test('unknown family -> 404', async () => {
    pool.connect.mockResolvedValue(fakeClient({ family: null }));
    expect((await post()).status).toBe(404);
  });
  test('inactive family -> 409', async () => {
    pool.connect.mockResolvedValue(fakeClient({ family: { status: 'inactive' }, stock: [rice()] }));
    expect((await post()).status).toBe(409);
  });
  test('validation: empty items, duplicates, zero qty, extra staff field -> 400', async () => {
    for (const b of [
      { family_id: 1, items: [] },
      { family_id: 1, items: [{ item_id: 1, quantity: 1 }, { item_id: 1, quantity: 2 }] },
      { family_id: 1, items: [{ item_id: 1, quantity: 0 }] },
      { ...body, staff_user_id: 99 },
    ]) expect((await post(b)).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
  test('GET with impossible date -> 400', async () => {
    expect((await request(app).get('/api/distributions?from=2026-02-31').set(auth(token()))).status).toBe(400);
  });
});
