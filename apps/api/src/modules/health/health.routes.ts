import { Router, type Request, type Response } from 'express';
import type { HealthDto } from '@stayscape/shared';
import type { Container } from '@/container';
import { pingMongo } from '@/infrastructure/database';
import { pingRedis } from '@/infrastructure/redis';

type Check = () => Promise<number>;

export interface HealthChecks {
  mongodb: Check;
  redis: Check;
}

async function runCheck(
  check: Check,
  timeoutMs = 2_000,
): Promise<{ status: 'up' | 'down'; latencyMs?: number }> {
  try {
    const latencyMs = await Promise.race([
      check(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return { status: 'up', latencyMs };
  } catch {
    // Failure detail is intentionally omitted from the response.
    return { status: 'down' };
  }
}

export function createHealthRouter(container: Container, checks?: Partial<HealthChecks>): Router {
  const router = Router();
  const { config } = container;
  const allChecks: HealthChecks = {
    mongodb: checks?.mongodb ?? pingMongo,
    redis: checks?.redis ?? (() => pingRedis(container.redis)),
  };

  const base = (status: HealthDto['status']): HealthDto => ({
    status,
    service: 'stayscape-api',
    version: config.APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });

  const readiness = async () => {
    const [mongodb, redis] = await Promise.all([
      runCheck(allChecks.mongodb),
      runCheck(allChecks.redis),
    ]);
    const ready = mongodb.status === 'up' && redis.status === 'up';
    return { ready, body: { ...base(ready ? 'ok' : 'unavailable'), checks: { mongodb, redis } } };
  };

  /** Liveness: the process is running and the event loop responds. No dependency checks. */
  router.get('/live', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store').json({ success: true, data: base('ok') });
  });

  /** Readiness: required dependencies are reachable. Returns 503 when they are not. */
  router.get('/ready', async (_req: Request, res: Response) => {
    const { ready, body } = await readiness();
    res
      .set('Cache-Control', 'no-store')
      .status(ready ? 200 : 503)
      .json({ success: ready, data: body });
  });

  /** Summary: always 200 while the process is alive, reporting degraded dependencies. */
  router.get('/', async (_req: Request, res: Response) => {
    const { ready, body } = await readiness();
    res
      .set('Cache-Control', 'no-store')
      .json({ success: true, data: { ...body, status: ready ? 'ok' : 'degraded' } });
  });

  return router;
}
