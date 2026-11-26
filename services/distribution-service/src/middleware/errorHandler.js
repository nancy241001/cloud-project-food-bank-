const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  logger.error('SERVER_ERROR', { message: err.message, path: req.path }); // never sent to the client
  return res.status(500).json({ error: 'Internal server error' });
};
