import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '@/test/helpers';
import { CurrencyService, ExchangeRateSnapshotModel, convertMinor, parseEcbXml } from './currency.service';

// Recorded ECB eurofxref-daily.xml response (fetched 2026-11-26, reference date 2026-11-25).
const fixture = readFileSync(new URL('./ecb-fixture.xml', import.meta.url), 'utf8');

describe('currency display', () => {
  it('parses the published ECB reference rates', () => {
    const { publishedOn, rates } = parseEcbXml(fixture);
    expect(publishedOn).toBe('2026-11-25');
    expect(rates).toMatchObject({ EUR: 1, USD: 1.0935, GBP: 0.8373, INR: 100.859 });
    expect(rates).not.toHaveProperty('AED'); // not published by the ECB
    expect(() => parseEcbXml('<x/>')).toThrow();
  });

  it('converts via EUR cross rates and never invents a missing rate', () => {
    const { rates } = parseEcbXml(fixture);
    // ₹10,500.00 → USD: 1,050,000 / 100.859 × 1.0935 = 11,383.87… → 11,384 cents
    expect(convertMinor(1_050_000, 'INR', 'USD', rates)).toBe(11_384);
    expect(convertMinor(1_050_000, 'INR', 'AED', rates)).toBeNull();
  });

  it('serves stored rates, refuses stale ones, and is idempotent per published day', async () => {
    const { app, container } = createTestContext();
    expect((await request(app).get('/api/v1/currency/rates').expect(200)).body.data.available).toBe(false);
    const svc = new CurrencyService({ provider: { fetchLatest: async () => ({ ...parseEcbXml(fixture), publishedOn: new Date().toISOString().slice(0, 10) }) }, logger: container.logger });
    expect((await svc.refresh()).stored).toBe(true);
    expect((await svc.refresh()).stored).toBe(false);
    const rates = (await request(app).get('/api/v1/currency/rates').expect(200)).body.data;
    expect(rates).toMatchObject({ available: true, base: 'EUR', unsupported: ['AED'] });
    expect((await request(app).get('/api/v1/currency/convert?amountMinor=1050000&from=INR&to=USD').expect(200)).body.data.converted).toMatchObject({ amountMinor: 11_384, currency: 'USD', source: 'ECB' });
    expect((await request(app).get('/api/v1/currency/convert?amountMinor=1050000&from=INR&to=AED').expect(200)).body.data.converted).toBeNull();
    await ExchangeRateSnapshotModel.updateMany({}, { $set: { publishedOn: '2020-01-01' } });
    expect((await request(app).get('/api/v1/currency/rates').expect(200)).body.data.available).toBe(false);
  });
});
