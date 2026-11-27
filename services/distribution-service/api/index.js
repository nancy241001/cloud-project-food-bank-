// Vercel entry point: Vercel runs this file as a serverless function and vercel.json sends every URL to it.
// The Express app is the same one used locally (src/server.js) and on Floci (src/lambda/apiHandler.js).
module.exports = require('../src/app');
