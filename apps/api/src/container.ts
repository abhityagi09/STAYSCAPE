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

export interface CoreDependencies {
  config: Config;
  logger: Logger;
  redis: Redis | null;
  mailer: MailProvider;
  emailQueue: EmailQueue;
  storage: StorageProvider;
  /** Never publicly served; used for verification documents. */
  privateStorage: StorageProvider;
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
    },
    authenticate,
  };
}

export type Container = ReturnType<typeof buildContainer>;
