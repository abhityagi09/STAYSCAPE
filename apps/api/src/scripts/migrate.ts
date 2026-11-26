/**
 * Apply pending data migrations (release step, before switching traffic to the new version):
 *   npm run db:migrate            or   node dist/scripts/migrate.js
 *   npm run db:migrate -- --dry-run   list pending migrations without applying them
 */
import mongoose from 'mongoose';
import { loadConfig } from '@/config/env';
import { loadDotenv } from '@/config/load-dotenv';
import { connectMongo } from '@/infrastructure/database';
import { createLogger } from '@/lib/logger';
import { runMigrations } from '@/migrations/runner';

async function main() {
  loadDotenv();
  const config = loadConfig();
  await connectMongo(config, createLogger({ ...config, LOG_LEVEL: 'warn' }));
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const result = await runMigrations(db, { dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
