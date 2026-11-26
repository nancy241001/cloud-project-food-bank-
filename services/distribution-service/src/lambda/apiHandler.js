// Lambda entry point. Secrets are loaded BEFORE the app is required, because config.js and the DB pool read process.env on load.
const serverless = require('serverless-http');
const { loadSecrets } = require('../aws/secrets');

let handler;
exports.handler = async (event, context) => {
  if (!handler) {
    await loadSecrets();
    handler = serverless(require('../app'));
  }
  return handler(event, context);
};
