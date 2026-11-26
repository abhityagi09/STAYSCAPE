import { CURRENCY_EXPONENT, type CurrencyCode } from '../constants/account';

/**
 * Money is always carried as an integer number of minor units (e.g. paise, cents).
 * Floating-point major units must never be used for calculations.
 */
export function assertMinorUnits(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Money amounts must be safe integers in minor units; received ${amount}`);
  }
}

export function formatMinorUnits(
  amountMinor: number,
  currency: CurrencyCode,
  locale = 'en-IN',
  options: { maximumFractionDigits?: number } = {},
): string {
  assertMinorUnits(amountMinor);
  const exponent = CURRENCY_EXPONENT[currency];
  const major = amountMinor / 10 ** exponent;
  const digits = options.maximumFractionDigits ?? exponent;
  const key = `${locale}|${currency}|${digits}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(major);
}
const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Convert a user-entered decimal string ("1499.50") to minor units without float drift. */
export function parseMajorToMinor(input: string, currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENT[currency];
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) throw new RangeError(`Invalid amount: ${input}`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > exponent) throw new RangeError(`Too many decimal places for ${currency}`);
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0') || '0');
  assertMinorUnits(minor);
  return sign ? -minor : minor;
}
