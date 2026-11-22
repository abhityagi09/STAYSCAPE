import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '@/config/env';
import { assertBootstrapAllowed } from '@/scripts/bootstrap-admin';
import { createTestContext, testConfig } from '@/test/helpers';
import { sanitizeMetadata } from '@/modules/audit/audit.service';

describe('health endpoints', () => {
  it('liveness responds without checking dependencies', async () => {
    const { app } = createTestContext({
      app: {
        healthChecks: {
          mongodb: async () => {
            throw new Error('down');
          },
        },
      },
    });
    const res = await request(app).get('/health/live').expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('readiness reports up when dependencies respond', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.data.checks).toMatchObject({
      mongodb: { status: 'up' },
      redis: { status: 'up' },
    });
    await request(app).get('/api/v1/health/ready').expect(200);
  });

  it('readiness fails with 503 and no internal detail when a dependency is down', async () => {
    const { app } = createTestContext({
      app: {
        healthChecks: {
          redis: async () => {
            throw new Error('ECONNREFUSED redis://secret@10.0.0.1');
          },
        },
      },
    });
    const res = await request(app).get('/health/ready').expect(503);
    expect(res.body.data.checks.redis).toEqual({ status: 'down' });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|secret/);
    const summary = await request(app).get('/health').expect(200);
    expect(summary.body.data.status).toBe('degraded');
  });
});

describe('HTTP foundation', () => {
  it('returns a JSON 404 envelope with a request id', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('propagates a well-formed incoming request id and replaces malformed ones', async () => {
    const { app } = createTestContext();
    const ok = await request(app).get('/health/live').set('x-request-id', 'trace-12345678');
    expect(ok.headers['x-request-id']).toBe('trace-12345678');
    const bad = await request(app).get('/health/live').set('x-request-id', 'bad id with spaces');
    expect(bad.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('sets security headers and hides the framework', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('enforces the CORS allowlist', async () => {
    const { app } = createTestContext();
    const allowed = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized and malformed JSON bodies', async () => {
    const { app } = createTestContext();
    const huge = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }))
      .expect(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const malformed = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  it('applies the global API rate limit', async () => {
    const { app } = createTestContext({ env: { RATE_LIMIT_MAX: '2' } });
    await request(app).get('/api/v1/health/live').expect(200);
    await request(app).get('/api/v1/health/live').expect(200);
    const limited = await request(app).get('/api/v1/health/live').expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('serves the OpenAPI document', async () => {
    const { app } = createTestContext();
    const res = await request(app).get('/api/v1/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/auth/register', '/users/profile', '/health/ready']),
    );
  });

  it('records newsletter subscriptions idempotently', async () => {
    const { app } = createTestContext();
    await request(app)
      .post('/api/v1/newsletter/subscriptions')
      .send({ email: 'Reader@Example.com' })
      .expect(201);
    await request(app)
      .post('/api/v1/newsletter/subscriptions')
      .send({ email: 'reader@example.com' })
      .expect(201);
    await request(app).post('/api/v1/newsletter/subscriptions').send({ email: 'nope' }).expect(422);
    const { NewsletterSubscriptionModel } =
      await import('@/modules/newsletter/newsletter-subscription.model');
    expect(await NewsletterSubscriptionModel.countDocuments()).toBe(1);
  });
});

describe('configuration safety', () => {
  it('reports missing variables by name without echoing values', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'tooshort' })).toThrowError(
      ConfigError,
    );
    try {
      loadConfig({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'tooshort' });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/MONGO_URI/);
      expect(message).toMatch(/JWT_ACCESS_SECRET/);
      expect(message).not.toMatch(/tooshort/);
    }
  });

  it('refuses unsafe production settings', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        MONGO_URI: 'mongodb://db',
        REDIS_URL: 'redis://cache',
        JWT_ACCESS_SECRET: 'dev-only-change-me-dev-only-change-me-xx',
        COOKIE_SECURE: 'false',
        MAIL_PROVIDER: 'log',
      }),
    ).toThrowError(/JWT_ACCESS_SECRET|COOKIE_SECURE|MAIL_PROVIDER|CORS_ORIGINS/);
    expect(testConfig().isTest).toBe(true);
  });

  it('admin bootstrap refuses production and remote databases', () => {
    expect(() =>
      assertBootstrapAllowed({ NODE_ENV: 'production', MONGO_URI: 'mongodb://localhost:27017' }),
    ).toThrow(/production/);
    expect(() =>
      assertBootstrapAllowed({
        NODE_ENV: 'development',
        MONGO_URI: 'mongodb+srv://u:p@cluster0.mongodb.net/db',
      }),
    ).toThrow(/non-local/);
    expect(() =>
      assertBootstrapAllowed({
        NODE_ENV: 'development',
        MONGO_URI: 'mongodb://localhost:27017/stayscape',
      }),
    ).not.toThrow();
  });

  it('audit metadata sanitiser redacts secrets', () => {
    expect(
      sanitizeMetadata({ password: 'x', nested: { refreshToken: 'y', ok: 1 }, cardNumber: '4111' }),
    ).toEqual({
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', ok: 1 },
      cardNumber: '[REDACTED]',
    });
  });
});
