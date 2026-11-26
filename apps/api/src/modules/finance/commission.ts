/**
 * Commission engine — pure and integer-only (minor units, basis points).
 *
 * Base (per rule):
 *   ROOM_SUBTOTAL             room charges before rate-plan discounts
 *   DISCOUNTED_ROOM_SUBTOTAL  room charges after rate-plan discounts (default)
 *   + feesMinor               only when `includeFees` is set
 * Taxes are NEVER commissionable (they belong to the tax authority). Platform-funded coupons do
 * not reduce the base: the property is paid as if the guest paid the undiscounted price.
 *
 * commission = round_half_away(base × rateBasisPoints / 10 000) + fixedMinor, capped at base.
 * An exempt rule yields 0. Rule precedence: HOTEL > PARTNER > GLOBAL; within a scope a promotional
 * rule beats a standard one; then the most recent effectiveFrom; then the highest id.
 */
import { applyBasisPoints } from '@/modules/pricing/pricing.engine';

export type CommissionScope = 'GLOBAL' | 'PARTNER' | 'HOTEL';
export type CommissionBase = 'ROOM_SUBTOTAL' | 'DISCOUNTED_ROOM_SUBTOTAL';

export interface CommissionRuleInput {
  id: string;
  name: string;
  scope: CommissionScope;
  partnerId: string | null;
  hotelId: string | null;
  rateBasisPoints: number;
  fixedMinor: number;
  base: CommissionBase;
  includeFees: boolean;
  promotional: boolean;
  exempt: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  active: boolean;
}

export interface PriceTotals {
  roomChargesMinor: number;
  discountsMinor: number;
  subtotalMinor: number;
  taxesMinor: number;
  feesMinor: number;
  totalMinor: number;
}

export interface CommissionResult {
  ruleId: string | null;
  ruleName: string;
  scope: CommissionScope | 'DEFAULT';
  rateBasisPoints: number;
  fixedMinor: number;
  base: CommissionBase;
  includeFees: boolean;
  exempt: boolean;
  baseMinor: number;
  commissionMinor: number;
}

const SCOPE_RANK: Record<CommissionScope, number> = { HOTEL: 3, PARTNER: 2, GLOBAL: 1 };

export function selectCommissionRule(rules: CommissionRuleInput[], ctx: { partnerId: string; hotelId: string; at: Date }): CommissionRuleInput | null {
  const applicable = rules.filter(
    (r) =>
      r.active &&
      r.effectiveFrom <= ctx.at &&
      (!r.effectiveTo || ctx.at < r.effectiveTo) &&
      (r.scope === 'GLOBAL' || (r.scope === 'PARTNER' && r.partnerId === ctx.partnerId) || (r.scope === 'HOTEL' && r.hotelId === ctx.hotelId)),
  );
  applicable.sort(
    (a, b) =>
      SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] ||
      Number(b.promotional) - Number(a.promotional) ||
      b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  return applicable[0] ?? null;
}

export function commissionBaseMinor(totals: PriceTotals, base: CommissionBase, includeFees: boolean): number {
  // roomChargesMinor is pre-discount; subtotalMinor is after discounts, before taxes and fees.
  const room = base === 'ROOM_SUBTOTAL' ? totals.roomChargesMinor : totals.subtotalMinor;
  return Math.max(0, room + (includeFees ? totals.feesMinor : 0));
}

export function calculateCommission(totals: PriceTotals, rule: CommissionRuleInput | null, defaultBasisPoints: number): CommissionResult {
  const r = rule ?? null;
  const base = r?.base ?? 'DISCOUNTED_ROOM_SUBTOTAL';
  const includeFees = r?.includeFees ?? false;
  const baseMinor = commissionBaseMinor(totals, base, includeFees);
  const exempt = r?.exempt ?? false;
  const rate = r ? r.rateBasisPoints : defaultBasisPoints;
  const fixed = r?.fixedMinor ?? 0;
  const commissionMinor = exempt ? 0 : Math.min(baseMinor, applyBasisPoints(baseMinor, rate) + fixed);
  return {
    ruleId: r?.id ?? null,
    ruleName: r?.name ?? 'Platform default',
    scope: r?.scope ?? 'DEFAULT',
    rateBasisPoints: exempt ? 0 : rate,
    fixedMinor: exempt ? 0 : fixed,
    base,
    includeFees,
    exempt,
    baseMinor,
    commissionMinor,
  };
}

/**
 * Proportional reversal for a refund of `refundMinor` out of `paidMinor`: the platform gives back
 * the same share of its commission. Rounded half away from zero; never more than was charged.
 */
export function proportionalShare(amountMinor: number, partMinor: number, wholeMinor: number): number {
  if (wholeMinor <= 0 || amountMinor === 0) return 0;
  const numerator = amountMinor * partMinor;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('Amount too large');
  const q = Math.floor(Math.abs(numerator) / wholeMinor);
  const r = Math.abs(numerator) - q * wholeMinor;
  const rounded = r * 2 >= wholeMinor ? q + 1 : q;
  return Math.min(Math.abs(amountMinor), rounded) * Math.sign(numerator);
}
