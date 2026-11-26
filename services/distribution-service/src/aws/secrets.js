// Deployed on Floci/AWS: read DATABASE_URL and JWT_SECRET from Secrets Manager instead of a file.
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function loadSecrets() {
  if (process.env.USE_SECRETS_MANAGER !== 'true') return;
  const client = new SecretsManagerClient({}); // endpoint comes from AWS_ENDPOINT_URL (Floci sets it in Lambda)
  const res = await client.send(new GetSecretValueCommand({ SecretId: process.env.APP_SECRET_ID }));
  const data = JSON.parse(res.SecretString);
  for (const k of ['DATABASE_URL', 'JWT_SECRET']) if (data[k]) process.env[k] = data[k];
}

module.exports = { loadSecrets };
