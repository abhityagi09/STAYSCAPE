import { Queue, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Types } from 'mongoose';
import type { JobHandler } from '@/infrastructure/queue/job-queue';
import type { Logger } from '@/lib/logger';
import { HotelModel } from '@/modules/hotels/hotel.model';
import type { InventoryService } from '@/modules/inventory/inventory.service';
import type { MediaService } from '@/modules/media/media.service';
import { PartnerModel } from '@/modules/partners/partner.model';
import { RoomTypeModel } from '@/modules/rooms/room.models';

export const MAINTENANCE_QUEUE_NAME = 'stayscape-maintenance';

export type MaintenanceJobs = {
  'media.cleanup': Record<string, never>;
  'inventory.expire-holds': Record<string, never>;
};

/** Every place a media asset can be referenced from. */
export async function referencedMediaIds(ids: Types.ObjectId[]): Promise<Set<string>> {
  const [hotels, revisions, rooms, partners] = await Promise.all([
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
  ]);
  const set = new Set<string>();
  for (const h of hotels) h.images.forEach((i) => set.add(i.mediaId.toString()));
  for (const h of revisions)
    (h.revision.data.images ?? []).forEach((i) => set.add(i.mediaId.toString()));
  for (const r of rooms) r.images.forEach((i) => set.add(i.mediaId.toString()));
  for (const p of partners) p.verificationDocuments.forEach((d) => set.add(d.mediaId.toString()));
  return set;
}

export function createMaintenanceHandlers(deps: {
  media: MediaService;
  inventory: InventoryService;
  orphanTtlHours: number;
  logger: Logger;
}): { [K in keyof MaintenanceJobs]: JobHandler<MaintenanceJobs[K]> } {
  return {
    'media.cleanup': async () => {
      const removed = await deps.media.cleanupOrphans(
        new Date(Date.now() - deps.orphanTtlHours * 3600_000),
        referencedMediaIds,
      );
      if (removed) deps.logger.info({ removed }, 'Removed orphaned media');
    },
    'inventory.expire-holds': async () => {
      const expired = await deps.inventory.expireHolds();
      if (expired) deps.logger.info({ expired }, 'Released expired inventory holds');
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
    { every: 60 * 60 * 1000 },
    { name: 'media.cleanup', data: {} },
  );
  await queue.upsertJobScheduler(
    'inventory-expire-holds',
    { every: 60 * 1000 },
    { name: 'inventory.expire-holds', data: {} },
  );
  return queue;
}
