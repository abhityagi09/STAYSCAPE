/**
 * DEVELOPMENT-ONLY super administrator bootstrap.
 *
 *   ADMIN_BOOTSTRAP_EMAIL=admin@stayscape.local ADMIN_BOOTSTRAP_PASSWORD='...' npm run bootstrap:admin
 *
 * Creates the account (or promotes an existing one) with the SUPER_ADMIN role.
 * Refuses to run when NODE_ENV=production or when the database host is not local,
 * and never prints the password.
 */
import mongoose from 'mongoose';
import { emailSchema, passwordSchema, personNameSchema } from '@stayscape/shared';
import { loadConfig } from '@/config/env';
import { loadDotenv } from '@/config/load-dotenv';
import { connectMongo } from '@/infrastructure/database';
import { createLogger } from '@/lib/logger';
import { PasswordHasher } from '@/lib/password';
import { UserModel } from '@/modules/users/user.model';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'mongo', '::1'];

export function assertBootstrapAllowed(env: {
  NODE_ENV?: string | undefined;
  MONGO_URI?: string | undefined;
}): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to bootstrap an administrator: NODE_ENV is production.');
  }
  const host = /^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/:,?]+)/.exec(env.MONGO_URI ?? '')?.[1];
  if (!host || !LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to bootstrap an administrator against non-local database host "${host ?? 'unknown'}".`,
    );
  }
}

async function main() {
  loadDotenv();
  assertBootstrapAllowed(process.env);
  const config = loadConfig();
  const logger = createLogger({ ...config, LOG_LEVEL: 'warn' });

  const email = emailSchema.parse(process.env.ADMIN_BOOTSTRAP_EMAIL);
  const password = passwordSchema.parse(process.env.ADMIN_BOOTSTRAP_PASSWORD);
  const firstName = personNameSchema('First name').parse(
    process.env.ADMIN_BOOTSTRAP_FIRST_NAME ?? 'Platform',
  );
  const lastName = personNameSchema('Last name').parse(
    process.env.ADMIN_BOOTSTRAP_LAST_NAME ?? 'Admin',
  );

  await connectMongo(config, logger);
  const passwordHash = await new PasswordHasher(config).hash(password);
  const existing = await UserModel.findOne({ email });
  if (existing) {
    existing.roles = [...new Set([...existing.roles, 'SUPER_ADMIN' as const])];
    existing.accountStatus = 'ACTIVE';
    existing.emailVerifiedAt ??= new Date();
    existing.passwordHash = passwordHash;
    await existing.save();
    console.log(
      `Promoted existing account ${email} to SUPER_ADMIN (password reset to the supplied value).`,
    );
  } else {
    await UserModel.create({
      firstName,
      lastName,
      email,
      passwordHash,
      roles: ['CUSTOMER', 'SUPER_ADMIN'],
      emailVerifiedAt: new Date(),
    });
    console.log(`Created SUPER_ADMIN account ${email}.`);
  }
  await mongoose.disconnect();
}

const invokedDirectly = process.argv[1] && /bootstrap-admin\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
