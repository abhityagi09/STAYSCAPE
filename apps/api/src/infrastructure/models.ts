import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { VerificationTokenModel } from '@/modules/auth/verification-token.model';
import { NewsletterSubscriptionModel } from '@/modules/newsletter/newsletter-subscription.model';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { RefreshSessionModel } from '@/modules/sessions/refresh-session.model';
import { UserModel } from '@/modules/users/user.model';

/** Every persistence model, used for index synchronisation and test cleanup. */
export const ALL_MODELS = [
  UserModel,
  RefreshSessionModel,
  VerificationTokenModel,
  AuditLogModel,
  NotificationModel,
  NewsletterSubscriptionModel,
] as const;

export async function syncAllIndexes(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const model of ALL_MODELS) {
    await model.createCollection().catch(() => undefined);
    const dropped = await model.syncIndexes();
    result[model.modelName] = dropped;
  }
  return result;
}
