import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BookingModel } from '@/modules/bookings/booking.models';
import { createTestContext } from '@/test/helpers';
import { bookingWorld, holdAndBook } from '@/test/booking-fixtures';

const TOKEN = 'metrics-token-for-tests-0123456789';

describe('metrics endpoint', () => {
  it('is disabled unless a token is configured', async () => {
    const { app } = createTestContext();
    await request(app).get('/metrics').expect(404);
  });

  it('requires the bearer token and exposes request and business metrics', async () => {
    const { app } = createTestContext({ env: { METRICS_TOKEN: TOKEN } });
    await request(app).get('/metrics').expect(401);
    await request(app).get('/metrics').set('Authorization', 'Bearer wrong').expect(401);
    await request(app).get('/health/live').expect(200);
    await request(app).get('/api/v1/hotels/featured').expect(200);
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toMatch(
      /stayscape_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/hotels\/featured",status="2xx"\} 1/,
    );
    expect(res.text).toMatch(/stayscape_mongo_up 1/);
    expect(res.text).toMatch(/stayscape_bookings_reconciliation_required 0/);
    expect(res.text).toMatch(/stayscape_inventory_invariant_violations 0/);
    // Raw URLs (ids, query strings) never become labels.
    expect(res.text).not.toMatch(/route="[^"]*\?/);
  });

  it('reports the reconciliation backlog from the database', async () => {
    const { app, customer, hotel } = await bookingWorld({});
    const held = await holdAndBook(app, customer, hotel, [10, 12]);
    await BookingModel.updateOne(
      { bookingReference: held.booking.reference },
      { $set: { bookingStatus: 'RECONCILIATION_REQUIRED' } },
    );
    const { app: scraped } = createTestContext({ env: { METRICS_TOKEN: TOKEN } });
    const res = await request(scraped).get('/metrics').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.text).toMatch(/stayscape_bookings_reconciliation_required 1/);
  });
});

describe('log redaction', () => {
  it('removes capability tokens from logged URLs', async () => {
    const { redactUrl } = await import('@/app');
    expect(redactUrl('/api/v1/trips/shared/abcDEF123?x=1')).toBe(
      '/api/v1/trips/shared/[redacted]?x=1',
    );
    expect(redactUrl('/api/v1/content/preview/tok_123')).toBe('/api/v1/content/preview/[redacted]');
    expect(redactUrl('/verify-email?token=secret&next=/')).toBe(
      '/verify-email?token=[redacted]&next=/',
    );
    expect(redactUrl('/api/v1/hotels?destination=goa')).toBe('/api/v1/hotels?destination=goa');
  });
});
