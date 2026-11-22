// Starts the API: load secrets first (Secrets Manager or .env), then listen.
const config = require('./config');
const { loadSecretsIntoEnv } = require('./aws/secrets');
const logger = require('./utils/logger');

async function start() {
  await loadSecretsIntoEnv();
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters');
  }
  const app = require('./app');
  app.listen(config.port, () => logger.info('SERVER_STARTED', { port: config.port, env: config.nodeEnv }));
}

start().catch((err) => {
  console.error('failed to start:', err.message);
  process.exit(1);
});
