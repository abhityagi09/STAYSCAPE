import { Schema, model } from 'mongoose';
import { CURRENCIES, type CurrencyCode } from '@stayscape/shared';
import type { Logger } from '@/lib/logger';

/**
 * Display-only currency conversion from an authoritative published source: the European Central
 * Bank's daily euro foreign-exchange reference rates. No rate is ever invented or interpolated:
 * a currency the source does not publish (e.g. AED) cannot be converted, and snapshots older than
 * MAX_AGE_DAYS are not used. Bookings are always priced and charged in the property's currency.
 */
interface RateSnapshotAttrs {
  source: 'ECB';
  base: 'EUR';
  publishedOn: string;
  rates: Record<string, number>;
  fetchedAt: Date;
}
const snapshotSchema = new Schema<RateSnapshotAttrs>(
  {
    source: { type: String, required: true },
    base: { type: String, required: true },
    publishedOn: { type: String, required: true },
    rates: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
snapshotSchema.index({ source: 1, publishedOn: -1 }, { unique: true, name: 'uniq_source_day' });
export const ExchangeRateSnapshotModel = model<RateSnapshotAttrs>(
  'ExchangeRateSnapshot',
  snapshotSchema,
);

export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MAX_AGE_DAYS = 7;

export interface RatesProvider {
  fetchLatest(): Promise<{ publishedOn: string; rates: Record<string, number> }>;
}

/** Parse the ECB eurofxref XML (also used by tests with a recorded fixture). */
export function parseEcbXml(xml: string): { publishedOn: string; rates: Record<string, number> } {
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!day) throw new Error('ECB response has no reference date');
  const rates: Record<string, number> = { EUR: 1 };
  for (const m of xml.matchAll(
    /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g,
  )) {
    const rate = Number(m[2]);
    if (Number.isFinite(rate) && rate > 0) rates[m[1]!] = rate;
  }
  if (Object.keys(rates).length < 5) throw new Error('ECB response contained too few rates');
  return { publishedOn: day, rates };
}

export class EcbRatesProvider implements RatesProvider {
  constructor(
    private readonly url = ECB_DAILY_URL,
    private readonly timeoutMs = 10_000,
  ) {}
  async fetchLatest() {
    const res = await fetch(this.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Accept: 'application/xml' },
    });
    if (!res.ok) throw new Error(`ECB responded ${res.status}`);
    return parseEcbXml(await res.text());
  }
}

export interface ConvertedAmount {
  amountMinor: number;
  currency: CurrencyCode;
  rate: number;
  publishedOn: string;
  source: 'ECB';
}

/** Cross-rate via EUR; all supported currencies use 2 minor digits. Rounds half away from zero. */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number | null {
  const f = rates[from];
  const t = rates[to];
  if (!f || !t) return null;
  const v = (amountMinor / f) * t;
  return Math.sign(v) * Math.round(Math.abs(v));
}

export class CurrencyService {
  constructor(private readonly deps: { provider: RatesProvider | null; logger: Logger }) {}

  /** Scheduled: store today's published rates (idempotent per published day). */
  async refresh(): Promise<{ stored: boolean; publishedOn: string | null }> {
    if (!this.deps.provider) return { stored: false, publishedOn: null };
    const { publishedOn, rates } = await this.deps.provider.fetchLatest();
    const res = await ExchangeRateSnapshotModel.updateOne(
      { source: 'ECB', publishedOn },
      { $setOnInsert: { base: 'EUR', rates, fetchedAt: new Date() } },
      { upsert: true },
    );
    return { stored: res.upsertedCount === 1, publishedOn };
  }

  private async latest(now = new Date()) {
    const s = await ExchangeRateSnapshotModel.findOne({ source: 'ECB' })
      .sort({ publishedOn: -1 })
      .lean<RateSnapshotAttrs>();
    if (!s) return null;
    const age = (now.getTime() - Date.parse(`${s.publishedOn}T00:00:00Z`)) / 86_400_000;
    return age <= MAX_AGE_DAYS ? s : null;
  }

  async publicRates() {
    const s = await this.latest();
    if (!s)
      return {
        available: false as const,
        reason:
          'No current reference rates are available. Prices are shown in the property currency only.',
      };
    const supported = Object.fromEntries(
      CURRENCIES.filter((c) => s.rates[c]).map((c) => [c, s.rates[c]!]),
    );
    return {
      available: true as const,
      source: 'European Central Bank euro foreign exchange reference rates',
      sourceUrl:
        'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
      base: 'EUR' as const,
      publishedOn: s.publishedOn,
      rates: supported,
      unsupported: CURRENCIES.filter((c) => !s.rates[c]),
      disclaimer:
        'Converted amounts are approximate, for information only. You are charged in the property currency; your bank or card issuer applies its own rate.',
    };
  }

  async convert(
    amountMinor: number,
    from: CurrencyCode,
    to: CurrencyCode,
  ): Promise<ConvertedAmount | null> {
    if (from === to) return null;
    const s = await this.latest();
    if (!s) return null;
    const v = convertMinor(amountMinor, from, to, s.rates);
    if (v === null) return null;
    return {
      amountMinor: v,
      currency: to,
      rate: Number(((s.rates[to] ?? 0) / (s.rates[from] ?? 1)).toFixed(6)),
      publishedOn: s.publishedOn,
      source: 'ECB',
    };
  }
}
