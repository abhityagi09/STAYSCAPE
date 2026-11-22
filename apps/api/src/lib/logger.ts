import pino, { type Logger } from 'pino';
import type { Config } from '@/config/env';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL' | 'LOG_PRETTY' | 'APP_NAME' | 'NODE_ENV'>,
): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: `${config.APP_NAME.toLowerCase()}-api`, env: config.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(config.LOG_PRETTY
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  });
}

export type { Logger };
