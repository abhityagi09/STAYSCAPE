import { Redis } from 'ioredis';
import type { Logger } from '@/lib/logger';

export type RedisClient = Redis;

/**
 * Creates a Redis connection and waits until it is ready.
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking connections.
 */
export async function connectRedis(
  url: string,
  logger: Logger,
  timeoutMs = 10_000,
): Promise<Redis> {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
  client.on('error', (error) => logger.error({ err: error.message }, 'Redis error'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting'));

  await Promise.race([
    client.connect(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Redis did not become ready within ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
  logger.info('Redis connected');
  return client;
}

export async function pingRedis(client: Redis | null): Promise<number> {
  if (!client) throw new Error('Redis not configured');
  const started = performance.now();
  const reply = await client.ping();
  if (reply !== 'PONG') throw new Error('Unexpected Redis ping reply');
  return Math.round(performance.now() - started);
}
