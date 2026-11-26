import { describe, expect, it } from 'vitest';
import {
  calculateCommission,
  proportionalShare,
  selectCommissionRule,
  type CommissionRuleInput,
} from './commission';

const totals = {
  roomChargesMinor: 1_000_000,
  discountsMinor: -100_000,
  subtotalMinor: 900_000,
  taxesMinor: 108_000,
  feesMinor: 20_000,
  totalMinor: 1_028_000,
};
const rule = (over: Partial<CommissionRuleInput>): CommissionRuleInput => ({
  id: 'r',
  name: 'Rule',
  scope: 'GLOBAL',
  partnerId: null,
  hotelId: null,
  rateBasisPoints: 1_000,
  fixedMinor: 0,
  base: 'DISCOUNTED_ROOM_SUBTOTAL',
  includeFees: false,
  promotional: false,
  exempt: false,
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  active: true,
  ...over,
});
const at = new Date('2026-06-01');
const ctx = { partnerId: 'p1', hotelId: 'h1', at };

describe('commission engine', () => {
  it('never commissions taxes; fees only when configured; base choice is explicit', () => {
    expect(calculateCommission(totals, rule({}), 0)).toMatchObject({
      baseMinor: 900_000,
      commissionMinor: 90_000,
    });
    expect(calculateCommission(totals, rule({ base: 'ROOM_SUBTOTAL' }), 0)).toMatchObject({
      baseMinor: 1_000_000,
      commissionMinor: 100_000,
    });
    expect(calculateCommission(totals, rule({ includeFees: true }), 0)).toMatchObject({
      baseMinor: 920_000,
      commissionMinor: 92_000,
    });
    expect(calculateCommission(totals, null, 1_500)).toMatchObject({
      scope: 'DEFAULT',
      commissionMinor: 135_000,
    });
    expect(calculateCommission(totals, rule({ exempt: true }), 1_500)).toMatchObject({
      commissionMinor: 0,
      rateBasisPoints: 0,
    });
    expect(
      calculateCommission(totals, rule({ rateBasisPoints: 10_000, fixedMinor: 50_000 }), 0)
        .commissionMinor,
    ).toBe(900_000); // capped at base
  });

  it('applies precedence HOTEL > PARTNER > GLOBAL, promotional within scope, and effective dates', () => {
    const rules = [
      rule({ id: 'g', scope: 'GLOBAL' }),
      rule({ id: 'p', scope: 'PARTNER', partnerId: 'p1' }),
      rule({
        id: 'pp',
        scope: 'PARTNER',
        partnerId: 'p1',
        promotional: true,
        effectiveTo: new Date('2026-07-01'),
      }),
      rule({ id: 'h-other', scope: 'HOTEL', hotelId: 'h2' }),
      rule({
        id: 'h-future',
        scope: 'HOTEL',
        hotelId: 'h1',
        effectiveFrom: new Date('2027-01-01'),
      }),
    ];
    expect(selectCommissionRule(rules, ctx)?.id).toBe('pp');
    expect(selectCommissionRule(rules, { ...ctx, at: new Date('2026-08-01') })?.id).toBe('p');
    expect(selectCommissionRule(rules, { ...ctx, at: new Date('2027-02-01') })?.id).toBe(
      'h-future',
    );
    expect(selectCommissionRule(rules, { partnerId: 'p9', hotelId: 'h9', at })?.id).toBe('g');
    expect(selectCommissionRule([rule({ active: false })], ctx)).toBeNull();
  });

  it('splits refunds proportionally with exact integer rounding', () => {
    expect(proportionalShare(90_000, 514_000, 1_028_000)).toBe(45_000);
    expect(proportionalShare(1, 1, 3)).toBe(0);
    expect(proportionalShare(2, 1, 3)).toBe(1); // 0.667 → 1
    expect(proportionalShare(90_000, 1_028_000, 1_028_000)).toBe(90_000);
    expect(proportionalShare(0, 5, 10)).toBe(0);
  });
});
