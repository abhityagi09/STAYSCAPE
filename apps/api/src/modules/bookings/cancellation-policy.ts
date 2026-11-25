/**
 * Cancellation policy engine — pure, deterministic, integer-only.
 *
 * Policies are snapshotted onto the booking when it is created, so later rate-plan edits never
 * change what a guest agreed to. Times are evaluated against the property's wall clock:
 *
 *   checkInInstant = check-in date + property check-in time, in the property's IANA time zone
 *   freeDeadline   = checkInInstant − freeCancellationHours        (FREE_CANCELLATION only)
 *
 * Rules (paid = amount captured for the booking):
 *   NON_REFUNDABLE                      → charge = paid
 *   FREE_CANCELLATION, now < deadline   → charge = 0
 *   FREE_CANCELLATION, now ≥ deadline   → "after-deadline rule"
 *   PARTIALLY_REFUNDABLE (any time)     → "after-deadline rule"
 *   after-deadline rule                 → fixedChargeMinor set ? charge = min(fixed, paid)
 *                                         : refund = paid × refundBasisPointsAfterDeadline
 *   NO_SHOW (property-recorded)         → refund = paid × noShowRefundBasisPoints
 *   now ≥ checkInInstant                → guests can no longer cancel online (no-show rules apply)
 *
 * Percentages round half away from zero to a whole minor unit (same helper as pricing), and the
 * charge is always `paid − refund`, so charge + refund equals paid exactly.
 */
import {
  zonedTimeToUtc,
  type CancellationPolicySnapshotDto,
  type CancellationPolicyType,
} from '@stayscape/shared';
import { applyBasisPoints } from '@/modules/pricing/pricing.engine';

export interface PolicyInput {
  type: CancellationPolicyType;
  freeCancellationHours: number;
  refundBasisPointsAfterDeadline: number;
  fixedChargeMinor?: number | null;
  noShowRefundBasisPoints?: number;
  description?: string | null;
}

export interface StayTiming {
  checkInLocalDate: string;
  checkInTime: string;
  timeZone: string;
}

export function checkInInstant(stay: StayTiming): Date {
  return zonedTimeToUtc(stay.checkInLocalDate, stay.checkInTime, stay.timeZone);
}

export function freeCancellationDeadline(policy: PolicyInput, stay: StayTiming): Date | null {
  if (policy.type !== 'FREE_CANCELLATION') return null;
  return new Date(checkInInstant(stay).getTime() - policy.freeCancellationHours * 3_600_000);
}

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

export function describePolicy(
  policy: PolicyInput,
  deadline: Date | null,
  formatMoney: (minor: number) => string,
): string {
  const after =
    policy.fixedChargeMinor !== null && policy.fixedChargeMinor !== undefined
      ? `a cancellation charge of ${formatMoney(policy.fixedChargeMinor)} applies`
      : policy.refundBasisPointsAfterDeadline > 0
        ? `${pct(policy.refundBasisPointsAfterDeadline)} of the amount paid is refunded`
        : 'the booking is non-refundable';
  switch (policy.type) {
    case 'NON_REFUNDABLE':
      return 'Non-refundable: no refund if you cancel or do not arrive.';
    case 'FREE_CANCELLATION':
      return `Free cancellation until ${deadline ? deadline.toISOString() : 'the deadline'} (property time); after that ${after}.`;
    case 'PARTIALLY_REFUNDABLE':
      return `Partially refundable: if you cancel, ${after}.`;
  }
}

export function snapshotPolicy(
  policy: PolicyInput,
  stay: StayTiming,
  formatMoney: (minor: number) => string,
): CancellationPolicySnapshotDto {
  const deadline = freeCancellationDeadline(policy, stay);
  return {
    type: policy.type,
    freeCancellationHours: policy.freeCancellationHours,
    refundBasisPointsAfterDeadline: policy.refundBasisPointsAfterDeadline,
    fixedChargeMinor: policy.fixedChargeMinor ?? null,
    noShowRefundBasisPoints: policy.noShowRefundBasisPoints ?? 0,
    description: policy.description ?? null,
    freeCancellationDeadline: deadline ? deadline.toISOString() : null,
    summary: describePolicy(policy, deadline, formatMoney),
  };
}

export interface CancellationOutcome {
  eligible: boolean;
  reason: string | null;
  beforeFreeCancellationDeadline: boolean;
  freeCancellationDeadline: Date | null;
  chargeMinor: number;
  refundMinor: number;
}

function assertMinor(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${label} must be a non-negative integer`);
}

/**
 * Evaluate a cancellation. `mode` CUSTOMER is a guest cancelling before arrival; NO_SHOW is the
 * property recording that the guest did not arrive.
 */
export function evaluateCancellation(params: {
  policy: PolicyInput;
  stay: StayTiming;
  paidMinor: number;
  now: Date;
  mode: 'CUSTOMER' | 'NO_SHOW';
}): CancellationOutcome {
  const { policy, stay, paidMinor, now, mode } = params;
  assertMinor(paidMinor, 'paidMinor');
  const deadline = freeCancellationDeadline(policy, stay);
  const arrival = checkInInstant(stay);
  const base = {
    freeCancellationDeadline: deadline,
    beforeFreeCancellationDeadline: Boolean(deadline && now < deadline),
  };
  const result = (refundMinor: number): CancellationOutcome => {
    const refund = Math.max(0, Math.min(paidMinor, refundMinor));
    return {
      ...base,
      eligible: true,
      reason: null,
      refundMinor: refund,
      chargeMinor: paidMinor - refund,
    };
  };

  if (mode === 'CUSTOMER' && now >= arrival) {
    return {
      ...base,
      eligible: false,
      reason: 'The check-in time has passed. Contact the property or our support team.',
      chargeMinor: 0,
      refundMinor: 0,
    };
  }
  if (mode === 'NO_SHOW')
    return result(applyBasisPoints(paidMinor, policy.noShowRefundBasisPoints ?? 0));
  if (policy.type === 'NON_REFUNDABLE') return result(0);
  if (policy.type === 'FREE_CANCELLATION' && deadline && now < deadline) return result(paidMinor);
  if (policy.fixedChargeMinor !== null && policy.fixedChargeMinor !== undefined) {
    assertMinor(policy.fixedChargeMinor, 'fixedChargeMinor');
    return result(paidMinor - Math.min(policy.fixedChargeMinor, paidMinor));
  }
  return result(applyBasisPoints(paidMinor, policy.refundBasisPointsAfterDeadline));
}
