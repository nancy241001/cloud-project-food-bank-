require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3002,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || false, // false = no CORS headers at all
  tokenTtl: process.env.TOKEN_TTL || '2h',
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT) || 10,
  rateLimit: Number(process.env.RATE_LIMIT) || 300,
};

if (!config.jwtSecret || config.jwtSecret.length < 16) throw new Error('JWT_SECRET is missing or too short (see .env.example)');
if (!config.databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');

module.exports = config;
