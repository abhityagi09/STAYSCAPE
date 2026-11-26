/**
 * One-time creation of the FIRST super administrator in any environment, including production.
 *
 *   ADMIN_BOOTSTRAP_CONFIRM=create-first-super-admin \
 *   ADMIN_BOOTSTRAP_EMAIL=ops@example.com ADMIN_BOOTSTRAP_PASSWORD='<from your secret manager>' \
 *   node dist/scripts/bootstrap-first-admin.js
 *
 * Safety rules (docs/deployment.md "First administrator"):
 *  - requires the explicit confirmation phrase — it never runs as part of a deploy;
 *  - refuses when any SUPER_ADMIN already exists, so it cannot be used to take over a live system;
 *  - creates a NEW account only (never promotes or resets an existing one);
 *  - reads the password from the environment, validates its strength and never prints it;
 *  - writes an audit log entry.
 * Further administrators are invited through the product by a super administrator.
 */
import mongoose from 'mongoose';
import { emailSchema, passwordSchema, personNameSchema } from '@stayscape/shared';
import { loadConfig, type Config } from '@/config/env';
import { loadDotenv } from '@/config/load-dotenv';
import { connectMongo } from '@/infrastructure/database';
import { createLogger } from '@/lib/logger';
import { PasswordHasher } from '@/lib/password';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { UserModel } from '@/modules/users/user.model';

export const CONFIRM_PHRASE = 'create-first-super-admin';

export async function bootstrapFirstAdmin(
  env: Record<string, string | undefined>,
  config: Pick<Config, 'ARGON2_MEMORY_KIB' | 'ARGON2_TIME_COST'>,
): Promise<string> {
  if (env.ADMIN_BOOTSTRAP_CONFIRM !== CONFIRM_PHRASE)
    throw new Error(
      `Set ADMIN_BOOTSTRAP_CONFIRM=${CONFIRM_PHRASE} to create the first administrator.`,
    );
  const email = emailSchema.parse(env.ADMIN_BOOTSTRAP_EMAIL);
  const password = passwordSchema.parse(env.ADMIN_BOOTSTRAP_PASSWORD);
  const firstName = personNameSchema('First name').parse(
    env.ADMIN_BOOTSTRAP_FIRST_NAME ?? 'Platform',
  );
  const lastName = personNameSchema('Last name').parse(
    env.ADMIN_BOOTSTRAP_LAST_NAME ?? 'Administrator',
  );

  if (await UserModel.exists({ roles: 'SUPER_ADMIN' }))
    throw new Error(
      'A super administrator already exists; invite further administrators in the product.',
    );
  if (await UserModel.exists({ email }))
    throw new Error('An account with this email already exists; use a dedicated address.');

  const passwordHash = await new PasswordHasher(config).hash(password);
  const user = await UserModel.create({
    firstName,
    lastName,
    email,
    passwordHash,
    roles: ['SUPER_ADMIN'],
    emailVerifiedAt: new Date(),
  });
  await AuditLogModel.create({
    actorId: null,
    action: 'admin.first_super_admin_bootstrapped',
    entityType: 'user',
    entityId: user._id.toString(),
    metadata: { email },
  });
  return user._id.toString();
}

async function main() {
  loadDotenv();
  const config = loadConfig();
  const logger = createLogger({ ...config, LOG_LEVEL: 'warn' });
  await connectMongo(config, logger);
  const id = await bootstrapFirstAdmin(process.env, config);
  console.log(
    `Created the first SUPER_ADMIN (${id}). Sign in and enable your recovery procedures.`,
  );
  await mongoose.disconnect();
}

const invokedDirectly = process.argv[1] && /bootstrap-first-admin\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
}
