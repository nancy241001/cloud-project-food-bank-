// One JSON line per event. Anything that looks like a secret or personal data is redacted.
const REDACT = /pass|token|secret|authorization|phone|email|hash|cookie/i;

function log(level, event, fields = {}) {
  if (process.env.LOG_SILENT === 'true') return;
  const safe = {};
  for (const [k, v] of Object.entries(fields)) safe[k] = REDACT.test(k) ? '[REDACTED]' : v;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...safe }));
}

module.exports = {
  info: (event, fields) => log('info', event, fields),
  warn: (event, fields) => log('warn', event, fields),
  error: (event, fields) => log('error', event, fields),
};
