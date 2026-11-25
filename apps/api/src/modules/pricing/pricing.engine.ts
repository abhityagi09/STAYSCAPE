/**
 * STAYSCAPE pricing engine — pure, deterministic, integer-only.
 *
 * All money is integer minor units (paise/cents). Percentages are basis points (1% = 100 bp).
 * Rounding: every percentage application rounds half away from zero to a whole minor unit,
 * immediately, per room per night (see `applyBasisPoints`). No floating-point value is ever
 * used as an amount of money.
 *
 * Precedence, evaluated per night and per room:
 *   1. Start from the rate plan's base nightly price.
 *   2. DATE_OVERRIDE: the highest-priority active override covering the night replaces the base
 *      price. When an override applies, step 3 is skipped for that night.
 *   3. Date adjustments (WEEKDAY, WEEKEND, SEASONAL, EVENT) matching the night:
 *        - sort by priority (desc), then rule id (asc) for determinism;
 *        - if the top rule is EXCLUSIVE, apply only it;
 *        - otherwise apply every STACKABLE rule in that order, each to the running amount.
 *      PERCENT changes by basis points, AMOUNT adds a (possibly negative) amount. Floor at 0.
 *   4. Supplements: guests beyond the rate plan's included adults/children, extra beds, and the
 *      meal-plan supplement per guest. Guests are distributed across rooms as evenly as possible.
 *   5. Discounts (LONG_STAY, EARLY_BIRD, LAST_MINUTE) eligible for the stay and covering the night,
 *      selected with the same EXCLUSIVE/STACKABLE rule as step 3 and applied to the night amount
 *      after supplements. A night never goes below 0.
 *   6. Taxes per room-night on the discounted amount, using the slab that contains that amount.
 *      Fees (untaxed) are added per stay, per night, or per room-night.
 *   7. The response contains every intermediate line so the total is fully explained.
 */
import {
  dayOfWeek,
  diffDays,
  type CurrencyCode,
  type MealPlan,
  type PricingAdjustmentType,
  type PricingRuleType,
  type StackingPolicy,
} from '@stayscape/shared';

export interface EngineRatePlan {
  id: string;
  name: string;
  currency: CurrencyCode;
  mealPlan: MealPlan;
  basePriceMinor: number;
  includedAdults: number;
  includedChildren: number;
  additionalAdultPriceMinor: number;
  additionalChildPriceMinor: number;
  extraBedPriceMinor: number;
  mealSupplementPerGuestMinor: number;
}

export interface EngineRule {
  id: string;
  name: string;
  ruleType: PricingRuleType;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: number[];
  adjustmentType: PricingAdjustmentType;
  adjustmentValue: number;
  priority: number;
  stackingPolicy: StackingPolicy;
  conditions: { minNights?: number; minDaysBeforeArrival?: number; maxDaysBeforeArrival?: number };
}

export interface EngineTaxConfig {
  taxes: Array<{
    code: string;
    label: string;
    slabs: Array<{ upToMinor: number | null; basisPoints: number }>;
  }>;
  fees: Array<{
    code: string;
    label: string;
    amountMinor: number;
    chargeBasis: 'PER_STAY' | 'PER_NIGHT' | 'PER_ROOM_NIGHT';
  }>;
}

export interface EngineInput {
  ratePlan: EngineRatePlan;
  rules: EngineRule[];
  nights: string[];
  checkIn: string;
  /** Property-local "today", for booking-window discounts. */
  bookingDate: string;
  rooms: number;
  adults: number;
  /** Children below the adult age threshold. */
  children: number;
  extraBeds: number;
  taxConfig: EngineTaxConfig;
}

export interface Line {
  label: string;
  amountMinor: number;
}

export interface NightResult {
  date: string;
  baseMinor: number;
  adjustments: Line[];
  supplementsMinor: number;
  discounts: Line[];
  lineMinor: number;
  taxes: Line[];
}

export interface EngineResult {
  currency: CurrencyCode;
  nightly: NightResult[];
  taxes: Line[];
  fees: Line[];
  totals: {
    roomChargesMinor: number;
    discountsMinor: number;
    subtotalMinor: number;
    taxesMinor: number;
    feesMinor: number;
    totalMinor: number;
  };
}

const ADJUSTMENT_TYPES: PricingRuleType[] = ['WEEKDAY', 'WEEKEND', 'SEASONAL', 'EVENT'];
const DISCOUNT_TYPES: PricingRuleType[] = ['LONG_STAY', 'EARLY_BIRD', 'LAST_MINUTE'];

function assertInt(value: number, label: string) {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} must be a safe integer, received ${value}`);
}

/** amount × bp / 10000, rounded half away from zero — integer arithmetic only. */
export function applyBasisPoints(amountMinor: number, basisPoints: number): number {
  assertInt(amountMinor, 'amount');
  assertInt(basisPoints, 'basis points');
  const product = amountMinor * basisPoints;
  assertInt(product, 'intermediate product');
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  const quotient = Math.floor(abs / 10_000);
  const remainder = abs - quotient * 10_000;
  return sign * (remainder * 2 >= 10_000 ? quotient + 1 : quotient);
}

/** Split `total` into `parts` integers differing by at most one (larger first). */
export function distribute(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

function coversDate(rule: EngineRule, date: string): boolean {
  if (rule.startDate && date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(dayOfWeek(date))) return false;
  return true;
}

function byPrecedence(a: EngineRule, b: EngineRule) {
  return b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** EXCLUSIVE top rule wins alone; otherwise all STACKABLE rules in precedence order. */
export function selectRules(candidates: EngineRule[]): EngineRule[] {
  const sorted = [...candidates].sort(byPrecedence);
  const top = sorted[0];
  if (!top) return [];
  if (top.stackingPolicy === 'EXCLUSIVE') return [top];
  return sorted.filter((rule) => rule.stackingPolicy === 'STACKABLE');
}

function adjust(amount: number, rule: EngineRule): number {
  if (rule.adjustmentType === 'PERCENT') return applyBasisPoints(amount, rule.adjustmentValue);
  if (rule.adjustmentType === 'AMOUNT') return rule.adjustmentValue;
  return 0;
}

function stayEligible(rule: EngineRule, nights: number, daysBeforeArrival: number): boolean {
  const c = rule.conditions ?? {};
  if (c.minNights !== undefined && nights < c.minNights) return false;
  if (c.minDaysBeforeArrival !== undefined && daysBeforeArrival < c.minDaysBeforeArrival)
    return false;
  if (c.maxDaysBeforeArrival !== undefined && daysBeforeArrival > c.maxDaysBeforeArrival)
    return false;
  return true;
}

export function taxForAmount(
  amountMinor: number,
  slabs: Array<{ upToMinor: number | null; basisPoints: number }>,
): number {
  const slab =
    slabs.find((s) => s.upToMinor === null || amountMinor <= s.upToMinor) ??
    slabs[slabs.length - 1];
  return slab ? applyBasisPoints(amountMinor, slab.basisPoints) : 0;
}

export function calculatePrice(input: EngineInput): EngineResult {
  const { ratePlan, rules, nights, rooms, taxConfig } = input;
  if (nights.length === 0) throw new RangeError('A stay needs at least one night');
  if (rooms < 1) throw new RangeError('At least one room is required');
  for (const [label, value] of Object.entries({
    basePriceMinor: ratePlan.basePriceMinor,
    additionalAdultPriceMinor: ratePlan.additionalAdultPriceMinor,
    additionalChildPriceMinor: ratePlan.additionalChildPriceMinor,
    extraBedPriceMinor: ratePlan.extraBedPriceMinor,
    mealSupplementPerGuestMinor: ratePlan.mealSupplementPerGuestMinor,
  })) {
    assertInt(value, label);
  }

  const daysBeforeArrival = diffDays(input.bookingDate, input.checkIn);
  const overrides = rules.filter((r) => r.ruleType === 'DATE_OVERRIDE');
  const adjustments = rules.filter((r) => ADJUSTMENT_TYPES.includes(r.ruleType));
  const discounts = rules.filter(
    (r) => DISCOUNT_TYPES.includes(r.ruleType) && stayEligible(r, nights.length, daysBeforeArrival),
  );

  const adultsPerRoom = distribute(input.adults, rooms);
  const childrenPerRoom = distribute(input.children, rooms);
  const bedsPerRoom = distribute(input.extraBeds, rooms);

  const taxTotals = new Map<string, Line>();
  const nightly: NightResult[] = nights.map((date) => {
    // Steps 1–3: one nightly room price, identical for every room.
    let base = ratePlan.basePriceMinor;
    const adjustmentLines: Line[] = [];
    const override = [...overrides].filter((r) => coversDate(r, date)).sort(byPrecedence)[0];
    if (override) {
      adjustmentLines.push({ label: override.name, amountMinor: override.adjustmentValue - base });
      base = override.adjustmentValue;
    } else {
      for (const rule of selectRules(adjustments.filter((r) => coversDate(r, date)))) {
        const delta = Math.max(adjust(base, rule), -base);
        base += delta;
        adjustmentLines.push({ label: rule.name, amountMinor: delta });
      }
    }
    const roomPrice = base;
    const nightDiscounts = selectRules(discounts.filter((r) => coversDate(r, date)));

    let supplementsMinor = 0;
    let lineMinor = 0;
    const discountTotals = new Map<string, number>();
    const nightTaxes = new Map<string, number>();

    for (let room = 0; room < rooms; room += 1) {
      // Step 4: supplements for this room's occupants.
      const adults = adultsPerRoom[room] ?? 0;
      const kids = childrenPerRoom[room] ?? 0;
      const supplements =
        Math.max(0, adults - ratePlan.includedAdults) * ratePlan.additionalAdultPriceMinor +
        Math.max(0, kids - ratePlan.includedChildren) * ratePlan.additionalChildPriceMinor +
        (bedsPerRoom[room] ?? 0) * ratePlan.extraBedPriceMinor +
        (adults + kids) * ratePlan.mealSupplementPerGuestMinor;
      supplementsMinor += supplements;

      // Step 5: discounts on the room-night amount.
      let amount = roomPrice + supplements;
      for (const rule of nightDiscounts) {
        const delta = Math.max(adjust(amount, rule), -amount);
        amount += delta;
        discountTotals.set(rule.name, (discountTotals.get(rule.name) ?? 0) + delta);
      }
      lineMinor += amount;

      // Step 6: taxes per room-night.
      for (const tax of taxConfig.taxes) {
        nightTaxes.set(
          tax.label,
          (nightTaxes.get(tax.label) ?? 0) + taxForAmount(amount, tax.slabs),
        );
      }
    }

    const taxes = [...nightTaxes].map(([label, amountMinor]) => ({ label, amountMinor }));
    for (const tax of taxes) {
      const current = taxTotals.get(tax.label);
      taxTotals.set(tax.label, {
        label: tax.label,
        amountMinor: (current?.amountMinor ?? 0) + tax.amountMinor,
      });
    }
    return {
      date,
      baseMinor: roomPrice,
      adjustments: adjustmentLines,
      supplementsMinor,
      discounts: [...discountTotals].map(([label, amountMinor]) => ({ label, amountMinor })),
      lineMinor,
      taxes,
    };
  });

  const fees: Line[] = taxConfig.fees.map((fee) => {
    const multiplier =
      fee.chargeBasis === 'PER_STAY'
        ? 1
        : fee.chargeBasis === 'PER_NIGHT'
          ? nights.length
          : nights.length * rooms;
    return { label: fee.label, amountMinor: fee.amountMinor * multiplier };
  });

  const discountsMinor = nightly.reduce(
    (sum, n) => sum + n.discounts.reduce((s, d) => s + d.amountMinor, 0),
    0,
  );
  const subtotalMinor = nightly.reduce((sum, n) => sum + n.lineMinor, 0);
  const roomChargesMinor = subtotalMinor - discountsMinor;
  const taxes = [...taxTotals.values()];
  const taxesMinor = taxes.reduce((s, t) => s + t.amountMinor, 0);
  const feesMinor = fees.reduce((s, f) => s + f.amountMinor, 0);
  const totalMinor = subtotalMinor + taxesMinor + feesMinor;
  for (const [label, value] of Object.entries({
    roomChargesMinor,
    subtotalMinor,
    taxesMinor,
    feesMinor,
    totalMinor,
  }))
    assertInt(value, label);

  return {
    currency: ratePlan.currency,
    nightly,
    taxes,
    fees,
    totals: { roomChargesMinor, discountsMinor, subtotalMinor, taxesMinor, feesMinor, totalMinor },
  };
}
