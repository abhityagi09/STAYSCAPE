import { describe, expect, it } from 'vitest';
import {
  applyBasisPoints,
  calculatePrice,
  distribute,
  selectRules,
  taxForAmount,
  type EngineInput,
  type EngineRule,
} from './pricing.engine';

const ratePlan: EngineInput['ratePlan'] = {
  id: 'rp',
  name: 'Standard',
  currency: 'INR',
  mealPlan: 'ROOM_ONLY',
  basePriceMinor: 500_000, // ₹5,000
  includedAdults: 2,
  includedChildren: 0,
  additionalAdultPriceMinor: 100_000,
  additionalChildPriceMinor: 50_000,
  extraBedPriceMinor: 80_000,
  mealSupplementPerGuestMinor: 0,
};
const noTax = { taxes: [], fees: [] };
const gst = {
  taxes: [
    {
      code: 'GST',
      label: 'GST',
      slabs: [
        { upToMinor: 750_000, basisPoints: 500 },
        { upToMinor: null, basisPoints: 1800 },
      ],
    },
  ],
  fees: [],
};

function rule(
  partial: Partial<EngineRule> &
    Pick<EngineRule, 'id' | 'ruleType' | 'adjustmentType' | 'adjustmentValue'>,
): EngineRule {
  return {
    name: partial.id,
    startDate: null,
    endDate: null,
    daysOfWeek: [],
    priority: 100,
    stackingPolicy: 'STACKABLE',
    conditions: {},
    ...partial,
  };
}

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    ratePlan,
    rules: [],
    nights: ['2027-03-01'], // Monday
    checkIn: '2027-03-01',
    bookingDate: '2027-02-01',
    rooms: 1,
    adults: 2,
    children: 0,
    extraBeds: 0,
    taxConfig: noTax,
    ...overrides,
  };
}

describe('integer money helpers', () => {
  it('rounds basis points half away from zero', () => {
    expect(applyBasisPoints(1005, 5000)).toBe(503); // 502.5 → 503
    expect(applyBasisPoints(1005, -5000)).toBe(-503);
    expect(applyBasisPoints(999, 1)).toBe(0); // 0.0999
    expect(applyBasisPoints(500_000, 1500)).toBe(75_000);
    expect(() => applyBasisPoints(1.5, 100)).toThrow();
  });

  it('distributes guests evenly across rooms', () => {
    expect(distribute(5, 2)).toEqual([3, 2]);
    expect(distribute(0, 3)).toEqual([0, 0, 0]);
  });

  it('picks the tax slab containing the amount', () => {
    expect(taxForAmount(750_000, gst.taxes[0]!.slabs)).toBe(37_500);
    expect(taxForAmount(750_001, gst.taxes[0]!.slabs)).toBe(135_000);
  });
});

describe('precedence', () => {
  it('uses the base rate when no rules apply', () => {
    const result = calculatePrice(input());
    expect(result.totals.totalMinor).toBe(500_000);
    expect(result.nightly[0]!.baseMinor).toBe(500_000);
  });

  it('applies weekend rates only on matching days', () => {
    const weekend = rule({
      id: 'wk',
      ruleType: 'WEEKEND',
      adjustmentType: 'PERCENT',
      adjustmentValue: 2000,
      daysOfWeek: [5, 6],
    });
    const result = calculatePrice(
      input({
        rules: [weekend],
        nights: ['2027-03-05', '2027-03-06', '2027-03-07'],
        checkIn: '2027-03-05',
      }),
    ); // Fri, Sat, Sun
    expect(result.nightly.map((n) => n.baseMinor)).toEqual([600_000, 600_000, 500_000]);
  });

  it('a date override replaces the base and suppresses seasonal adjustments', () => {
    const season = rule({
      id: 's',
      ruleType: 'SEASONAL',
      adjustmentType: 'PERCENT',
      adjustmentValue: 5000,
      startDate: '2027-01-01',
      endDate: '2027-12-31',
    });
    const overrideLow = rule({
      id: 'o1',
      ruleType: 'DATE_OVERRIDE',
      adjustmentType: 'FIXED_PRICE',
      adjustmentValue: 900_000,
      startDate: '2027-03-01',
      endDate: '2027-03-01',
      priority: 10,
    });
    const overrideHigh = rule({
      id: 'o2',
      ruleType: 'DATE_OVERRIDE',
      adjustmentType: 'FIXED_PRICE',
      adjustmentValue: 1_200_000,
      startDate: '2027-03-01',
      endDate: '2027-03-01',
      priority: 50,
    });
    const result = calculatePrice(input({ rules: [season, overrideLow, overrideHigh] }));
    expect(result.nightly[0]!.baseMinor).toBe(1_200_000);
  });

  it('stacks STACKABLE adjustments in priority order and honours EXCLUSIVE winners', () => {
    const a = rule({
      id: 'a',
      ruleType: 'SEASONAL',
      adjustmentType: 'PERCENT',
      adjustmentValue: 1000,
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      priority: 20,
    });
    const b = rule({
      id: 'b',
      ruleType: 'EVENT',
      adjustmentType: 'AMOUNT',
      adjustmentValue: 25_000,
      startDate: '2027-03-01',
      endDate: '2027-03-01',
      priority: 10,
    });
    // 500000 * 1.10 = 550000, + 25000 = 575000
    expect(calculatePrice(input({ rules: [a, b] })).nightly[0]!.baseMinor).toBe(575_000);
    const exclusive = rule({
      id: 'x',
      ruleType: 'EVENT',
      adjustmentType: 'PERCENT',
      adjustmentValue: 3000,
      startDate: '2027-03-01',
      endDate: '2027-03-01',
      priority: 99,
      stackingPolicy: 'EXCLUSIVE',
    });
    expect(calculatePrice(input({ rules: [a, b, exclusive] })).nightly[0]!.baseMinor).toBe(650_000);
    expect(selectRules([a, b, exclusive]).map((r) => r.id)).toEqual(['x']);
  });

  it('adds occupancy, extra bed and meal supplements per room', () => {
    const result = calculatePrice(
      input({
        ratePlan: { ...ratePlan, mealSupplementPerGuestMinor: 30_000 },
        adults: 3,
        children: 1,
        extraBeds: 1,
      }),
    );
    // base 500000 + 1 extra adult 100000 + 1 child 50000 + extra bed 80000 + meals 4×30000 = 850000
    expect(result.nightly[0]!.supplementsMinor).toBe(350_000);
    expect(result.totals.totalMinor).toBe(850_000);
  });

  it('applies discounts after supplements and only when the stay qualifies', () => {
    const longStay = rule({
      id: 'ls',
      ruleType: 'LONG_STAY',
      adjustmentType: 'PERCENT',
      adjustmentValue: -1000,
      conditions: { minNights: 3 },
    });
    const twoNights = calculatePrice(
      input({ rules: [longStay], nights: ['2027-03-01', '2027-03-02'] }),
    );
    expect(twoNights.totals.discountsMinor).toBe(0);
    const threeNights = calculatePrice(
      input({ rules: [longStay], nights: ['2027-03-01', '2027-03-02', '2027-03-03'] }),
    );
    expect(threeNights.totals.discountsMinor).toBe(-150_000);
    expect(threeNights.totals.totalMinor).toBe(1_350_000);
  });

  it('evaluates early-bird and last-minute windows against the booking date', () => {
    const early = rule({
      id: 'eb',
      ruleType: 'EARLY_BIRD',
      adjustmentType: 'PERCENT',
      adjustmentValue: -1500,
      conditions: { minDaysBeforeArrival: 30 },
    });
    const late = rule({
      id: 'lm',
      ruleType: 'LAST_MINUTE',
      adjustmentType: 'PERCENT',
      adjustmentValue: -2000,
      conditions: { maxDaysBeforeArrival: 3 },
    });
    expect(
      calculatePrice(input({ rules: [early, late], bookingDate: '2027-01-01' })).totals.totalMinor,
    ).toBe(425_000);
    expect(
      calculatePrice(input({ rules: [early, late], bookingDate: '2027-02-27' })).totals.totalMinor,
    ).toBe(400_000);
    expect(
      calculatePrice(input({ rules: [early, late], bookingDate: '2027-02-15' })).totals.totalMinor,
    ).toBe(500_000);
  });

  it('never lets a night go below zero', () => {
    const huge = rule({
      id: 'h',
      ruleType: 'LONG_STAY',
      adjustmentType: 'AMOUNT',
      adjustmentValue: -9_999_999,
      conditions: { minNights: 1 },
    });
    expect(calculatePrice(input({ rules: [huge] })).totals.totalMinor).toBe(0);
  });

  it('taxes each room-night by slab and adds fees by basis', () => {
    const fees = {
      ...gst,
      fees: [
        { code: 'CLEAN', label: 'Cleaning', amountMinor: 20_000, chargeBasis: 'PER_STAY' as const },
        {
          code: 'CITY',
          label: 'City fee',
          amountMinor: 5_000,
          chargeBasis: 'PER_ROOM_NIGHT' as const,
        },
      ],
    };
    const result = calculatePrice(
      input({ taxConfig: fees, rooms: 2, adults: 4, nights: ['2027-03-01', '2027-03-02'] }),
    );
    // 2 rooms × 2 nights × 500000 = 2,000,000; GST 5% = 100,000; fees 20000 + 5000×4 = 40000
    expect(result.totals.subtotalMinor).toBe(2_000_000);
    expect(result.totals.taxesMinor).toBe(100_000);
    expect(result.totals.feesMinor).toBe(40_000);
    expect(result.totals.totalMinor).toBe(2_140_000);
    const premium = calculatePrice(
      input({ taxConfig: gst, ratePlan: { ...ratePlan, basePriceMinor: 800_000 } }),
    );
    expect(premium.totals.taxesMinor).toBe(144_000); // 18% slab
  });

  it('is deterministic regardless of rule order', () => {
    const rules = [
      rule({
        id: 'a',
        ruleType: 'SEASONAL',
        adjustmentType: 'PERCENT',
        adjustmentValue: 1234,
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      }),
      rule({
        id: 'b',
        ruleType: 'SEASONAL',
        adjustmentType: 'PERCENT',
        adjustmentValue: -777,
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      }),
    ];
    const one = calculatePrice(input({ rules }));
    const two = calculatePrice(input({ rules: [...rules].reverse() }));
    expect(one).toEqual(two);
    expect(Number.isInteger(one.totals.totalMinor)).toBe(true);
  });
});
