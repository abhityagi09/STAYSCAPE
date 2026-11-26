import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { loadConfig, type Config } from '@/config/env';
import { loadDotenv } from '@/config/load-dotenv';
import { buildContainer, type Container } from '@/container';
import { connectMongo, disconnectMongo } from '@/infrastructure/database';
import { createMailProvider } from '@/infrastructure/mail/mail.provider';
import { BullJobQueue, startBullWorker } from '@/infrastructure/queue/job-queue';
import { connectRedis } from '@/infrastructure/redis';
import {
  createPrivateStorageProvider,
  createStorageProvider,
} from '@/infrastructure/storage/storage.provider';
import {
  MAINTENANCE_QUEUE_NAME,
  createMaintenanceHandlers,
  scheduleMaintenance,
  type MaintenanceJobs,
} from '@/jobs/maintenance.jobs';
import { ensureInventoryValidator } from '@/modules/inventory/inventory.models';
import { createEmailHandlers, EMAIL_QUEUE_NAME, type EmailJobs } from '@/jobs/email.jobs';
import { createDomainEventHandlers } from '@/jobs/domain-events.jobs';
import { DOMAIN_EVENTS_QUEUE_NAME, type DomainEventJobs } from '@/modules/outbox/outbox.service';
import { createLogger, type Logger } from '@/lib/logger';

export interface Runtime {
  config: Config;
  logger: Logger;
  container: Container;
  redis: Redis;
  workers: Worker[];
  shutdown: () => Promise<void>;
}

/** Load config, connect to every dependency and build the container. Fails fast on error. */
export async function bootstrap(options: { startWorkers?: boolean } = {}): Promise<Runtime> {
  loadDotenv();
  const config = loadConfig();
  const logger = createLogger(config);

  try {
    await connectMongo(config, logger);
  } catch (error) {
    logger.fatal(
      { err: (error as Error).message },
      'Could not connect to MongoDB. Is it running? Start local services with `npm run services:up`.',
    );
    throw error;
  }

  let redis: Redis;
  try {
    redis = await connectRedis(config.REDIS_URL, logger);
  } catch (error) {
    logger.fatal(
      { err: (error as Error).message },
      'Could not connect to Redis. Is it running? Start local services with `npm run services:up`.',
    );
    await disconnectMongo();
    throw error;
  }

  const mailer = createMailProvider(config, logger);
  const emailQueue = new BullJobQueue<EmailJobs>(EMAIL_QUEUE_NAME, redis);
  const domainEventQueue = new BullJobQueue<DomainEventJobs>(DOMAIN_EVENTS_QUEUE_NAME, redis);
  const storage = createStorageProvider(config);
  const privateStorage = createPrivateStorageProvider(config);
  const container = buildContainer({
    config,
    logger,
    redis,
    mailer,
    emailQueue,
    storage,
    privateStorage,
    domainEventQueue,
  });
  // Database-level availability invariant (idempotent).
  await ensureInventoryValidator().catch((error: unknown) =>
    logger.warn({ err: error }, 'Could not apply inventory validator'),
  );

  const workers: Worker[] = [];
  let maintenanceQueue: Awaited<ReturnType<typeof scheduleMaintenance>> | null = null;
  if (options.startWorkers ?? config.RUN_WORKERS) {
    workers.push(
      startBullWorker<EmailJobs>(EMAIL_QUEUE_NAME, redis, createEmailHandlers(mailer), logger),
    );
    logger.info({ queue: EMAIL_QUEUE_NAME, mail: mailer.name }, 'Email worker started');
    const {
      media,
      bookings,
      outbox,
      payments,
      lifecycle,
      bookingNotifications,
      refunds,
      documents,
      finance,
      intelligence,
      rewards,
    } = container.services;
    workers.push(
      startBullWorker<DomainEventJobs>(
        DOMAIN_EVENTS_QUEUE_NAME,
        redis,
        createDomainEventHandlers({ notifications: bookingNotifications, refunds, documents }),
        logger,
      ),
    );
    workers.push(
      startBullWorker<MaintenanceJobs>(
        MAINTENANCE_QUEUE_NAME,
        redis,
        createMaintenanceHandlers({
          media,
          bookings,
          outbox,
          payments,
          lifecycle,
          finance,
          intelligence,
          rewards,
          orphanTtlHours: config.MEDIA_ORPHAN_TTL_HOURS,
          logger,
        }),
        logger,
      ),
    );
    maintenanceQueue = await scheduleMaintenance(redis);
    logger.info({ queue: MAINTENANCE_QUEUE_NAME }, 'Maintenance jobs scheduled');
  }

  const shutdown = async () => {
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await emailQueue.close().catch(() => undefined);
    await domainEventQueue.close().catch(() => undefined);
    await maintenanceQueue?.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await disconnectMongo().catch(() => undefined);
  };

  return { config, logger, container, redis, workers, shutdown };
}

/** Registers SIGINT/SIGTERM handlers that run `cleanup` once, with a hard timeout. */
export function handleShutdownSignals(
  logger: Logger,
  cleanup: () => Promise<void>,
  timeoutMs = 15_000,
) {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const timer = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    cleanup()
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}
