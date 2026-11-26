import { Queue, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { EMAIL_QUEUE_NAME } from '@/jobs/email.jobs';
import { MAINTENANCE_QUEUE_NAME } from '@/jobs/maintenance.jobs';
import { DOMAIN_EVENTS_QUEUE_NAME } from '@/modules/outbox/outbox.service';
import { AppError, Errors } from '@/lib/errors';

export const QUEUE_NAMES = [
  EMAIL_QUEUE_NAME,
  DOMAIN_EVENTS_QUEUE_NAME,
  MAINTENANCE_QUEUE_NAME,
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface FailedJobDto {
  queue: QueueName;
  id: string;
  name: string;
  attemptsMade: number;
  failedReason: string;
  failedAt: string | null;
}

/**
 * Operator view of the BullMQ queues: counts per state, the most recent failures (dead letters:
 * jobs that exhausted their retries are kept for 7 days) and a manual retry. Job payloads are
 * never returned — they can contain one-time links and personal data.
 */
export class JobInspector {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(redis: Redis | null) {
    if (!redis) return;
    for (const name of QUEUE_NAMES)
      this.queues.set(name, new Queue(name, { connection: redis as unknown as ConnectionOptions }));
  }

  private require(name: string): Queue {
    if (this.queues.size === 0)
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Job queues are not configured in this environment.',
      );
    const queue = this.queues.get(name as QueueName);
    if (!queue) throw Errors.notFound('Unknown queue.');
    return queue;
  }

  async overview(limit = 20) {
    if (this.queues.size === 0)
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Job queues are not configured in this environment.',
      );
    const result = [];
    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );
      const failed = await queue.getFailed(0, limit - 1);
      result.push({
        queue: name,
        counts,
        failed: failed.map((job): FailedJobDto => ({
          queue: name,
          id: String(job.id),
          name: job.name,
          attemptsMade: job.attemptsMade,
          failedReason: (job.failedReason ?? '').slice(0, 500),
          failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        })),
      });
    }
    return result;
  }

  async retry(queueName: string, jobId: string) {
    const queue = this.require(queueName);
    const job = await queue.getJob(jobId);
    if (!job) throw Errors.notFound('Job not found.');
    if (!(await job.isFailed()))
      throw new AppError(409, 'INVALID_STATE', 'Only failed jobs can be retried.');
    await job.retry('failed');
    return { queue: queueName, id: jobId, retried: true };
  }

  async close() {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
