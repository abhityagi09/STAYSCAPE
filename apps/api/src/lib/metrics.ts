import type { NextFunction, Request, Response } from 'express';
import { Queue, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import mongoose from 'mongoose';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { EMAIL_QUEUE_NAME } from '@/jobs/email.jobs';
import { MAINTENANCE_QUEUE_NAME } from '@/jobs/maintenance.jobs';
import { BookingHoldModel, BookingModel } from '@/modules/bookings/booking.models';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { OutboxEventModel } from '@/modules/outbox/outbox.models';
import { DOMAIN_EVENTS_QUEUE_NAME } from '@/modules/outbox/outbox.service';
import { PaymentEventModel, PaymentModel, RefundModel } from '@/modules/payments/payment.models';

/**
 * Prometheus metrics. Request metrics are recorded in-process; business gauges (reconciliation
 * backlog, failed refunds, queue depth, inventory invariant breaches…) are computed from the
 * database and Redis at scrape time, so every API replica reports the same shared state.
 * Alert rules that consume these live in infrastructure/monitoring/alerts.yml.
 */
/** Memoise an expensive collector for ttlMs (errors are not cached). */
function cached(ttlMs: number, fn: () => Promise<number>): () => Promise<number> {
  let value: number | null = null;
  let at = 0;
  return async () => {
    if (value !== null && Date.now() - at < ttlMs) return value;
    value = await fn();
    at = Date.now();
    return value;
  };
}

export class Metrics {
  readonly registry = new Registry();
  private readonly httpDuration = new Histogram({
    name: 'stayscape_http_request_duration_seconds',
    help: 'HTTP request latency by route template, method and status class.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  private readonly httpErrors = new Counter({
    name: 'stayscape_http_server_errors_total',
    help: 'Responses with status >= 500, by route template.',
    labelNames: ['method', 'route'] as const,
    registers: [this.registry],
  });
  private queues: Queue[] = [];

  constructor(redis: Redis | null) {
    collectDefaultMetrics({ register: this.registry, prefix: 'stayscape_' });
    if (redis) {
      this.queues = [EMAIL_QUEUE_NAME, DOMAIN_EVENTS_QUEUE_NAME, MAINTENANCE_QUEUE_NAME].map(
        (name) => new Queue(name, { connection: redis as unknown as ConnectionOptions }),
      );
    }
    this.registerBusinessGauges(redis);
  }

  /** Express middleware: one observation per response, labelled by the matched route template. */
  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const end = this.httpDuration.startTimer();
      res.on('finish', () => {
        // Route templates keep label cardinality bounded (never raw URLs with ids).
        const route = req.route?.path
          ? `${req.baseUrl}${String(req.route.path)}`
          : res.statusCode === 404
            ? 'unmatched'
            : req.baseUrl || 'unmatched';
        const status = `${Math.floor(res.statusCode / 100)}xx`;
        end({ method: req.method, route, status });
        if (res.statusCode >= 500) this.httpErrors.inc({ method: req.method, route });
      });
      next();
    };
  }

  private registerBusinessGauges(redis: Redis | null) {
    const r = this.registry;
    const gauge = (name: string, help: string, collect: () => Promise<number>) =>
      new Gauge({
        name,
        help,
        registers: [r],
        async collect() {
          try {
            this.set(await collect());
          } catch {
            // A failing source reports -1 so alerts can tell "unknown" from "zero".
            this.set(-1);
          }
        },
      });
    gauge('stayscape_mongo_up', 'MongoDB reachable (1/0).', async () => {
      const db = mongoose.connection.db;
      if (!db) return 0;
      await db.admin().ping();
      return 1;
    });
    gauge('stayscape_redis_up', 'Redis reachable (1/0).', async () => {
      if (!redis) return 0;
      return (await redis.ping()) === 'PONG' ? 1 : 0;
    });
    gauge(
      'stayscape_bookings_reconciliation_required',
      'Bookings with a verified payment that could not be allocated (needs operator action).',
      () => BookingModel.countDocuments({ bookingStatus: 'RECONCILIATION_REQUIRED' }),
    );
    gauge(
      'stayscape_bookings_payment_processing_stale',
      'Bookings stuck in PAYMENT_PROCESSING for more than 30 minutes.',
      () =>
        BookingModel.countDocuments({
          bookingStatus: 'PAYMENT_PROCESSING',
          updatedAt: { $lt: new Date(Date.now() - 30 * 60_000) },
        }),
    );
    gauge(
      'stayscape_holds_overdue',
      'Active holds past expiry by more than 5 minutes (expiry job not keeping up).',
      () =>
        BookingHoldModel.countDocuments({
          status: 'ACTIVE',
          expiresAt: { $lt: new Date(Date.now() - 5 * 60_000) },
        }),
    );
    // This check scans every current and future inventory night, so it is computed at most every
    // five minutes per replica (the invariant is also enforced by a database validator).
    gauge(
      'stayscape_inventory_invariant_violations',
      'Inventory days where held + booked + blocked exceeds total rooms (must always be 0).',
      cached(
        5 * 60_000,
        async () =>
          (
            await DailyInventoryModel.aggregate<{ n: number }>([
              // Only current and future nights matter; past days are immutable history.
              {
                $match: {
                  localDate: {
                    $gte: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
                  },
                },
              },
              {
                $match: {
                  $expr: {
                    $gt: [{ $add: ['$heldRooms', '$bookedRooms', '$blockedRooms'] }, '$totalRooms'],
                  },
                },
              },
              { $count: 'n' },
            ])
          )[0]?.n ?? 0,
      ),
    );
    gauge('stayscape_payments_failed_last_hour', 'Payments that failed in the last hour.', () =>
      PaymentModel.countDocuments({
        status: 'FAILED',
        updatedAt: { $gt: new Date(Date.now() - 3_600_000) },
      }),
    );
    gauge(
      'stayscape_payment_webhooks_failed',
      'Signature-verified webhook events whose processing failed.',
      () => PaymentEventModel.countDocuments({ processingStatus: 'FAILED' }),
    );
    gauge('stayscape_refunds_failed', 'Refunds in FAILED state awaiting retry.', () =>
      RefundModel.countDocuments({ status: 'FAILED' }),
    );
    gauge('stayscape_outbox_failed', 'Domain events that exhausted their retries.', () =>
      OutboxEventModel.countDocuments({ status: 'FAILED' }),
    );
    const queueGauge = new Gauge({
      name: 'stayscape_queue_jobs',
      help: 'BullMQ jobs by queue and state.',
      labelNames: ['queue', 'state'] as const,
      registers: [r],
      collect: async () => {
        for (const queue of this.queues) {
          try {
            const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
            for (const [state, n] of Object.entries(counts))
              queueGauge.set({ queue: queue.name, state }, n);
          } catch {
            queueGauge.set({ queue: queue.name, state: 'unknown' }, -1);
          }
        }
      },
    });
  }

  async close() {
    await Promise.allSettled(this.queues.map((q) => q.close()));
  }
}
