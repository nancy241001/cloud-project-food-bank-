/* eslint-disable no-console */
// End-to-end Floci check. Reads real values only from the ignored local .env.
// It never prints the database URL, JWT secret, token, or donor details.
const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const {
  S3Client, CreateBucketCommand, PutPublicAccessBlockCommand, PutBucketEncryptionCommand,
  GetObjectCommand, HeadObjectCommand, GetPublicAccessBlockCommand, GetBucketEncryptionCommand,
} = require('@aws-sdk/client-s3');
const {
  SecretsManagerClient, CreateSecretCommand, PutSecretValueCommand, DescribeSecretCommand,
} = require('@aws-sdk/client-secrets-manager');
const {
  CloudWatchLogsClient, CreateLogGroupCommand, PutRetentionPolicyCommand, FilterLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

const serviceDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(serviceDir, '..', '..');
dotenv.config({ path: path.join(serviceDir, '.env'), quiet: true });

const endpoint = process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';
const region = process.env.AWS_REGION || 'us-east-1';
const bucket = process.env.INVENTORY_EXPORTS_BUCKET || 'foodbank-inventory-exports';
const secretId = process.env.INVENTORY_SECRET_ID || 'foodbank/mohamed/inventory';
const logGroup = process.env.CW_LOG_GROUP || '/foodbank/inventory';
const port = 3101;
const testName = `Floci verification stock ${Date.now()}`;
const base = {
  region, endpoint,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
};

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error('The ignored services/inventory-service/.env must contain DATABASE_URL and JWT_SECRET');
}

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const s3 = new S3Client({ ...base, forcePathStyle: true });
const secrets = new SecretsManagerClient(base);
const logs = new CloudWatchLogsClient(base);

async function provision() {
  const secretString = JSON.stringify({ DATABASE_URL: databaseUrl });
  try {
    await secrets.send(new DescribeSecretCommand({ SecretId: secretId }));
    await secrets.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: secretString }));
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    await secrets.send(new CreateSecretCommand({ Name: secretId, SecretString: secretString }));
  }
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((err) => {
    if (!['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes(err.name)) throw err;
  });
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true,
    },
  }));
  await s3.send(new PutBucketEncryptionCommand({
    Bucket: bucket,
    ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
  }));
  await logs.send(new CreateLogGroupCommand({ logGroupName: logGroup })).catch((err) => {
    if (err.name !== 'ResourceAlreadyExistsException') throw err;
  });
  await logs.send(new PutRetentionPolicyCommand({ logGroupName: logGroup, retentionInDays: 14 }));
}

function startService() {
  const env = { ...process.env,
    PORT: String(port), USE_SECRETS_MANAGER: 'true', INVENTORY_SECRET_ID: secretId,
    INVENTORY_EXPORTS_BUCKET: bucket, CW_LOG_GROUP: logGroup, AWS_ENDPOINT_URL: endpoint,
    AWS_REGION: region, AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
  };
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, [path.join(serviceDir, 'src', 'server.js')], {
    cwd: repoDir, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function waitForService(processInfo) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (processInfo.child.exitCode !== null) throw new Error(`Service exited during startup: ${processInfo.output()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for Inventory service');
}

async function api(method, route, token, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${route} failed with ${response.status}: ${payload?.error || 'unknown error'}`);
  return payload;
}

async function findAudit(itemId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await logs.send(new FilterLogEventsCommand({
      logGroupName: logGroup, filterPattern: 'INVENTORY_DONATION_CREATED',
    }));
    const event = (result.events || []).map((entry) => JSON.parse(entry.message)).find((entry) => entry.itemId === itemId);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function main() {
  await provision();
  const pool = new Pool({ connectionString: databaseUrl, ssl: /neon\.tech|sslmode=require/.test(databaseUrl) ? { rejectUnauthorized: true } : undefined });
  let createdId;
  let processInfo;
  try {
    const actorResult = await pool.query('SELECT created_by AS user_id FROM food_items WHERE created_by IS NOT NULL ORDER BY item_id LIMIT 1');
    if (!actorResult.rows.length) throw new Error('No existing inventory creator is available for the test foreign key');
    const actorId = actorResult.rows[0].user_id;
    const token = jwt.sign({ sub: String(actorId), role: 'admin', name: 'Floci verifier' }, jwtSecret, { algorithm: 'HS256', expiresIn: '10m' });

    processInfo = startService();
    await waitForService(processInfo);
    const donation = await api('POST', '/api/items', token, {
      name: testName, category: 'dry', quantity: 7, unit: 'test-box',
      expiry_date: '2099-12-31', donor_type: 'organization',
    });
    createdId = donation.item_id;
    const exported = await api('POST', '/api/items/export', token);
    const access = await s3.send(new GetPublicAccessBlockCommand({ Bucket: exported.bucket }));
    if (Object.values(access.PublicAccessBlockConfiguration || {}).some((value) => value !== true)) {
      throw new Error('Export bucket does not block every form of public access');
    }
    const encryption = await s3.send(new GetBucketEncryptionCommand({ Bucket: exported.bucket }));
    if (encryption.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== 'AES256') {
      throw new Error('Export bucket does not use AES256 default encryption');
    }
    await s3.send(new HeadObjectCommand({ Bucket: exported.bucket, Key: exported.key }));
    const object = await s3.send(new GetObjectCommand({ Bucket: exported.bucket, Key: exported.key }));
    const csv = await object.Body.transformToString();
    if (!csv.includes(testName) || !csv.includes(`${createdId}`) || !csv.includes(',7,')) {
      throw new Error('Exported CSV does not contain the expected test inventory row');
    }
    const auditEvent = await findAudit(createdId);
    if (!auditEvent || auditEvent.quantity !== 7 || auditEvent.actorId !== actorId) {
      throw new Error('Matching CloudWatch audit event was not found');
    }
    const keys = Object.keys(auditEvent).sort();
    if (keys.join(',') !== ['actorId', 'event', 'itemId', 'quantity'].sort().join(',')) {
      throw new Error('Audit event contains unexpected fields');
    }
    console.log(JSON.stringify({
      secretsManager: 'PASS: service loaded inventory with DATABASE_URL absent from its environment',
      s3: `PASS: private CSV object exists and contains test item ${createdId}`,
      cloudWatchLogs: `PASS: minimal donation audit event exists for test item ${createdId}`,
    }, null, 2));
  } finally {
    if (createdId) await pool.query('DELETE FROM food_items WHERE item_id = $1', [createdId]).catch(() => {});
    await pool.end();
    if (processInfo?.child && processInfo.child.exitCode === null) processInfo.child.kill('SIGTERM');
  }
}

main().catch((err) => { console.error(`Floci verification failed: ${err.message}`); process.exitCode = 1; });
