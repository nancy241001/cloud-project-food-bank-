const { Pool, types } = require('pg');
const config = require('../config');

// DATE columns come back as plain 'YYYY-MM-DD' text, so an expiry date never shifts by a day with the time zone.
types.setTypeParser(1082, (v) => v);

const url = config.databaseUrl.replace(/[?&]channel_binding=require/, '');
const tls = /neon\.tech|sslmode=require/.test(url);

// Small pool: Neon's free tier limits connections, and every warm Lambda keeps its own.
module.exports = new Pool({
  connectionString: url,
  ssl: tls ? { rejectUnauthorized: true } : undefined,
  max: process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 5,
});
