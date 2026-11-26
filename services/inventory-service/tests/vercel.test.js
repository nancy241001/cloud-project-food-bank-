const request = require('supertest');
const jwt = require('jsonwebtoken');

const SECRET = 'vercel-test-secret-0123456789abcdef';
const item = {
  item_id: 7, name: 'Test beans', category: 'canned', quantity: 5, unit: 'can',
  donation_date: '2026-11-01', expiry_date: '2099-11-28', days_left: 26665,
  donor_type: 'organization', donor_name: null, lot: null, storage_location: 'Test shelf',
  created_by_name: 'Test Admin',
};

jest.mock('../src/config', () => ({
  databaseUrl: 'postgresql://test-only',
  jwtSecret: SECRET,
  corsOrigins: ['http://localhost:3000'],
  aws: {
    endpoint: undefined, region: 'us-east-1', exportsBucket: 'test-bucket', logGroup: '',
  },
}));
jest.mock('../src/db', () => ({ query: jest.fn().mockResolvedValue({ rows: [item] }) }));
jest.mock('../src/aws/stockExport', () => ({ exportCurrentStock: jest.fn() }));
jest.mock('../src/aws/audit', () => ({ donationCreated: jest.fn() }));

const app = require('../api/index');
const db = require('../src/db');

test('Vercel entry point serves the existing health route', async () => {
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ service: 'inventory-service', status: 'ok' });
});

test('Vercel entry point serves an authenticated Inventory route', async () => {
  const token = jwt.sign({ sub: '2', role: 'admin', name: 'Test Admin' }, SECRET, {
    algorithm: 'HS256', expiresIn: '5m',
  });
  const response = await request(app).get('/api/items?in_stock=true').set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ count: 1, items: [item] });
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('f.quantity > 0'), []);
});
