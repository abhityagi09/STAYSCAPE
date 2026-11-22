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

export interface CoreDependencies {
  config: Config;
  logger: Logger;
  redis: Redis | null;
  mailer: MailProvider;
  emailQueue: EmailQueue;
  storage: StorageProvider;
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

  const authenticate = createAuthenticate({ tokens, users: userRepository, sessions });

  return {
    ...core,
    repositories: {
      users: userRepository,
      sessions: sessionRepository,
      verificationTokens: verificationTokenRepository,
    },
    services: { audit, notifications, email, tokens, sessions, hasher, auth, users },
    authenticate,
  };
}

export type Container = ReturnType<typeof buildContainer>;
