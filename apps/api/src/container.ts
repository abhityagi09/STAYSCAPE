import type { Redis } from 'ioredis';
import type { Config } from '@/config/env';
import type { MailProvider } from '@/infrastructure/mail/mail.provider';
import type { StorageProvider } from '@/infrastructure/storage/storage.provider';
import type { EmailQueue } from '@/jobs/email.jobs';
import type { Logger } from '@/lib/logger';
import { PasswordHasher } from '@/lib/password';
import { createAuthenticate } from '@/middleware/authenticate';
import { AuditRepository } from '@/modules/audit/audit.repository';
import { AuditService } from '@/modules/audit/audit.service';
import { AuthService } from '@/modules/auth/auth.service';
import { TokenService } from '@/modules/auth/token.service';
import { VerificationTokenRepository } from '@/modules/auth/verification-token.repository';
import { EmailService } from '@/modules/notifications/email.service';
import { NotificationRepository } from '@/modules/notifications/notification.repository';
import { NotificationService } from '@/modules/notifications/notification.service';
import { SessionRepository } from '@/modules/sessions/session.repository';
import { SessionService } from '@/modules/sessions/session.service';
import { UserRepository } from '@/modules/users/user.repository';
import { UsersService } from '@/modules/users/users.service';
import { FieldEncryptor } from '@/lib/field-encryption';
import { CacheService } from '@/modules/catalog/cache.service';
import { HotelsService } from '@/modules/hotels/hotels.service';
import { InventoryService } from '@/modules/inventory/inventory.service';
import { MediaService } from '@/modules/media/media.service';
import { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { PartnersService } from '@/modules/partners/partners.service';
import { QuoteService } from '@/modules/pricing/quote.service';
import { RoomsService } from '@/modules/rooms/rooms.service';
import { SearchService } from '@/modules/search/search.service';
import { InlineJobQueue, type JobHandler, type JobQueue } from '@/infrastructure/queue/job-queue';
import { createDomainEventHandlers } from '@/jobs/domain-events.jobs';
import { BookingsService } from '@/modules/bookings/bookings.service';
import { CancellationsService } from '@/modules/bookings/cancellations.service';
import { PartnerReservationsService } from '@/modules/bookings/partner-reservations.service';
import { CouponsService } from '@/modules/coupons/coupons.service';
import { FinanceService } from '@/modules/finance/finance.service';
import { LifecycleService } from '@/modules/bookings/lifecycle.service';
import { DocumentsService } from '@/modules/documents/documents.service';
import { BookingNotificationsService } from '@/modules/notifications/booking-notifications.service';
import {
  OutboxService,
  type DomainEvent,
  type DomainEventJobs,
} from '@/modules/outbox/outbox.service';
import { OperationsService } from '@/modules/payments/operations.service';
import { PaymentsService } from '@/modules/payments/payments.service';
import type { PaymentProvider } from '@/modules/payments/providers/payment-provider';
import { RazorpayProvider } from '@/modules/payments/providers/razorpay.provider';
import { SandboxPaymentProvider } from '@/modules/payments/providers/sandbox.provider';
import { RefundsService } from '@/modules/payments/refunds.service';
import { ReviewsService } from '@/modules/reviews/reviews.service';
import { SupportService } from '@/modules/support/support.service';
import { WishlistsService } from '@/modules/wishlists/wishlists.service';

export interface CoreDependencies {
  config: Config;
  logger: Logger;
  redis: Redis | null;
  mailer: MailProvider;
  emailQueue: EmailQueue;
  storage: StorageProvider;
  /** Never publicly served; used for verification documents. */
  privateStorage: StorageProvider;
  /** BullMQ queue for outbox events. Omitted in tests: events then run in-process. */
  domainEventQueue?: JobQueue<DomainEventJobs>;
  /** Override the payment gateway (tests). Defaults to PAYMENT_PROVIDER from config. */
  paymentProvider?: PaymentProvider;
}

/** In-process queue whose handlers are bound once the services that implement them exist. */
class LateBoundInlineQueue implements JobQueue<DomainEventJobs> {
  private inner: InlineJobQueue<DomainEventJobs> | null = null;
  bind(handlers: { [K in keyof DomainEventJobs]: JobHandler<DomainEvent> }) {
    this.inner = new InlineJobQueue<DomainEventJobs>(handlers);
  }
  async enqueue<K extends keyof DomainEventJobs & string>(
    name: K,
    data: DomainEventJobs[K],
    options?: { jobId?: string },
  ) {
    if (!this.inner) throw new Error('Domain event handlers are not bound yet');
    await this.inner.enqueue(name, data, options);
  }
  async close() {}
}

export function createPaymentProvider(config: Config, logger: Logger): PaymentProvider {
  if (config.PAYMENT_PROVIDER === 'razorpay') {
    return new RazorpayProvider(
      {
        keyId: config.RAZORPAY_KEY_ID!,
        keySecret: config.RAZORPAY_KEY_SECRET!,
        webhookSecret: config.RAZORPAY_WEBHOOK_SECRET!,
        apiBase: config.RAZORPAY_API_BASE,
      },
      logger,
    );
  }
  return new SandboxPaymentProvider(config.SANDBOX_PAYMENT_SECRET);
}

/** Composition root: wires repositories → services → middleware once per process. */
export function buildContainer(core: CoreDependencies) {
  const { config, logger, storage, emailQueue } = core;

  const userRepository = new UserRepository();
  const sessionRepository = new SessionRepository();
  const verificationTokenRepository = new VerificationTokenRepository();

  const audit = new AuditService(new AuditRepository(), logger);
  const notifications = new NotificationService(new NotificationRepository(), logger);
  const email = new EmailService(emailQueue, config);
  const tokens = new TokenService(config);
  const sessions = new SessionService(sessionRepository, config);
  const hasher = new PasswordHasher(config);

  const auth = new AuthService({
    config,
    logger,
    users: userRepository,
    verificationTokens: verificationTokenRepository,
    sessions,
    tokens,
    hasher,
    audit,
    notifications,
    email,
  });
  const users = new UsersService({
    users: userRepository,
    sessions,
    storage,
    audit,
    notifications,
    logger,
  });

  const cache = new CacheService(core.redis, config.SEARCH_CACHE_TTL_SECONDS, logger);
  const encryptor = new FieldEncryptor(config.DATA_ENCRYPTION_KEY);
  const media = new MediaService(storage, core.privateStorage, logger);
  const inventory = new InventoryService();
  const partnerAccess = new PartnerAccessService();
  const partners = new PartnersService({ media, audit, notifications, encryptor, cache });
  const hotels = new HotelsService({
    access: partnerAccess,
    media,
    inventory,
    audit,
    notifications,
    cache,
  });
  const rooms = new RoomsService({ access: partnerAccess, inventory, media, audit, cache });
  const quotes = new QuoteService(inventory, config);
  const search = new SearchService(quotes, media, cache, logger);

  // ---- Phase 3: reservations, payments, refunds, customer experience
  const lateQueue = core.domainEventQueue ? null : new LateBoundInlineQueue();
  const outbox = new OutboxService(core.domainEventQueue ?? lateQueue!, logger);
  const paymentProvider = core.paymentProvider ?? createPaymentProvider(config, logger);
  const finance = new FinanceService({ config, audit, logger });
  const coupons = new CouponsService({ audit });
  const bookings = new BookingsService({ config, quotes, inventory, outbox,
    coupons, media, audit, logger });
  const refunds = new RefundsService({ provider: paymentProvider, finance, outbox, audit, logger });
  const payments = new PaymentsService({
    config,
    provider: paymentProvider,
    bookings,
    inventory,
    refunds,
    finance,
    coupons,
    outbox,
    audit,
    logger,
  });
  const cancellations = new CancellationsService({
    bookings,
    inventory,
    refunds,
    outbox,
    audit,
    access: partnerAccess,
  });
  const bookingNotifications = new BookingNotificationsService(core.mailer, config, logger);
  const documents = new DocumentsService(core.privateStorage, config, logger);
  const wishlists = new WishlistsService({ config, search, quotes, encryptor });
  const reviews = new ReviewsService({
    config,
    media,
    access: partnerAccess,
    outbox,
    audit,
    cache,
  });
  const support = new SupportService(media, audit);
  const lifecycle = new LifecycleService({ bookings, outbox, reviews, wishlists, support, logger });
  const partnerReservations = new PartnerReservationsService({ access: partnerAccess, audit, cancellations });
  const operations = new OperationsService({
    refunds,
    notifications: bookingNotifications,
    reviews,
    outbox,
    audit,
  });
  lateQueue?.bind(
    createDomainEventHandlers({ notifications: bookingNotifications, refunds, documents }),
  );

  const authenticate = createAuthenticate({ tokens, users: userRepository, sessions });

  return {
    ...core,
    repositories: {
      users: userRepository,
      sessions: sessionRepository,
      verificationTokens: verificationTokenRepository,
    },
    services: {
      audit,
      notifications,
      email,
      tokens,
      sessions,
      hasher,
      auth,
      users,
      cache,
      encryptor,
      media,
      inventory,
      partnerAccess,
      partners,
      hotels,
      rooms,
      quotes,
      search,
      outbox,
      paymentProvider,
      bookings,
      refunds,
      payments,
      cancellations,
      bookingNotifications,
      documents,
      wishlists,
      reviews,
      support,
      lifecycle,
      operations,
      partnerReservations,
      finance,
      coupons,
    },
    authenticate,
  };
}

export type Container = ReturnType<typeof buildContainer>;
