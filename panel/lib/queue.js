const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const scrapeQueue = new Queue('scrape', { connection });

module.exports = { scrapeQueue, connection };
