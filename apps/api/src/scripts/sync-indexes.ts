/**
 * Creates/updates every declared index. Production runs with autoIndex disabled, so run this
 * as a release step: `npm run db:indexes` (or `node dist/scripts/sync-indexes.js`).
 */
import mongoose from 'mongoose';
import { loadConfig } from '@/config/env';
import { loadDotenv } from '@/config/load-dotenv';
import { connectMongo } from '@/infrastructure/database';
import { syncAllIndexes } from '@/infrastructure/models';
import { createLogger } from '@/lib/logger';

async function main() {
  loadDotenv();
  const config = loadConfig();
  const logger = createLogger(config);
  await connectMongo(config, logger);
  const dropped = await syncAllIndexes();
  for (const [model, names] of Object.entries(dropped)) {
    console.log(
      `${model}: indexes in sync${names.length ? ` (dropped stale: ${names.join(', ')})` : ''}`,
    );
  }
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
