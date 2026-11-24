require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((value) => value.trim()),
  aws: {
    endpoint: process.env.AWS_ENDPOINT_URL || undefined,
    region: process.env.AWS_REGION || 'us-east-1',
    useSecretsManager: process.env.USE_SECRETS_MANAGER === 'true',
    secretId: process.env.INVENTORY_SECRET_ID || 'foodbank/mohamed/inventory',
    exportsBucket: process.env.INVENTORY_EXPORTS_BUCKET || 'foodbank-inventory-exports',
    logGroup: process.env.CW_LOG_GROUP || '',
  },
};
