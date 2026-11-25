import type { ClientSession } from 'mongoose';
import type { JobQueue } from '@/infrastructure/queue/job-queue';
import type { Logger } from '@/lib/logger';
import { OutboxEventModel, type OutboxEventRecord } from './outbox.models';

/**
 * Domain events. Notification events fan out to in-app + email deliveries; command events drive
 * background work (refund processing, document generation). Every handler is idempotent.
 */
export const DOMAIN_EVENT_TYPES = [
  'booking.created',
  'payment.succeeded',
  'payment.failed',
  'booking.confirmed',
  'booking.cancelled',
  'booking.expired',
  'booking.reconciliation_required',
  'refund.requested',
  'refund.completed',
  'refund.failed',
  'checkin.reminder',
  'review.reminder',
  'review.responded',
  // commands
  'refund.process',
  'documents.generate',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEvent {
  eventId: string;
  type: DomainEventType;
  aggregateType: 'Booking' | 'Refund' | 'Review';
  aggregateId: string;
  payload: Record<string, string | number | boolean | null>;
}

export type DomainEventJobs = { [K in DomainEventType]: DomainEvent };
export const DOMAIN_EVENTS_QUEUE_NAME = 'stayscape-domain-events';

const LOCK_MS = 60_000;
const MAX_DISPATCH_ATTEMPTS = 10;

export class OutboxService {
  constructor(
    private readonly queue: JobQueue<DomainEventJobs>,
    private readonly logger: Logger,
  ) {}

  /**
   * Record an event inside the caller's transaction. Upsert-on-insert makes it idempotent:
   * re-recording the same eventId (e.g. a retried webhook) is a no-op, and it never raises a
   * duplicate-key error that would abort the surrounding transaction.
   */
  async add(
    event: DomainEvent,
    session: ClientSession | null,
    options: { availableAt?: Date } = {},
  ): Promise<void> {
    await OutboxEventModel.updateOne(
      { eventId: event.eventId },
      {
        $setOnInsert: {
          eventId: event.eventId,
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          status: 'PENDING',
          attempts: 0,
          availableAt: options.availableAt ?? new Date(),
          createdAt: new Date(),
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
  }

  /** Claim one dispatchable event (pending, or a stale claim from a crashed dispatcher). */
  private claim(now: Date): Promise<OutboxEventRecord | null> {
    return OutboxEventModel.findOneAndUpdate(
      {
        $or: [
          { status: 'PENDING', availableAt: { $lte: now } },
          { status: 'DISPATCHING', lockedUntil: { $lt: now } },
        ],
      },
      {
        $set: { status: 'DISPATCHING', lockedUntil: new Date(now.getTime() + LOCK_MS) },
        $inc: { attempts: 1 },
      },
      { sort: { availableAt: 1 }, new: true },
    ).lean<OutboxEventRecord>();
  }

  /**
   * Move committed events to the job queue. Safe to run concurrently (atomic claims) and after a
   * crash (stale claims are reclaimed). The queue de-duplicates by job id = eventId.
   */
  async dispatchPending(limit = 100): Promise<number> {
    let dispatched = 0;
    for (let i = 0; i < limit; i += 1) {
      const now = new Date();
      const event = await this.claim(now);
      if (!event) break;
      try {
        await this.queue.enqueue(
          event.type as DomainEventType,
          {
            eventId: event.eventId,
            type: event.type as DomainEventType,
            aggregateType: event.aggregateType as DomainEvent['aggregateType'],
            aggregateId: event.aggregateId,
            payload: event.payload as DomainEvent['payload'],
          },
          { jobId: event.eventId },
        );
        await OutboxEventModel.updateOne(
          { _id: event._id, status: 'DISPATCHING' },
          {
            $set: {
              status: 'DISPATCHED',
              dispatchedAt: new Date(),
              lockedUntil: null,
              lastError: null,
            },
          },
        );
        dispatched += 1;
      } catch (error) {
        const failed = event.attempts >= MAX_DISPATCH_ATTEMPTS;
        const backoffMs = Math.min(15 * 60_000, 1_000 * 2 ** event.attempts);
        await OutboxEventModel.updateOne(
          { _id: event._id },
          {
            $set: {
              status: failed ? 'FAILED' : 'PENDING',
              availableAt: new Date(Date.now() + backoffMs),
              lockedUntil: null,
              lastError: (error as Error).message.slice(0, 1000),
            },
          },
        );
        this.logger.warn(
          { err: (error as Error).message, eventId: event.eventId, attempts: event.attempts },
          failed ? 'Outbox event failed permanently' : 'Outbox dispatch failed; will retry',
        );
      }
    }
    return dispatched;
  }

  /** Best-effort immediate dispatch after a commit; the scheduled sweep covers any failure. */
  async kick(): Promise<void> {
    try {
      await this.dispatchPending(50);
    } catch (error) {
      this.logger.warn(
        { err: (error as Error).message },
        'Outbox kick failed; the sweep will retry',
      );
    }
  }

  async stats(): Promise<{ pending: number; failed: number }> {
    const [pending, failed] = await Promise.all([
      OutboxEventModel.countDocuments({ status: { $in: ['PENDING', 'DISPATCHING'] } }),
      OutboxEventModel.countDocuments({ status: 'FAILED' }),
    ]);
    return { pending, failed };
  }
}
