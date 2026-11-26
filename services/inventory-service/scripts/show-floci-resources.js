/* eslint-disable no-console */
// Read-only evidence viewer for the Inventory resources already stored in Floci.
// Deliberately never requests or displays a Secrets Manager secret value.
const path = require('path');
const dotenv = require('dotenv');
const {
  S3Client, ListObjectsV2Command, GetObjectCommand,
} = require('@aws-sdk/client-s3');
const {
  SecretsManagerClient, DescribeSecretCommand,
} = require('@aws-sdk/client-secrets-manager');
const {
  CloudWatchLogsClient, FilterLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const itemId = 24;
const endpoint = process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';
const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.INVENTORY_EXPORTS_BUCKET || 'foodbank-inventory-exports';
const secretId = process.env.INVENTORY_SECRET_ID || 'foodbank/mohamed/inventory';
const logGroup = process.env.CW_LOG_GROUP || '/foodbank/inventory';
const base = {
  region,
  endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
};

async function findCsvObject(s3) {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'inventory/' }));
  const objects = (listed.Contents || [])
    .filter((object) => object.Key.endsWith('.csv'))
    .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  for (const object of objects) {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
    const csv = await result.Body.transformToString();
    const hasItem = csv.split(/\r?\n/).slice(1).some((line) => line.startsWith(`${itemId},`));
    if (hasItem) return object;
  }
  throw new Error(`No CSV export containing test item ID ${itemId} was found`);
}

async function main() {
  const s3 = new S3Client({ ...base, forcePathStyle: true });
  const secrets = new SecretsManagerClient(base);
  const logs = new CloudWatchLogsClient(base);

  const [secret, csvObject, logResult] = await Promise.all([
    secrets.send(new DescribeSecretCommand({ SecretId: secretId })),
    findCsvObject(s3),
    logs.send(new FilterLogEventsCommand({
      logGroupName: logGroup,
      filterPattern: 'INVENTORY_DONATION_CREATED',
    })),
  ]);
  const logEntry = (logResult.events || [])
    .map((entry) => ({ timestamp: entry.timestamp, message: JSON.parse(entry.message) }))
    .find((entry) => entry.message.itemId === itemId);
  if (!logEntry) throw new Error(`No donation audit event for item ID ${itemId} was found`);

  const event = {
    event: logEntry.message.event,
    itemId: logEntry.message.itemId,
    quantity: logEntry.message.quantity,
    actorId: logEntry.message.actorId,
  };

  console.log('FLOCI 2.4.0 — INVENTORY RESOURCE EVIDENCE');
  console.log('');
  console.log('Secrets Manager (name only)');
  console.log(`  Name: ${secret.Name}`);
  console.log('');
  console.log('S3 CSV export');
  console.log(`  Bucket: ${bucket}`);
  console.log(`  Key: ${csvObject.Key}`);
  console.log(`  Size: ${csvObject.Size} bytes`);
  console.log(`  Verified test item ID: ${itemId}`);
  console.log('');
  console.log('CloudWatch Logs donation event');
  console.log(`  Log group: ${logGroup}`);
  console.log(`  Timestamp: ${new Date(logEntry.timestamp).toISOString()}`);
  console.log(`  Event: ${JSON.stringify(event)}`);
  console.log('');
  console.log('READ-ONLY CHECK COMPLETE — no secret values requested or displayed');
}

main().catch((err) => {
  console.error(`Read-only Floci evidence check failed: ${err.message}`);
  process.exitCode = 1;
});
