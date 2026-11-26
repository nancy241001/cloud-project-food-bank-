const { PutObjectCommand } = require('@aws-sdk/client-s3');
const clients = require('./clients');
const config = require('../config');

const columns = ['item_id', 'name', 'category', 'quantity', 'unit', 'expiry_date', 'storage_location'];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

async function exportCurrentStock(rows, actorId) {
  const key = `inventory/current-stock-${Date.now()}-actor-${actorId}.csv`;
  await clients.s3().send(new PutObjectCommand({
    Bucket: config.aws.exportsBucket,
    Key: key,
    Body: toCsv(rows),
    ContentType: 'text/csv; charset=utf-8',
    ServerSideEncryption: 'AES256',
  }));
  return { bucket: config.aws.exportsBucket, key };
}

module.exports = { exportCurrentStock, toCsv };
