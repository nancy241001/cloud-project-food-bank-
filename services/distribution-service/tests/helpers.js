const jwt = require('jsonwebtoken');
const token = (role = 'staff', id = 5, opts = {}) =>
  jwt.sign({ sub: String(id), role, name: 'Tester' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h', ...opts });
module.exports = { token, auth: (t) => ({ Authorization: `Bearer ${t}` }) };
