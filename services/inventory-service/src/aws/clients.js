const { S3Client } = require('@aws-sdk/client-s3');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const config = require('../config');

const base = {
  region: config.aws.region,
  endpoint: config.aws.endpoint,
  ...(config.aws.endpoint ? {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    },
  } : {}),
};
let s3;
let secrets;
let logs;

module.exports = {
  s3: () => (s3 ||= new S3Client({ ...base, forcePathStyle: Boolean(config.aws.endpoint) })),
  secrets: () => (secrets ||= new SecretsManagerClient(base)),
  logs: () => (logs ||= new CloudWatchLogsClient(base)),
};
