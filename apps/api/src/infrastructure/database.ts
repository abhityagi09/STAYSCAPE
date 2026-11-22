import mongoose from 'mongoose';
import type { Config } from '@/config/env';
import type { Logger } from '@/lib/logger';

// Unknown filter paths are dropped. NoSQL operator injection is prevented at the edge:
// every request value is parsed by a Zod schema into primitives before reaching a query.
mongoose.set('strictQuery', true);

export async function connectMongo(
  config: Pick<Config, 'MONGO_URI' | 'MONGO_SERVER_SELECTION_TIMEOUT_MS' | 'isProduction'>,
  logger: Logger,
): Promise<typeof mongoose> {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (error: Error) =>
    logger.error({ err: error.message }, 'MongoDB error'),
  );

  const connection = await mongoose.connect(config.MONGO_URI, {
    serverSelectionTimeoutMS: config.MONGO_SERVER_SELECTION_TIMEOUT_MS,
    autoIndex: !config.isProduction,
  });

  const hello = (await connection.connection.db?.admin().command({ hello: 1 })) as
    { setName?: string; isWritablePrimary?: boolean } | undefined;
  if (!hello?.setName) {
    logger.warn('MongoDB is not running as a replica set; multi-document transactions will fail.');
  }
  logger.info({ replicaSet: hello?.setName ?? null }, 'MongoDB connected');
  return connection;
}

export async function pingMongo(): Promise<number> {
  const started = performance.now();
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    throw new Error('MongoDB not connected');
  }
  await mongoose.connection.db.admin().ping();
  return Math.round(performance.now() - started);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
