import { describe, expect, it } from 'vitest';
import { assertBootstrapAllowed } from '@/scripts/bootstrap-admin';
import { loadConfig } from './env';

const secrets = {
  MONGO_URI: 'mongodb://mongo:27017/stayscape',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'staging-jwt-secret-0123456789abcdefghijklmnop',
  DATA_ENCRYPTION_KEY: 'staging-data-key-0123456789abcdefghijklmnopq',
  QUOTE_SIGNING_SECRET: 'staging-quote-secret-0123456789abcdefghijkl',
  SANDBOX_PAYMENT_SECRET: 'staging-sandbox-secret-0123456789abcdefghijk',
  COOKIE_SECURE: 'true',
  MAIL_PROVIDER: 'smtp',
  CORS_ORIGINS: 'https://staging.example.com',
  INVOICE_ISSUER_MODE: 'PROPERTY',
};

describe('deployment environments', () => {
  it('staging runs production rules with the labelled sandbox gateway', () => {
    const config = loadConfig({
      ...secrets,
      NODE_ENV: 'production',
      DEPLOYMENT_ENV: 'staging',
      PAYMENT_PROVIDER: 'sandbox',
    });
    expect(config.isProduction).toBe(true);
    expect(config.PAYMENT_PROVIDER).toBe('sandbox');
  });

  it('production never accepts the sandbox gateway or a development sandbox secret', () => {
    expect(() =>
      loadConfig({
        ...secrets,
        NODE_ENV: 'production',
        DEPLOYMENT_ENV: 'production',
        PAYMENT_PROVIDER: 'sandbox',
      }),
    ).toThrow(/PAYMENT_PROVIDER/);
    expect(() =>
      loadConfig({
        ...secrets,
        NODE_ENV: 'production',
        DEPLOYMENT_ENV: 'staging',
        PAYMENT_PROVIDER: 'sandbox',
        SANDBOX_PAYMENT_SECRET: 'dev-only-sandbox-gateway-secret-0123456789abcdef',
      }),
    ).toThrow(/SANDBOX_PAYMENT_SECRET/);
    expect(() =>
      loadConfig({ ...secrets, NODE_ENV: 'development', DEPLOYMENT_ENV: 'production' }),
    ).toThrow(/DEPLOYMENT_ENV=production requires NODE_ENV=production/);
  });

  it('only a self-contained staging stack may seed or bootstrap the development admin', () => {
    expect(() =>
      assertBootstrapAllowed({
        NODE_ENV: 'production',
        DEPLOYMENT_ENV: 'staging',
        MONGO_URI: 'mongodb://mongo:27017/x',
      }),
    ).not.toThrow();
    expect(() =>
      assertBootstrapAllowed({
        NODE_ENV: 'production',
        DEPLOYMENT_ENV: 'production',
        MONGO_URI: 'mongodb://mongo:27017/x',
      }),
    ).toThrow(/production/);
    expect(() =>
      assertBootstrapAllowed({
        NODE_ENV: 'production',
        DEPLOYMENT_ENV: 'staging',
        MONGO_URI: 'mongodb+srv://u:p@cluster0.example.net/x',
      }),
    ).toThrow(/non-local/);
  });
});
