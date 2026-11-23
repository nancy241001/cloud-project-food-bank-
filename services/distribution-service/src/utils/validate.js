const { httpError } = require('./httpError');

// Validate with a Zod schema; any problem becomes a 400 with a readable message.
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw httpError(400, msg);
  }
  return result.data;
}

module.exports = { parse };
