import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? fallback : value === 'true' || value === '1'));

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const DEV_SECRET_MARKER = 'dev-only';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('STAYSCAPE'),
    APP_VERSION: z.string().default('0.1.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    API_PUBLIC_URL: z.url().default('http://localhost:4000'),
    WEB_APP_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    REQUEST_BODY_LIMIT: z.string().default('100kb'),

    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ISSUER: z.string().default('stayscape-api'),
    JWT_AUDIENCE: z.string().default('stayscape-web'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: bool(true),
    COOKIE_SAMESITE: z.enum(['strict', 'lax']).default('strict'),
    COOKIE_DOMAIN: optionalString,

    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),

    MAIL_PROVIDER: z.enum(['smtp', 'log', 'memory']).default('smtp'),
    MAIL_FROM: z.string().default('STAYSCAPE <no-reply@stayscape.local>'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: bool(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,

    DATA_ENCRYPTION_KEY: z.string().min(32, 'DATA_ENCRYPTION_KEY must be at least 32 characters'),
    QUOTE_SIGNING_SECRET: z.string().min(32, 'QUOTE_SIGNING_SECRET must be at least 32 characters'),
    QUOTE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
    MEDIA_ORPHAN_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    PRIVATE_UPLOAD_DIR: z.string().default('./var/private'),
    S3_PRIVATE_BUCKET: optionalString,
    UPLOAD_DIR: z.string().default('./var/uploads'),
    MEDIA_PUBLIC_BASE_URL: z.string().default('/api/v1/media'),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_PUBLIC_BASE_URL: optionalString,
    S3_FORCE_PATH_STYLE: bool(false),

    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    RUN_WORKERS: bool(true),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: bool(false),
    API_DOCS_ENABLED: bool(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.JWT_ACCESS_SECRET.includes(DEV_SECRET_MARKER)) {
      fail('JWT_ACCESS_SECRET', 'Development secrets must not be used in production');
    }
    for (const key of ['DATA_ENCRYPTION_KEY', 'QUOTE_SIGNING_SECRET'] as const) {
      if (env[key].includes(DEV_SECRET_MARKER))
        fail(key, 'Development secrets must not be used in production');
    }
    if (env.STORAGE_DRIVER === 's3' && !env.S3_PRIVATE_BUCKET)
      fail('S3_PRIVATE_BUCKET', 'A private bucket is required for verification documents');
    if (!env.COOKIE_SECURE) fail('COOKIE_SECURE', 'Cookies must be Secure in production');
    if (env.MAIL_PROVIDER !== 'smtp')
      fail('MAIL_PROVIDER', 'Only the smtp mail provider is allowed in production');
    if (env.CORS_ORIGINS.length === 0)
      fail('CORS_ORIGINS', 'An explicit CORS allowlist is required in production');
    if (env.STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
      fail('S3_BUCKET', 'S3_BUCKET and S3_REGION are required when STORAGE_DRIVER=s3');
    }
  });

export type Config = z.output<typeof envSchema> & {
  isProduction: boolean;
  isTest: boolean;
  /** Allowlisted origins; always includes WEB_APP_URL's origin. */
  corsOrigins: string[];
};

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and rule messages only — never echo values, which may be secrets.
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const data = parsed.data;
  const corsOrigins = [...new Set([new URL(data.WEB_APP_URL).origin, ...data.CORS_ORIGINS])];
  return {
    ...data,
    isProduction: data.NODE_ENV === 'production',
    isTest: data.NODE_ENV === 'test',
    corsOrigins,
  };
}
