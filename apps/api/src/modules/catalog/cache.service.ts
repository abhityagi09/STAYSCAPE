import type { Redis } from 'ioredis';
import type { Logger } from '@/lib/logger';

const VERSION_KEY = 'stayscape:cache:public:version';

/**
 * Short-lived cache for NON-transactional public data (destinations, amenities, featured lists).
 * Entries are namespaced by a version number that is incremented whenever publication state
 * changes, so stale lists disappear immediately. Availability and prices are never cached.
 */
export class CacheService {
  constructor(
    private readonly redis: Redis | null,
    private readonly ttlSeconds: number,
    private readonly logger: Logger,
  ) {}

  private enabled() {
    return this.redis !== null && this.ttlSeconds > 0;
  }

  async getOrSet<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.enabled()) return load();
    try {
      const version = (await this.redis!.get(VERSION_KEY)) ?? '0';
      const fullKey = `stayscape:cache:public:${version}:${key}`;
      const hit = await this.redis!.get(fullKey);
      if (hit) return JSON.parse(hit) as T;
      const value = await load();
      await this.redis!.set(fullKey, JSON.stringify(value), 'EX', this.ttlSeconds);
      return value;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Cache unavailable; serving uncached');
      return load();
    }
  }

  async invalidatePublic(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.incr(VERSION_KEY);
    } catch (error) {
      this.logger.warn({ err: error }, 'Cache invalidation failed');
    }
  }
}
