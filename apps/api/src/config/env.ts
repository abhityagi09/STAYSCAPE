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

    // ---- Reservations & payments (Phase 3)
    BOOKING_HOLD_TTL_MINUTES: z.coerce.number().int().min(2).max(60).default(10),
    /** 'sandbox' is a labelled local/test gateway; production requires 'razorpay'. */
    PAYMENT_PROVIDER: z.enum(['razorpay', 'sandbox']).default('sandbox'),
    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,
    RAZORPAY_API_BASE: z.url().default('https://api.razorpay.com/v1'),
    SANDBOX_PAYMENT_SECRET: z
      .string()
      .min(32)
      .default('dev-only-sandbox-gateway-secret-0123456789abcdef'),
    PAYMENT_MERCHANT_NAME: z.string().default('STAYSCAPE'),
    /** Who issues guest invoices: the platform (merchant of record) or the property. */
    INVOICE_ISSUER_MODE: z.enum(['PLATFORM', 'PROPERTY']).default('PLATFORM'),
    INVOICE_ISSUER_NAME: z.string().default('STAYSCAPE Travel (development)'),
    INVOICE_ISSUER_ADDRESS: z.string().default('Not configured — set INVOICE_ISSUER_ADDRESS'),
    INVOICE_ISSUER_TAX_ID: optionalString,
    INVOICE_ISSUER_EMAIL: z.string().default('billing@stayscape.local'),
    INVOICE_NUMBER_PREFIX: z
      .string()
      .regex(/^[A-Z0-9-]{1,12}$/)
      .default('SSI'),
    REVIEW_EDIT_WINDOW_DAYS: z.coerce.number().int().min(0).max(365).default(30),
    REVIEW_MAX_EDITS: z.coerce.number().int().min(0).max(20).default(3),
    OPS_ALERT_EMAIL: optionalString,
    // ---- Finance (Phase 4)
    /** Commission when no rule applies, in basis points (1500 = 15%). */
    COMMISSION_DEFAULT_BASIS_POINTS: z.coerce.number().int().min(0).max(10_000).default(1500),
    /** Days after check-out before a stay's payable becomes eligible for settlement. */
    SETTLEMENT_HOLD_DAYS: z.coerce.number().int().min(0).max(90).default(1),
    /** Automated partner payouts: disabled until a payout provider is onboarded. */
    PAYOUT_PROVIDER: z.enum(['disabled']).default('disabled'),
    // ---- AI travel assistant (Phase 4). Backend only: the key is never sent to the browser.
    /** anthropic: Claude via the official SDK. rules: deterministic, no-AI dev/test assistant. */
    /** Display-only currency conversion source: ecb (published reference rates) or disabled. */
    FX_PROVIDER: z.enum(['ecb', 'disabled']).default('ecb'),
    AI_PROVIDER: z.enum(['anthropic', 'rules']).default('rules'),
    ANTHROPIC_API_KEY: optionalString,
    AI_MODEL: z.string().default('claude-opus-5-5'),
    AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    AI_TURN_DEADLINE_MS: z.coerce.number().int().min(1000).max(180_000).default(60_000),
    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(8).default(4),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16_000).default(4_000),
    AI_DAILY_REQUESTS_PER_USER: z.coerce.number().int().min(1).max(1000).default(50),
    AI_REQUESTS_PER_MINUTE_PER_USER: z.coerce.number().int().min(1).max(60).default(6),
    /** Monthly platform spend cap in micro-USD (0 = no cap). Requests beyond it use the fallback. */
    AI_MONTHLY_BUDGET_MICRO_USD: z.coerce.number().int().min(0).default(0),
    /** Published per-million-token prices (USD) used for cost tracking; defaults are claude-opus-5-5. */
    AI_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(4),
    AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(20),
    AI_PRICE_CACHE_READ_PER_MTOK: z.coerce.number().min(0).default(0.2),

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
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const key of [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when PAYMENT_PROVIDER=razorpay`,
          });
      }
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY)
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic' });
    if (env.NODE_ENV !== 'production') return;
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.JWT_ACCESS_SECRET.includes(DEV_SECRET_MARKER)) {
      fail('JWT_ACCESS_SECRET', 'Development secrets must not be used in production');
    }
    if (env.PAYMENT_PROVIDER !== 'razorpay')
      fail('PAYMENT_PROVIDER', 'The sandbox payment provider is not allowed in production');
    for (const key of [
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ] as const) {
      if (!env[key]) fail(key, `${key} is required in production`);
    }
    if (
      env.INVOICE_ISSUER_MODE === 'PLATFORM' &&
      env.INVOICE_ISSUER_ADDRESS.startsWith('Not configured')
    )
      fail('INVOICE_ISSUER_ADDRESS', 'Configure the invoice issuer address');
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
