const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('./auth');
const itemRouter = require('./items');

function createApp({ db, jwtSecret, corsOrigins = ['http://localhost:3000'], stockExporter, audit }) {
  if (!jwtSecret) throw new Error('JWT_SECRET is required');
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '50kb' }));
  app.get('/health', (req, res) => res.json({ service: 'inventory-service', status: 'ok' }));
  app.use('/api/items', authMiddleware(jwtSecret), itemRouter(db, { stockExporter, audit }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
    console.error('Inventory request failed', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

module.exports = createApp;
