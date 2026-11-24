const { Pool, types } = require('pg');
const config = require('./config');

types.setTypeParser(1082, (value) => value);
types.setTypeParser(20, (value) => Number(value));

let pool;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
    const needsTls = /neon\.tech|sslmode=require/.test(config.databaseUrl);
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: needsTls ? { rejectUnauthorized: true } : undefined,
      max: 5,
    });
  }
  return pool;
}

function query(text, params = []) {
  return getPool().query(text, params);
}

async function close() {
  if (pool) await pool.end();
  pool = undefined;
}

module.exports = { query, close };
