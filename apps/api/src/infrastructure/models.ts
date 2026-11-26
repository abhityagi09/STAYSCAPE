import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { VerificationTokenModel } from '@/modules/auth/verification-token.model';
import { NewsletterSubscriptionModel } from '@/modules/newsletter/newsletter-subscription.model';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { RefreshSessionModel } from '@/modules/sessions/refresh-session.model';
import { UserModel } from '@/modules/users/user.model';
import { AmenityModel, DestinationModel, SearchEventModel } from '@/modules/catalog/catalog.models';
import { HotelModel } from '@/modules/hotels/hotel.model';
import {
  DailyInventoryModel,
  ensureInventoryValidator,
} from '@/modules/inventory/inventory.models';
import { CounterModel } from '@/lib/references';
import {
  BookingHoldModel,
  BookingModel,
  CancellationModel,
} from '@/modules/bookings/booking.models';
import { BookingNoteModel } from '@/modules/bookings/partner-reservations.service';
import { InvoiceModel } from '@/modules/documents/invoice.model';
import { NotificationDeliveryModel, OutboxEventModel } from '@/modules/outbox/outbox.models';
import {
  PaymentEventModel,
  PaymentModel,
  RefundModel,
  SandboxRecordModel,
} from '@/modules/payments/payment.models';
import { ReviewModel, ReviewReportModel } from '@/modules/reviews/review.models';
import { SupportTicketModel, TicketMessageModel } from '@/modules/support/support.models';
import { WishlistModel } from '@/modules/wishlists/wishlist.model';
import { CouponModel, CouponRedemptionModel, CouponUsageModel } from '@/modules/coupons/coupons.models';
import { HotelDailyStatModel } from '@/modules/analytics/hotel-stats.model';
import { BookingEscalationModel, PropertyCategoryModel } from '@/modules/admin/admin.models';
import { ContentEntryModel, ContentRevisionModel } from '@/modules/content/content.models';
import { CommissionRuleModel, LedgerEntryModel, SettlementAllocationModel, SettlementModel } from '@/modules/finance/finance.models';
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
  HotelModel,
  RoomTypeModel,
  RatePlanModel,
  PricingRuleModel,
  DailyInventoryModel,
  CounterModel,
  BookingHoldModel,
  BookingModel,
  CancellationModel,
  BookingNoteModel,
  PaymentModel,
  PaymentEventModel,
  RefundModel,
  SandboxRecordModel,
  OutboxEventModel,
  NotificationDeliveryModel,
  InvoiceModel,
  WishlistModel,
  CommissionRuleModel,
  LedgerEntryModel,
  SettlementModel,
  SettlementAllocationModel,
  CouponModel,
  CouponUsageModel,
  CouponRedemptionModel,
  HotelDailyStatModel,
  PropertyCategoryModel,
  BookingEscalationModel,
  ContentEntryModel,
  ContentRevisionModel,
  ReviewModel,
  ReviewReportModel,
  SupportTicketModel,
  TicketMessageModel,
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
