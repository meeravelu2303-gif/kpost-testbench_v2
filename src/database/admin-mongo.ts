import { env } from '@config/env';
import { MongoClient, ReadPreference, type Document, type Filter } from 'mongodb';

/**
 * A read-only view of the Admin MongoDB for cross-layer checks. The Admin DB is live, so only
 * `findOne` and `find` exist; `ADMIN_MONGO_URI` may hold credentials and is never logged.
 */
export interface AdminMongoReader {
  findOne<T extends Document>(collection: string, filter: Filter<T>): Promise<T | null>;
  find<T extends Document>(collection: string, filter: Filter<T>, limit?: number): Promise<T[]>;
  close(): Promise<void>;
}

/** Collections the reader may read: the Admin entities' `@Document` names (Admin_Module/entity). */
const READABLE = /^table_admin_[a-z_]+$/;

function collectionName(name: string): string {
  if (!READABLE.test(name)) throw new Error(`admin-mongo: "${name}" is not an Admin collection`);
  return name;
}

/** The reader, or undefined when `ADMIN_MONGO_URI` is not configured. */
export async function openAdminMongoReader(): Promise<AdminMongoReader | undefined> {
  if (!env.ADMIN_MONGO_URI) return undefined;
  const client = new MongoClient(env.ADMIN_MONGO_URI, {
    readPreference: ReadPreference.SECONDARY_PREFERRED,
    serverSelectionTimeoutMS: 10_000,
    appName: 'kpost-testbench-readonly',
  });
  try {
    await client.connect();
  } catch {
    // Never echo the URI: it may hold a password.
    throw new Error('admin-mongo: could not connect to ADMIN_MONGO_URI (check host and access)');
  }
  const db = client.db(env.ADMIN_MONGO_DB);
  return {
    findOne: <T extends Document>(collection: string, filter: Filter<T>) =>
      db.collection<T>(collectionName(collection)).findOne(filter) as Promise<T | null>,
    find: <T extends Document>(collection: string, filter: Filter<T>, limit = 50) =>
      db.collection<T>(collectionName(collection)).find(filter).limit(limit).toArray() as Promise<
        T[]
      >,
    close: () => client.close(),
  };
}
