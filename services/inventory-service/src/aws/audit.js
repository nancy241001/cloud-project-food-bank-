const { CreateLogStreamCommand, PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const clients = require('./clients');
const config = require('../config');

const streamName = `inventory-api-${new Date().toISOString().slice(0, 10)}-${process.pid}`;
let streamReady = false;

async function donationCreated({ itemId, quantity, actorId }) {
  if (!config.aws.logGroup) return;
  if (!streamReady) {
    await clients.logs().send(new CreateLogStreamCommand({
      logGroupName: config.aws.logGroup,
      logStreamName: streamName,
    })).catch((err) => {
      if (err.name !== 'ResourceAlreadyExistsException') throw err;
    });
    streamReady = true;
  }
  const message = JSON.stringify({
    event: 'INVENTORY_DONATION_CREATED', itemId, quantity, actorId,
  });
  await clients.logs().send(new PutLogEventsCommand({
    logGroupName: config.aws.logGroup,
    logStreamName: streamName,
    logEvents: [{ timestamp: Date.now(), message }],
  }));
}

module.exports = { donationCreated };
