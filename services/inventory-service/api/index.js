// Vercel entry point: creates the same Express app used by local Node and Floci Lambda.
// Runtime values come from Vercel environment variables, never from source code.
const config = require('../src/config');
const db = require('../src/db');
const createApp = require('../src/app');
const stockExporter = require('../src/aws/stockExport');
const audit = require('../src/aws/audit');

if (!config.databaseUrl) throw new Error('DATABASE_URL is missing');
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET is missing or shorter than 32 characters');
}

module.exports = createApp({
  db,
  jwtSecret: config.jwtSecret,
  corsOrigins: config.corsOrigins,
  stockExporter,
  audit,
});
