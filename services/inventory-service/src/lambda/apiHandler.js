// Runs the existing Inventory Express app in Lambda behind API Gateway.
// Local development continues to use src/server.js and port 3001.
const serverless = require('serverless-http');
const config = require('../config');
const db = require('../db');
const createApp = require('../app');
const { loadDatabaseSecret } = require('../aws/secrets');
const stockExporter = require('../aws/stockExport');
const audit = require('../aws/audit');

let handler;

exports.handler = async (event, context) => {
  if (!handler) {
    await loadDatabaseSecret();
    if (!config.databaseUrl) throw new Error('DATABASE_URL not loaded');
    if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET not loaded');
    const app = createApp({
      db,
      jwtSecret: config.jwtSecret,
      corsOrigins: config.corsOrigins,
      stockExporter,
      audit,
    });
    handler = serverless(app);
  }
  return handler(event, context);
};
