import type { FinanceService } from '@/modules/finance/finance.service';
import type { IntelligenceService } from '@/modules/intelligence/intelligence.service';
import type { RewardsService } from '@/modules/rewards/rewards.service';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { CurrencyService } from '@/modules/currency/currency.service';
import { Queue, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Types } from 'mongoose';
import type { JobHandler } from '@/infrastructure/queue/job-queue';
import type { Logger } from '@/lib/logger';
import type { BookingsService } from '@/modules/bookings/bookings.service';
import type { LifecycleService } from '@/modules/bookings/lifecycle.service';
import { HotelModel } from '@/modules/hotels/hotel.model';
import type { MediaService } from '@/modules/media/media.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import { PartnerModel } from '@/modules/partners/partner.model';
import type { PaymentsService } from '@/modules/payments/payments.service';
import { ReviewModel } from '@/modules/reviews/review.models';
import { RoomTypeModel } from '@/modules/rooms/room.models';
import { TicketMessageModel } from '@/modules/support/support.models';

export const MAINTENANCE_QUEUE_NAME = 'stayscape-maintenance';

export type MaintenanceJobs = {
  'media.cleanup': Record<string, never>;
  'bookings.expire-holds': Record<string, never>;
  'outbox.dispatch': Record<string, never>;
  'payments.reconcile': Record<string, never>;
  'bookings.complete-stays': Record<string, never>;
  'bookings.checkin-reminders': Record<string, never>;
  'finance.backfill': Record<string, never>;
  'prices.observe': Record<string, never>;
  'prices.alerts': Record<string, never>;
  'rewards.accrue': Record<string, never>;
  'channels.sync': Record<string, never>;
  'currency.refresh': Record<string, never>;
};

/** Every place a media asset can be referenced from. */
export async function referencedMediaIds(ids: Types.ObjectId[]): Promise<Set<string>> {
  const [hotels, revisions, rooms, partners, reviews, messages] = await Promise.all([
    HotelModel.find({ 'images.mediaId': { $in: ids } }, { images: 1 }).lean<
      Array<{ images: Array<{ mediaId: Types.ObjectId }> }>
    >(),
    HotelModel.find({ 'revision.data.images.mediaId': { $in: ids } }, { revision: 1 }).lean<
      Array<{ revision: { data: { images?: Array<{ mediaId: Types.ObjectId }> } } }>
    >(),
    RoomTypeModel.find({ 'images.mediaId': { $in: ids } }, { images: 1 }).lean<
      Array<{ images: Array<{ mediaId: Types.ObjectId }> }>
    >(),
    PartnerModel.find(
      { 'verificationDocuments.mediaId': { $in: ids } },
      { verificationDocuments: 1 },
    ).lean<Array<{ verificationDocuments: Array<{ mediaId: Types.ObjectId }> }>>(),
    ReviewModel.find({ photoIds: { $in: ids } }, { photoIds: 1 }).lean<
      Array<{ photoIds: Types.ObjectId[] }>
    >(),
    TicketMessageModel.find({ attachmentIds: { $in: ids } }, { attachmentIds: 1 }).lean<
      Array<{ attachmentIds: Types.ObjectId[] }>
    >(),
  ]);
  const set = new Set<string>();
  for (const h of hotels) h.images.forEach((i) => set.add(i.mediaId.toString()));
  for (const h of revisions)
    (h.revision.data.images ?? []).forEach((i) => set.add(i.mediaId.toString()));
  for (const r of rooms) r.images.forEach((i) => set.add(i.mediaId.toString()));
  for (const p of partners) p.verificationDocuments.forEach((d) => set.add(d.mediaId.toString()));
  for (const r of reviews) r.photoIds.forEach((id) => set.add(id.toString()));
  for (const m of messages) m.attachmentIds.forEach((id) => set.add(id.toString()));
  return set;
}

export interface MaintenanceDeps {
  media: MediaService;
  bookings: BookingsService;
  outbox: OutboxService;
  payments: PaymentsService;
  lifecycle: LifecycleService;
  finance: FinanceService;
  intelligence: IntelligenceService;
  rewards: RewardsService;
  channels: ChannelsService;
  currency: CurrencyService;
  orphanTtlHours: number;
  logger: Logger;
}

export function createMaintenanceHandlers(deps: MaintenanceDeps): {
  [K in keyof MaintenanceJobs]: JobHandler<MaintenanceJobs[K]>;
} {
  const log = (n: number | object, msg: string) => {
    if (typeof n === 'number' ? n > 0 : Object.values(n).some((v) => v > 0))
      deps.logger.info({ result: n }, msg);
  };
  return {
    'media.cleanup': async () =>
      log(
        await deps.media.cleanupOrphans(
          new Date(Date.now() - deps.orphanTtlHours * 3600_000),
          referencedMediaIds,
        ),
        'Removed orphaned media',
      ),
    'bookings.expire-holds': async () =>
      log(await deps.bookings.expireHolds(), 'Expired inventory holds released'),
    'outbox.dispatch': async () =>
      log(await deps.outbox.dispatchPending(), 'Outbox events dispatched'),
    'payments.reconcile': async () =>
      log(await deps.payments.reconcile(), 'Payment reconciliation'),
    'bookings.complete-stays': async () =>
      log(await deps.lifecycle.completeStays(), 'Stays completed'),
    'bookings.checkin-reminders': async () =>
      log(await deps.lifecycle.remindCheckins(), 'Check-in reminders queued'),
    'finance.backfill': async () => log(await deps.finance.backfillConfirmedBookings(), 'Ledger postings backfilled'),
    'prices.observe': async () => log(await deps.intelligence.observePrices(), 'Price observations recorded'),
    'prices.alerts': async () => log(await deps.intelligence.checkAlerts(), 'Price alerts checked'),
    'currency.refresh': async () => {
      const r = await deps.currency.refresh();
      if (r.stored) deps.logger.info(r, 'Exchange reference rates stored');
    },
    'channels.sync': async () => log(await deps.channels.runScheduled(), 'Channel retries and availability sync'),
    'rewards.accrue': async () => {
      log(await deps.rewards.accrue(), 'Loyalty points posted');
      log(await deps.rewards.releaseExpiredRedemptions(), 'Expired points coupons released');
      log(await deps.rewards.qualifyReferrals(), 'Referrals evaluated');
    },
  };
}

/** Register repeatable maintenance jobs (idempotent: schedulers are upserted by id). */
export async function scheduleMaintenance(connection: Redis): Promise<Queue> {
  const queue = new Queue(MAINTENANCE_QUEUE_NAME, {
    connection: connection as unknown as ConnectionOptions,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
  });
  await queue.upsertJobScheduler(
    'media-cleanup',
    { every: 60 * 60_000 },
    { name: 'media.cleanup', data: {} },
  );
  // Hold expiry must not depend on MongoDB TTL (it would not release counters): explicit sweep.
  await queue.upsertJobScheduler(
    'bookings-expire-holds',
    { every: 30_000 },
    { name: 'bookings.expire-holds', data: {} },
  );
  await queue.upsertJobScheduler(
    'outbox-dispatch',
    { every: 10_000 },
    { name: 'outbox.dispatch', data: {} },
  );
  await queue.upsertJobScheduler(
    'payments-reconcile',
    { every: 2 * 60_000 },
    { name: 'payments.reconcile', data: {} },
  );
  await queue.upsertJobScheduler(
    'bookings-complete-stays',
    { every: 60 * 60_000 },
    { name: 'bookings.complete-stays', data: {} },
  );
  await queue.upsertJobScheduler(
    'bookings-checkin-reminders',
    { every: 60 * 60_000 },
    { name: 'bookings.checkin-reminders', data: {} },
  );
  await queue.upsertJobScheduler('finance-backfill', { every: 60 * 60_000 }, { name: 'finance.backfill', data: {} });
  // Once a day is enough: observations are keyed per property-local day (repeat runs are no-ops).
  await queue.upsertJobScheduler('prices-observe', { every: 6 * 60 * 60_000 }, { name: 'prices.observe', data: {} });
  await queue.upsertJobScheduler('prices-alerts', { every: 60 * 60_000 }, { name: 'prices.alerts', data: {} });
  await queue.upsertJobScheduler('currency-refresh', { every: 6 * 60 * 60_000 }, { name: 'currency.refresh', data: {} });
  await queue.upsertJobScheduler('channels-sync', { every: 5 * 60_000 }, { name: 'channels.sync', data: {} });
  await queue.upsertJobScheduler('rewards-accrue', { every: 60 * 60_000 }, { name: 'rewards.accrue', data: {} });
  // Remove the Phase 2 scheduler that this one replaces.
  await queue.removeJobScheduler('inventory-expire-holds').catch(() => undefined);
  return queue;
}
