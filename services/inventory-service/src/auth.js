const jwt = require('jsonwebtoken');

function authMiddleware(jwtSecret) {
  return (req, res, next) => {
    const match = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
    if (!match) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(match[1], jwtSecret, { algorithms: ['HS256'] });
      if (!['staff', 'admin'].includes(payload.role) || !/^\d+$/.test(String(payload.sub))) {
        return res.status(403).json({ error: 'You do not have permission to do this' });
      }
      req.user = { id: Number(payload.sub), role: payload.role, name: payload.name };
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'You do not have permission to do this' });
}

module.exports = { authMiddleware, requireRole };
