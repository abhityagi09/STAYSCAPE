import mongoose, { type ClientSession } from 'mongoose';

/**
 * Run `work` inside a MongoDB transaction. Requires a replica set (the local Docker
 * setup and the test harness both provide one). `withTransaction` retries on
 * transient transaction errors, so `work` must be safe to re-run.
 */
export async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
