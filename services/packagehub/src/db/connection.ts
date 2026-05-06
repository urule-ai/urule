import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { packages } from './schema/packages.js';
import { packageVersions } from './schema/versions.js';
import { packagePubkeys } from './schema/package-pubkeys.js';

export const schema = { packages, packageVersions, packagePubkeys };

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
