import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import { MIGRATIONS, type Migration } from './index';

const COLLECTION = 'schema_migrations';
const LOCK_ID = '__lock__';
const LOCK_TTL_MS = 15 * 60_000;

export interface MigrationResult {
  applied: Array<{ id: string; modified: number; ms: number }>;
  pending: string[];
  alreadyApplied: string[];
}

/**
 * Applies pending migrations once, in id order, under a database lock so two release jobs
 * cannot run them concurrently. Each applied id is recorded with its timestamp and result.
 */
export async function runMigrations(
  db: Db,
  options: { dryRun?: boolean; migrations?: Migration[]; owner?: string } = {},
): Promise<MigrationResult> {
  const list = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  for (const m of list) {
    if (ids.has(m.id)) throw new Error(`Duplicate migration id ${m.id}`);
    ids.add(m.id);
  }
  const col = db.collection<{ _id: string; appliedAt?: Date; owner?: string; expiresAt?: Date }>(
    COLLECTION,
  );
  const done = new Set(
    (await col.find({ _id: { $ne: LOCK_ID } }, { projection: { _id: 1 } }).toArray()).map(
      (d) => d._id,
    ),
  );
  const pending = list.filter((m) => !done.has(m.id));
  const result: MigrationResult = {
    applied: [],
    pending: pending.map((m) => m.id),
    alreadyApplied: [...done].sort(),
  };
  if (options.dryRun || pending.length === 0) return result;

  const owner = options.owner ?? randomUUID();
  const now = new Date();
  try {
    await col.findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ expiresAt: { $lt: now } }, { owner }] },
      { $set: { owner, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new Error('Another migration run holds the lock; try again when it finishes.');
    throw error;
  }
  try {
    for (const m of pending) {
      const started = Date.now();
      const { modified } = await m.up(db);
      await col.insertOne({
        _id: m.id,
        appliedAt: new Date(),
        owner,
        description: m.description,
        modified,
      } as never);
      result.applied.push({ id: m.id, modified, ms: Date.now() - started });
    }
  } finally {
    await col.deleteOne({ _id: LOCK_ID, owner });
  }
  result.pending = [];
  return result;
}
