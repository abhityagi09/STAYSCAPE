import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@/lib/logger';

export interface JobOptions {
  /** Deduplication key — enqueueing the same id twice is a no-op (idempotency). */
  jobId?: string;
  attempts?: number;
}

export type JobHandler<T> = (data: T) => Promise<void>;

export interface JobQueue<TJobs extends Record<string, unknown>> {
  enqueue<K extends keyof TJobs & string>(
    name: K,
    data: TJobs[K],
    options?: JobOptions,
  ): Promise<void>;
  close(): Promise<void>;
}

/** Production queue backed by BullMQ/Redis with retries and exponential back-off. */
export class BullJobQueue<TJobs extends Record<string, unknown>> implements JobQueue<TJobs> {
  private readonly queue: Queue;

  constructor(name: string, connection: Redis) {
    this.queue = new Queue(name, {
      connection: connection as unknown as ConnectionOptions,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        // Job payloads can contain one-time links; do not retain them after completion.
        removeOnComplete: true,
        removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
      },
    });
  }

  async enqueue<K extends keyof TJobs & string>(name: K, data: TJobs[K], options: JobOptions = {}) {
    await this.queue.add(name, data, {
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.attempts ? { attempts: options.attempts } : {}),
    });
  }

  async close() {
    await this.queue.close();
  }
}

export function startBullWorker<TJobs extends Record<string, unknown>>(
  name: string,
  connection: Redis,
  handlers: { [K in keyof TJobs]: JobHandler<TJobs[K]> },
  logger: Logger,
): Worker {
  const worker = new Worker(
    name,
    async (job) => {
      const handler = handlers[job.name as keyof TJobs];
      if (!handler) throw new Error(`No handler registered for job "${job.name}"`);
      await handler(job.data as TJobs[keyof TJobs]);
    },
    // Workers need a dedicated blocking connection.
    { connection: connection.duplicate() as unknown as ConnectionOptions, concurrency: 5 },
  );
  worker.on('completed', (job) => logger.info({ jobId: job.id, job: job.name }, 'Job completed'));
  worker.on('failed', (job, error) =>
    logger.error(
      { jobId: job?.id, job: job?.name, attempts: job?.attemptsMade, err: error.message },
      'Job failed',
    ),
  );
  return worker;
}

/**
 * Executes jobs immediately in-process. Used by the automated tests (no Redis).
 * Mirrors the queue's idempotency semantics: a repeated jobId is ignored.
 */
export class InlineJobQueue<TJobs extends Record<string, unknown>> implements JobQueue<TJobs> {
  private readonly seen = new Set<string>();

  constructor(private readonly handlers: { [K in keyof TJobs]: JobHandler<TJobs[K]> }) {}

  async enqueue<K extends keyof TJobs & string>(name: K, data: TJobs[K], options: JobOptions = {}) {
    if (options.jobId) {
      if (this.seen.has(options.jobId)) return;
      this.seen.add(options.jobId);
    }
    await this.handlers[name](data);
  }

  async close() {}
}
