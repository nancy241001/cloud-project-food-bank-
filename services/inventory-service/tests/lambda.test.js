jest.mock('../src/config', () => ({
  databaseUrl: undefined,
  jwtSecret: undefined,
  corsOrigins: ['http://localhost:3000'],
  aws: { useSecretsManager: true },
}));
jest.mock('../src/db', () => ({ query: jest.fn() }));
jest.mock('../src/aws/stockExport', () => ({ exportCurrentStock: jest.fn() }));
jest.mock('../src/aws/audit', () => ({ donationCreated: jest.fn() }));
jest.mock('../src/aws/secrets', () => ({
  loadDatabaseSecret: jest.fn(async () => {
    const config = require('../src/config');
    config.databaseUrl = 'postgresql://test-only';
    config.jwtSecret = 'lambda-test-secret-0123456789abcdef';
    return true;
  }),
}));

const { handler } = require('../src/lambda/apiHandler');
const { loadDatabaseSecret } = require('../src/aws/secrets');

function healthEvent() {
  return {
    version: '2.0',
    routeKey: 'GET /health',
    rawPath: '/health',
    rawQueryString: '',
    headers: { host: 'inventory.test' },
    requestContext: {
      http: { method: 'GET', path: '/health', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1' },
      requestId: 'lambda-test', stage: '$default', timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

test('Lambda cold start loads secrets and serves the existing health route', async () => {
  const response = await handler(healthEvent(), {});
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toEqual({ service: 'inventory-service', status: 'ok' });
  expect(loadDatabaseSecret).toHaveBeenCalledTimes(1);
});

test('Lambda warm invocation reuses the initialized Express handler', async () => {
  const response = await handler(healthEvent(), {});
  expect(response.statusCode).toBe(200);
  expect(loadDatabaseSecret).toHaveBeenCalledTimes(1);
});
