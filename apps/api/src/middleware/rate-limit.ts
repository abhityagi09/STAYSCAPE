import type { Request, RequestHandler } from 'express';
import { rateLimit, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { Config } from '@/config/env';
import { AppError } from '@/lib/errors';

export interface RateLimiters {
  global: RequestHandler;
  auth: RequestHandler;
  login: RequestHandler;
}

function storeFor(redis: Redis | null, prefix: string): Store | undefined {
  if (!redis) return undefined; // falls back to the in-memory store (tests / single instance)
  return new RedisStore({
    prefix: `stayscape:rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });
}

function limiter(options: {
  windowMs: number;
  limit: number;
  store: Store | undefined;
  message: string;
  keyGenerator?: (req: Request) => string;
}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(options.store ? { store: options.store } : {}),
    ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
    handler: (_req, _res, next, opts) => {
      next(
        new AppError(429, 'RATE_LIMITED', options.message, undefined, {
          'Retry-After': String(Math.ceil(opts.windowMs / 1000)),
        }),
      );
    },
  });
}

export function createRateLimiters(config: Config, redis: Redis | null): RateLimiters {
  const windowMs = config.RATE_LIMIT_WINDOW_MS;
  return {
    global: limiter({
      windowMs,
      limit: config.RATE_LIMIT_MAX,
      store: storeFor(redis, 'global'),
      message: 'Too many requests. Please slow down and try again shortly.',
    }),
    auth: limiter({
      windowMs,
      limit: config.AUTH_RATE_LIMIT_MAX,
      store: storeFor(redis, 'auth'),
      message: 'Too many attempts. Please wait a few minutes and try again.',
    }),
    // Keyed by IP + target email so one attacker cannot lock out every account from one IP,
    // and one account cannot be brute-forced beyond the limit.
    login: limiter({
      windowMs,
      limit: config.LOGIN_RATE_LIMIT_MAX,
      store: storeFor(redis, 'login'),
      message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
      keyGenerator: (req) => {
        const body = req.body as { email?: unknown } | undefined;
        const email =
          typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
        return `${req.ip ?? 'unknown'}|${email}`;
      },
    }),
  };
}
