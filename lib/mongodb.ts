import { Collection, MongoClient, ObjectId } from "mongodb";

type InternalClient = {
  _id: ObjectId;
  client_name: string;
  api_key: string;
  status: "active" | "inactive";
};

type GeminiPoolKey = {
  _id: ObjectId;
  key_value: string;
  mode: "free" | "paid";
  model_name: string;
  last_used?: Date | null;
  is_rate_limited?: boolean;
  rate_limit_expiry?: Date | null;
};

type BridgeDb = {
  internal_clients: InternalClient;
  gemini_pool: GeminiPoolKey;
};

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error("MONGO_URI is required");
}

const dbName = process.env.MONGO_DB_NAME ?? "gemini_bridge";

const globalForMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

const mongoClientPromise =
  globalForMongo._mongoClientPromise ?? new MongoClient(mongoUri).connect();

if (process.env.NODE_ENV !== "production") {
  globalForMongo._mongoClientPromise = mongoClientPromise;
}

let indexesPromise: Promise<void> | undefined;

export async function getBridgeDb() {
  const client = await mongoClientPromise;
  const db = client.db(dbName);

  return {
    collection<TName extends keyof BridgeDb>(name: TName) {
      return db.collection<BridgeDb[TName]>(name) as Collection<BridgeDb[TName]>;
    },
  };
}

export async function ensureBridgeIndexes() {
  if (indexesPromise) {
    return indexesPromise;
  }

  indexesPromise = (async () => {
    const { collection } = await getBridgeDb();

    await collection("internal_clients").createIndex(
      { api_key: 1 },
      { unique: true, name: "uniq_internal_clients_api_key" },
    );

    await collection("gemini_pool").createIndex(
      { mode: 1, is_rate_limited: 1, rate_limit_expiry: 1, last_used: 1 },
      { name: "idx_gemini_pool_mode_health_lru" },
    );

    await collection("gemini_pool").createIndex(
      { mode: 1, last_used: 1 },
      { name: "idx_gemini_pool_mode_lru" },
    );
  })();

  return indexesPromise;
}

export type { InternalClient, GeminiPoolKey };
