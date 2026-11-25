import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Response } from 'supertest';
import type { Express } from 'express';
import { AUTH_COOKIES, CSRF_HEADER, type Role } from '@stayscape/shared';
import { createApp, type AppOptions } from '@/app';
import { loadConfig } from '@/config/env';
import { buildContainer } from '@/container';
import { pingMongo } from '@/infrastructure/database';
import { MemoryMailProvider } from '@/infrastructure/mail/mail.provider';
import { InlineJobQueue } from '@/infrastructure/queue/job-queue';
import { LocalStorageProvider } from '@/infrastructure/storage/storage.provider';
import { createEmailHandlers, type EmailJobs } from '@/jobs/email.jobs';
import { createLogger } from '@/lib/logger';
import { UserModel } from '@/modules/users/user.model';

export const TEST_PASSWORD = 'Str0ng-Passw0rd';

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    MONGO_URI: 'mongodb://unused-in-tests',
    REDIS_URL: 'redis://unused-in-tests',
    JWT_ACCESS_SECRET: 'test-only-secret-value-that-is-long-enough-123',
    DATA_ENCRYPTION_KEY: 'test-only-data-encryption-key-0123456789abcdef',
    QUOTE_SIGNING_SECRET: 'test-only-quote-signing-secret-0123456789abcd',
    SEARCH_CACHE_TTL_SECONDS: '0',
    API_PUBLIC_URL: 'http://localhost:4000',
    WEB_APP_URL: 'http://localhost:5173',
    MAIL_PROVIDER: 'memory',
    COOKIE_SECURE: 'false',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    RATE_LIMIT_MAX: '10000',
    AUTH_RATE_LIMIT_MAX: '10000',
    LOGIN_RATE_LIMIT_MAX: '10000',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    RUN_WORKERS: 'false',
    API_DOCS_ENABLED: 'true',
    ...overrides,
  });
}

export interface TestContext {
  app: Express;
  mailer: MemoryMailProvider;
  container: ReturnType<typeof buildContainer>;
}

export function createTestContext(
  options: { env?: Record<string, string>; app?: AppOptions } = {},
): TestContext {
  const uploadDir = mkdtempSync(join(tmpdir(), 'stayscape-uploads-'));
  const config = testConfig({ UPLOAD_DIR: uploadDir, ...options.env });
  const logger = createLogger(config);
  const mailer = new MemoryMailProvider();
  const emailQueue = new InlineJobQueue<EmailJobs>(createEmailHandlers(mailer));
  const storage = new LocalStorageProvider(uploadDir, config.MEDIA_PUBLIC_BASE_URL);
  const privateStorage = new LocalStorageProvider(
    mkdtempSync(join(tmpdir(), 'stayscape-private-')),
    'private://',
  );
  const container = buildContainer({
    config,
    logger,
    redis: null,
    mailer,
    emailQueue,
    storage,
    privateStorage,
  });
  const app = createApp(container, {
    healthChecks: { mongodb: pingMongo, redis: async () => 1 },
    ...options.app,
  });
  return { app, mailer, container };
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

export function registerPayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Asha',
    lastName: 'Rao',
    email: uniqueEmail(),
    password: TEST_PASSWORD,
    acceptTerms: true,
    ...overrides,
  };
}

/** Parse Set-Cookie headers into name → value. */
export function cookiesFrom(res: Response): Record<string, string> {
  const header = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const cookie of list) {
    const [pair] = cookie.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) out[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
  }
  return out;
}

export function rawSetCookies(res: Response): string[] {
  const header = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  return Array.isArray(header) ? header : header ? [header] : [];
}

export interface SignedInUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  agent: ReturnType<typeof request.agent>;
}

function toSignedIn(res: Response, agent: ReturnType<typeof request.agent>): SignedInUser {
  const cookies = cookiesFrom(res);
  const body = res.body as { data: { accessToken: string; user: { id: string; email: string } } };
  return {
    id: body.data.user.id,
    email: body.data.user.email,
    accessToken: body.data.accessToken,
    refreshToken: cookies[AUTH_COOKIES.refreshToken] ?? '',
    csrfToken: cookies[AUTH_COOKIES.csrfToken] ?? '',
    agent,
  };
}

export async function registerUser(
  app: Express,
  overrides: Record<string, unknown> = {},
): Promise<SignedInUser> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/register')
    .send(registerPayload(overrides))
    .expect(201);
  return toSignedIn(res, agent);
}

export async function loginUser(
  app: Express,
  email: string,
  password = TEST_PASSWORD,
): Promise<SignedInUser> {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return toSignedIn(res, agent);
}

/** Create a user with specific roles (bypassing the public API, which can only create customers). */
export async function createUserWithRoles(app: Express, roles: Role[]): Promise<SignedInUser> {
  const user = await registerUser(app);
  await UserModel.updateOne({ _id: user.id }, { $set: { roles } });
  return user;
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function csrfHeaders(user: Pick<SignedInUser, 'csrfToken'>) {
  return { [CSRF_HEADER]: user.csrfToken, Origin: 'http://localhost:5173' };
}

export function extractToken(text: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error('No token found in email');
  return match[1];
}
