// External API: Have I Been Pwned "Pwned Passwords" range API (k-anonymity).
// Only the first 5 characters of the SHA-1 hash leave the server, never the password.
// Fails open: if the API is slow or down, creating a user still works (returns 0).
const crypto = require('crypto');
const logger = require('../utils/logger');

const URL_BASE = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 3000;

async function breachCount(password) {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(URL_BASE + prefix, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'food-bank-distribution-service' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    for (const line of text.split('\n')) {
      const [hashSuffix, count] = line.trim().split(':');
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch (err) {
    logger.warn('PWNED_PASSWORDS_UNAVAILABLE', { message: err.message });
    return 0;
  }
}

module.exports = { breachCount };
