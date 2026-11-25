import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { VerificationTokenModel } from '@/modules/auth/verification-token.model';
import { NewsletterSubscriptionModel } from '@/modules/newsletter/newsletter-subscription.model';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { RefreshSessionModel } from '@/modules/sessions/refresh-session.model';
import { UserModel } from '@/modules/users/user.model';
import {
  AmenityModel,
  DestinationModel,
  SearchEventModel,
  WishlistItemModel,
} from '@/modules/catalog/catalog.models';
import { HotelModel } from '@/modules/hotels/hotel.model';
import {
  DailyInventoryModel,
  InventoryHoldModel,
  ensureInventoryValidator,
} from '@/modules/inventory/inventory.models';
import { MediaAssetModel } from '@/modules/media/media-asset.model';
import { PartnerModel, PartnerStaffModel } from '@/modules/partners/partner.model';
import { PricingRuleModel, RatePlanModel, RoomTypeModel } from '@/modules/rooms/room.models';

/** Every persistence model, used for index synchronisation and test cleanup. */
export const ALL_MODELS = [
  UserModel,
  RefreshSessionModel,
  VerificationTokenModel,
  AuditLogModel,
  NotificationModel,
  NewsletterSubscriptionModel,
  MediaAssetModel,
  PartnerModel,
  PartnerStaffModel,
  AmenityModel,
  DestinationModel,
  SearchEventModel,
  WishlistItemModel,
  HotelModel,
  RoomTypeModel,
  RatePlanModel,
  PricingRuleModel,
  DailyInventoryModel,
  InventoryHoldModel,
] as const;

export async function syncAllIndexes(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const model of ALL_MODELS) {
    await model.createCollection().catch(() => undefined);
    const dropped = await model.syncIndexes();
    result[model.modelName] = dropped;
  }
  await ensureInventoryValidator();
  return result;
}
