const CATEGORIES = new Set(['dairy', 'bakery', 'fresh', 'dry', 'canned', 'frozen', 'beverages', 'hygiene', 'other']);
const DONOR_TYPES = new Set(['individual', 'shop', 'organization']);

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function today() { return new Date().toISOString().slice(0, 10); }
function nonEmpty(value, max) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function optionalString(value, max) { return value === undefined || value === null || (typeof value === 'string' && value.trim().length <= max); }
function validId(value) { return /^\d+$/.test(String(value)) && Number(value) > 0; }

module.exports = { CATEGORIES, DONOR_TYPES, isDate, today, nonEmpty, optionalString, validId };
