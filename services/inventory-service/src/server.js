const config = require('./config');
const db = require('./db');
const createApp = require('./app');
const { loadDatabaseSecret } = require('./aws/secrets');
const stockExporter = require('./aws/stockExport');
const audit = require('./aws/audit');

async function main() {
  const loadedSecret = await loadDatabaseSecret();
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET is missing or shorter than 32 characters');
  if (!config.databaseUrl) throw new Error('DATABASE_URL is missing');

  const app = createApp({ db, jwtSecret: config.jwtSecret, corsOrigins: config.corsOrigins, stockExporter, audit });
  const server = app.listen(config.port, () => {
    console.log(`Inventory service listening on port ${config.port}${loadedSecret ? ' (database config loaded from Secrets Manager)' : ''}`);
  });

  async function shutdown() {
    server.close(async () => { await db.close(); process.exit(0); });
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`Inventory service failed to start: ${err.message}`);
  process.exit(1);
});
