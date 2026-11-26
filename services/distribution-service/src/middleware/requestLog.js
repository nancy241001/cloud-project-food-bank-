const logger = require('../utils/logger');

// One log line per request: method, path, status, time, user id and role. Never the body or the token.
module.exports = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('REQUEST', {
      method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      ms: Date.now() - start, userId: req.user && req.user.id, role: req.user && req.user.role,
    });
  });
  next();
};
