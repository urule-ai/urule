import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { installations } from './schema/installations.js';
import { versionHistory } from './schema/version-history.js';

export const schema = { installations, versionHistory };

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
