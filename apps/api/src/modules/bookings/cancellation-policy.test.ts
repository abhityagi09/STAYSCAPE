import { describe, expect, it } from 'vitest';
import {
  checkInInstant,
  evaluateCancellation,
  freeCancellationDeadline,
  type PolicyInput,
} from './cancellation-policy';

const stay = { checkInLocalDate: '2026-12-10', checkInTime: '14:00', timeZone: 'Asia/Kolkata' };
const free: PolicyInput = {
  type: 'FREE_CANCELLATION',
  freeCancellationHours: 48,
  refundBasisPointsAfterDeadline: 0,
};

describe('cancellation policy engine', () => {
  it('computes check-in and deadline instants in the property time zone', () => {
    expect(checkInInstant(stay).toISOString()).toBe('2026-12-10T08:30:00.000Z'); // 14:00 IST = 08:30 UTC
    expect(freeCancellationDeadline(free, stay)!.toISOString()).toBe('2026-12-08T08:30:00.000Z');
    // DST-observing zone: London is UTC+1 in summer, UTC+0 in winter.
    expect(
      checkInInstant({
        checkInLocalDate: '2026-07-01',
        checkInTime: '15:00',
        timeZone: 'Europe/London',
      }).toISOString(),
    ).toBe('2026-07-01T14:00:00.000Z');
    expect(
      checkInInstant({
        checkInLocalDate: '2026-12-01',
        checkInTime: '15:00',
        timeZone: 'Europe/London',
      }).toISOString(),
    ).toBe('2026-12-01T15:00:00.000Z');
  });

  it('refunds in full before the free-cancellation deadline and applies the after-deadline rule after it', () => {
    const before = evaluateCancellation({
      policy: free,
      stay,
      paidMinor: 1_050_000,
      now: new Date('2026-12-08T08:29:59Z'),
      mode: 'CUSTOMER',
    });
    expect(before).toMatchObject({
      eligible: true,
      beforeFreeCancellationDeadline: true,
      chargeMinor: 0,
      refundMinor: 1_050_000,
    });
    const after = evaluateCancellation({
      policy: { ...free, refundBasisPointsAfterDeadline: 5_000 },
      stay,
      paidMinor: 1_050_001,
      now: new Date('2026-12-08T08:30:00Z'),
      mode: 'CUSTOMER',
    });
    // 50% of 1,050,001 = 525,000.5 → rounds half away from zero to 525,001; charge + refund = paid exactly.
    expect(after).toMatchObject({
      beforeFreeCancellationDeadline: false,
      refundMinor: 525_001,
      chargeMinor: 525_000,
    });
  });

  it('handles non-refundable, fixed-charge and partially refundable policies', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(
      evaluateCancellation({
        policy: {
          type: 'NON_REFUNDABLE',
          freeCancellationHours: 0,
          refundBasisPointsAfterDeadline: 0,
        },
        stay,
        paidMinor: 800_000,
        now,
        mode: 'CUSTOMER',
      }),
    ).toMatchObject({ chargeMinor: 800_000, refundMinor: 0 });
    const partial: PolicyInput = {
      type: 'PARTIALLY_REFUNDABLE',
      freeCancellationHours: 0,
      refundBasisPointsAfterDeadline: 7_500,
    };
    expect(
      evaluateCancellation({ policy: partial, stay, paidMinor: 800_000, now, mode: 'CUSTOMER' }),
    ).toMatchObject({ chargeMinor: 200_000, refundMinor: 600_000 });
    expect(
      evaluateCancellation({
        policy: { ...partial, fixedChargeMinor: 150_000 },
        stay,
        paidMinor: 800_000,
        now,
        mode: 'CUSTOMER',
      }),
    ).toMatchObject({ chargeMinor: 150_000, refundMinor: 650_000 });
    // A fixed charge never exceeds what was paid.
    expect(
      evaluateCancellation({
        policy: { ...partial, fixedChargeMinor: 9_000_000 },
        stay,
        paidMinor: 800_000,
        now,
        mode: 'CUSTOMER',
      }),
    ).toMatchObject({ chargeMinor: 800_000, refundMinor: 0 });
  });

  it('closes online cancellation at check-in time and applies the no-show rule for the property', () => {
    const atArrival = new Date('2026-12-10T08:30:00Z');
    expect(
      evaluateCancellation({
        policy: free,
        stay,
        paidMinor: 500_000,
        now: atArrival,
        mode: 'CUSTOMER',
      }),
    ).toMatchObject({ eligible: false, refundMinor: 0 });
    expect(
      evaluateCancellation({
        policy: { ...free, noShowRefundBasisPoints: 2_000 },
        stay,
        paidMinor: 500_000,
        now: atArrival,
        mode: 'NO_SHOW',
      }),
    ).toMatchObject({ eligible: true, refundMinor: 100_000, chargeMinor: 400_000 });
  });

  it('charges nothing on an unpaid booking', () => {
    expect(
      evaluateCancellation({
        policy: {
          type: 'NON_REFUNDABLE',
          freeCancellationHours: 0,
          refundBasisPointsAfterDeadline: 0,
        },
        stay,
        paidMinor: 0,
        now: new Date('2026-11-01T00:00:00Z'),
        mode: 'CUSTOMER',
      }),
    ).toMatchObject({ chargeMinor: 0, refundMinor: 0 });
  });
});
