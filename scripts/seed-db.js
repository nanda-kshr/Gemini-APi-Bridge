// One-off seed script for dev/testing (CommonJS)
// Usage: `node scripts/seed-db.js`

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
const DB = process.env.MONGO_DB_NAME || 'gemini_bridge';

if (!MONGO_URI) {
  console.error('MONGO_URI is not set in environment. Aborting.');
  process.exit(1);
}

const client = new MongoClient(MONGO_URI);

async function run() {
  await client.connect();
  const db = client.db(DB);

  const internal = db.collection('internal_clients');
  const pool = db.collection('gemini_pool');

  // Upsert test internal client
  await internal.updateOne(
    { api_key: 'bridge_secret_abc123' },
    {
      $set: {
        client_name: 'Project-Idea-Generator',
        api_key: 'bridge_secret_abc123',
        status: 'active',
      },
    },
    { upsert: true },
  );

  // Insert your free key (replace if exists)
  await pool.updateOne(
    { key_value: 'SOME_FREE_KEY_VALUE' },
    {
      $set: {
        key_value: 'SOME_FREE_KEY_VALUE', // Replace with your actual free key value
        mode: 'free',
        model_name: 'gemini-3.1-flash-lite-preview',
        last_used: new Date(0),
        is_rate_limited: false,
        rate_limit_expiry: null,
      },
    },
    { upsert: true },
  );

  console.log('Seed complete.');
  await client.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
