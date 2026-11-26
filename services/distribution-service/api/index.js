// Vercel entry point: runs the same Express app as server.js and the Lambda handler.
// Secrets come from Vercel environment variables (DATABASE_URL, JWT_SECRET, CORS_ORIGIN), never from code.
// src/config.js already refuses to start without DATABASE_URL and JWT_SECRET.
const config = require('../src/config');

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET is shorter than 32 characters');
}

module.exports = require('../src/app');
