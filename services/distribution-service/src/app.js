const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const requestLog = require('./middleware/requestLog');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1); // behind API Gateway
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: config.rateLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down' } }));
app.use(requestLog);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'distribution-service' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/families', require('./routes/families'));
app.use('/api/distributions', require('./routes/distributions'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
