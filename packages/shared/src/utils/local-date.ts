/**
 * Property-local calendar dates ("YYYY-MM-DD").
 *
 * Inventory and stay dates are calendar days at the property, not instants. All arithmetic here
 * is done on UTC midnight purely as a counting device, so results never depend on the server's or
 * browser's time zone.
 */
export type LocalDate = string;

export const LOCAL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parts(date: LocalDate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? NaN, m ?? NaN, d ?? NaN];
}

export function isValidLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !LOCAL_DATE_REGEX.test(value)) return false;
  const [y, m, d] = parts(value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUtcMs(date: LocalDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * 86_400_000);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

/** Nights of a stay: every date from check-in up to (not including) check-out. */
export function stayNights(checkIn: LocalDate, checkOut: LocalDate): LocalDate[] {
  const count = diffDays(checkIn, checkOut);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(checkIn, i));
}

/** Inclusive date range. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  return stayNights(from, addDays(to, 1));
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/** Today's calendar date in an IANA time zone (e.g. the property's). */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
