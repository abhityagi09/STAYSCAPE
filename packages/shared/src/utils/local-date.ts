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
// Building an Intl.DateTimeFormat is far more expensive than using one (it was the hottest
// path in search pricing), so formatters are created once per time zone and reused.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatters.set(timeZone, f);
  }
  return f;
}
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): LocalDate {
  return dateFormatter(timeZone).format(now);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant (positive east of Greenwich). */
function zoneOffsetMs(timeZone: string, instant: number): number {
  const fields = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: string) => Number(fields.find((f) => f.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time at the property ("2026-12-10" + "14:00" in Asia/Kolkata).
 * Used for cancellation deadlines and check-in cut-offs. Correct across DST changes: the offset
 * is re-evaluated at the candidate instant (two passes cover every transition).
 */
export function zonedTimeToUtc(date: LocalDate, time: string, timeZone: string): Date {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0);
  let instant = wall - zoneOffsetMs(timeZone, wall);
  instant = wall - zoneOffsetMs(timeZone, instant);
  return new Date(instant);
}
