const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const clients = require('./clients');
const config = require('../config');

async function loadDatabaseSecret() {
  if (!config.aws.useSecretsManager) return false;
  const output = await clients.secrets().send(new GetSecretValueCommand({ SecretId: config.aws.secretId }));
  const secret = JSON.parse(output.SecretString || '{}');
  if (typeof secret.DATABASE_URL !== 'string' || !secret.DATABASE_URL) {
    throw new Error(`Secret ${config.aws.secretId} does not contain DATABASE_URL`);
  }
  config.databaseUrl = secret.DATABASE_URL;
  if (typeof secret.JWT_SECRET === 'string' && secret.JWT_SECRET) config.jwtSecret = secret.JWT_SECRET;
  return true;
}

module.exports = { loadDatabaseSecret };
