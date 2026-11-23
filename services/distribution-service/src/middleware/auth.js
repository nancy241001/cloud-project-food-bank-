const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

const ROLES = ['staff', 'admin'];

// Verifies the token on every protected route. HS256 only (blocks the "alg: none" trick).
function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    logger.warn('AUTH_MISSING_TOKEN', { path: req.path });
    return res.status(401).json({ error: 'Authentication required' });
  }
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    logger.warn('AUTH_INVALID_TOKEN', { path: req.path });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id < 1) {
    logger.warn('AUTH_INVALID_TOKEN', { path: req.path, reason: 'bad_sub' });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!ROLES.includes(payload.role)) {
    logger.warn('ACCESS_DENIED_ROLE', { userId: id, path: req.path, reason: 'unknown_role' });
    return res.status(403).json({ error: 'Forbidden' });
  }
  req.user = { id, role: payload.role, name: payload.name };
  return next();
}

// Role check in the BACKEND: staff get 403 even if the page hides the button.
const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user || !allowed.includes(req.user.role)) {
    logger.warn('ACCESS_DENIED_ROLE', { userId: req.user && req.user.id, role: req.user && req.user.role, path: req.path });
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
};

module.exports = { requireAuth, requireRole };
