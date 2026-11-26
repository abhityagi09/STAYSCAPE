import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { RefundModel, SandboxRecordModel } from '@/modules/payments/payment.models';
import { bearer } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import {
  bookingWorld,
  deliverWebhook,
  getBooking,
  holdAndBook,
  idem,
  payInFull,
} from '@/test/booking-fixtures';
import { BookingModel } from './booking.models';

const cancel = (
  app: Parameters<typeof request>[0],
  token: string,
  reference: string,
  key?: string,
) =>
  request(app)
    .post(`/api/v1/bookings/${reference}/cancel`)
    .set(bearer(token))
    .set(idem(key))
    .send({ reason: 'Plans changed' });

describe('cancellations and refunds', () => {
  it('refunds in full before the deadline, releases inventory, and ignores duplicate requests', async () => {
    const { app, customer, hotel, mailer } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    const quote = await request(app)
      .get(`/api/v1/bookings/${booking.reference}/cancellation`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(quote.body.data).toMatchObject({
      eligible: true,
      beforeFreeCancellationDeadline: true,
      chargeMinor: 0,
      refundableMinor: 1_050_000,
    });

    const [a, b] = await Promise.all([
      cancel(app, customer.accessToken, booking.reference),
      cancel(app, customer.accessToken, booking.reference),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.data.alreadyCancelled, b.body.data.alreadyCancelled].sort()).toEqual([
      false,
      true,
    ]);
    expect(await RefundModel.countDocuments()).toBe(1);
    const final = await getBooking(app, customer, booking.reference);
    expect(final).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      cancellation: { cancellationChargeMinor: 0, refundableAmountMinor: 1_050_000 },
      refunds: [{ status: 'SUCCEEDED' }],
    });
    const days = await DailyInventoryModel.find({
      roomTypeId: hotel.roomTypeId,
      localDate: { $in: [daysFromToday(10), daysFromToday(11)] },
    }).lean();
    expect(days.map((d) => d.bookedRooms)).toEqual([0, 0]);
    expect(mailer.sent.filter((m) => m.subject.includes('cancelled'))).toHaveLength(1);
    expect(mailer.sent.filter((m) => m.subject.startsWith('Refund completed'))).toHaveLength(1);
  });

  it('applies the after-deadline percentage (partial refund)', async () => {
    const { app, customer, hotel } = await bookingWorld({
      rate: {
        cancellationPolicy: {
          type: 'FREE_CANCELLATION',
          freeCancellationHours: 72,
          refundBasisPointsAfterDeadline: 5_000,
        },
      },
    });
    const { booking } = await holdAndBook(app, customer, hotel, [1, 2]); // check-in tomorrow: inside 72 h
    await payInFull(app, customer, booking.reference);
    const res = await cancel(app, customer.accessToken, booking.reference).expect(200);
    expect(res.body.data).toMatchObject({
      chargeMinor: 262_500,
      refundableMinor: 262_500,
      refund: { status: 'SUCCEEDED', amountMinor: 262_500 },
    });
    expect((await getBooking(app, customer, booking.reference)).paymentStatus).toBe(
      'PARTIALLY_REFUNDED',
    );
  });

  it('charges a non-refundable booking in full and creates no refund', async () => {
    const { app, customer, hotel } = await bookingWorld({
      rate: {
        cancellationPolicy: {
          type: 'NON_REFUNDABLE',
          freeCancellationHours: 0,
          refundBasisPointsAfterDeadline: 0,
        },
      },
    });
    const { booking } = await holdAndBook(app, customer, hotel, [20, 22]);
    await payInFull(app, customer, booking.reference);
    const res = await cancel(app, customer.accessToken, booking.reference).expect(200);
    expect(res.body.data).toMatchObject({
      chargeMinor: 1_050_000,
      refundableMinor: 0,
      refund: null,
    });
    expect(await RefundModel.countDocuments()).toBe(0);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'SUCCESS',
    });
  });

  it('applies a fixed cancellation charge', async () => {
    const { app, customer, hotel } = await bookingWorld({
      rate: {
        cancellationPolicy: {
          type: 'PARTIALLY_REFUNDABLE',
          freeCancellationHours: 0,
          refundBasisPointsAfterDeadline: 0,
          fixedChargeMinor: 150_000,
        },
      },
    });
    const { booking } = await holdAndBook(app, customer, hotel, [20, 21]);
    await payInFull(app, customer, booking.reference);
    const res = await cancel(app, customer.accessToken, booking.reference).expect(200);
    expect(res.body.data).toMatchObject({ chargeMinor: 150_000, refundableMinor: 375_000 });
  });

  it('cancels an unpaid booking by releasing its hold', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [5, 7]);
    await cancel(app, customer.accessToken, booking.reference).expect(200);
    const days = await DailyInventoryModel.find({
      roomTypeId: hotel.roomTypeId,
      localDate: { $in: [daysFromToday(5), daysFromToday(6)] },
    }).lean();
    expect(days.map((d) => d.heldRooms)).toEqual([0, 0]);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      status: 'CANCELLED',
      actions: { canPay: false },
    });
  });

  it('escalates a failed refund, compensates the payment status and lets an admin retry', async () => {
    const { app, customer, hotel, sandbox, admin } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    await payInFull(app, customer, booking.reference);
    sandbox.controls.refundBehaviours.push('failed');
    await cancel(app, customer.accessToken, booking.reference).expect(200);
    const failed = await getBooking(app, customer, booking.reference);
    expect(failed).toMatchObject({ paymentStatus: 'SUCCESS', refunds: [{ status: 'FAILED' }] });
    expect(
      await NotificationModel.countDocuments({ userId: admin.id, type: 'OPERATIONS_ALERT' }),
    ).toBe(1);
    const ops = await request(app)
      .get('/api/v1/admin/operations')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(ops.body.data.refunds).toHaveLength(1);
    // Customers cannot use admin tooling.
    await request(app)
      .post(`/api/v1/admin/refunds/${failed.refunds[0]!.id}/retry`)
      .set(bearer(customer.accessToken))
      .expect(403);
    await request(app)
      .post(`/api/v1/admin/refunds/${failed.refunds[0]!.id}/retry`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      paymentStatus: 'REFUNDED',
      refunds: [{ status: 'SUCCEEDED' }],
    });
  });

  it('recovers a refund whose provider response was lost without refunding twice', async () => {
    const { app, customer, hotel, sandbox, container } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    await payInFull(app, customer, booking.reference);
    sandbox.controls.refundBehaviours.push('error'); // created at the provider, response lost
    await cancel(app, customer.accessToken, booking.reference).expect(200);
    expect((await getBooking(app, customer, booking.reference)).refunds[0]!.status).toBe(
      'PROCESSING',
    );
    await container.services.payments.reconcile(new Date(Date.now() + 5 * 60_000));
    expect((await getBooking(app, customer, booking.reference)).refunds[0]!.status).toBe(
      'SUCCEEDED',
    );
    expect(await SandboxRecordModel.countDocuments({ kind: 'REFUND' })).toBe(1);
  });

  it('completes a pending refund only when the provider confirms it (webhook)', async () => {
    const { app, customer, hotel, sandbox } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    await payInFull(app, customer, booking.reference);
    sandbox.controls.refundBehaviours.push('pending');
    await cancel(app, customer.accessToken, booking.reference).expect(200);
    const pending = await getBooking(app, customer, booking.reference);
    expect(pending).toMatchObject({
      paymentStatus: 'REFUND_PENDING',
      refunds: [{ status: 'PROCESSING' }],
    });
    const refund = await RefundModel.findOne().lean();
    const settled = await sandbox.settleRefund(refund!.providerRefundId!, 'processed');
    await deliverWebhook(app, sandbox, 'refund.processed', { refund: settled }).expect(200);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      paymentStatus: 'REFUNDED',
      refunds: [{ status: 'SUCCEEDED' }],
    });
  });

  it('supports idempotent partial admin refunds and never exceeds the captured amount', async () => {
    const { app, customer, hotel, admin } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    await payInFull(app, customer, booking.reference);
    const send = (amountMinor: number, key: string) =>
      request(app)
        .post(`/api/v1/admin/bookings/${booking.reference}/refunds`)
        .set(bearer(admin.accessToken))
        .set(idem(key))
        .send({ amountMinor, reason: 'Goodwill gesture' });
    await send(100_000, 'admin-refund-0001').expect(201);
    await send(100_000, 'admin-refund-0001').expect(201);
    expect(await RefundModel.countDocuments()).toBe(1);
    expect((await send(10_000_000, 'admin-refund-0002')).status).toBe(409);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      paymentStatus: 'PARTIALLY_REFUNDED',
    });
  });

  it('routes a customer refund request through an admin decision', async () => {
    const { app, customer, hotel, admin } = await bookingWorld({
      rate: {
        cancellationPolicy: {
          type: 'NON_REFUNDABLE',
          freeCancellationHours: 0,
          refundBasisPointsAfterDeadline: 0,
        },
      },
    });
    const { booking } = await holdAndBook(app, customer, hotel);
    await payInFull(app, customer, booking.reference);
    await cancel(app, customer.accessToken, booking.reference).expect(200);
    const requested = await request(app)
      .post(`/api/v1/bookings/${booking.reference}/refund-requests`)
      .set(bearer(customer.accessToken))
      .send({ reason: 'Family emergency — documents attached to my support ticket.' })
      .expect(201);
    expect(requested.body.data.status).toBe('REQUESTED');
    expect(
      (
        await request(app)
          .post(`/api/v1/bookings/${booking.reference}/refund-requests`)
          .set(bearer(customer.accessToken))
          .send({ reason: 'Asking again for the same booking.' })
      ).status,
    ).toBe(409);
    await request(app)
      .post(`/api/v1/admin/refunds/${requested.body.data.id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'APPROVE', amountMinor: 525_000 })
      .expect(200);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      paymentStatus: 'PARTIALLY_REFUNDED',
      refunds: [{ status: 'SUCCEEDED', amountMinor: 525_000 }],
    });
  });
});

describe('property operations', () => {
  it('checks guests in and out, completes the stay, and scopes access to the property', async () => {
    const { app, customer, hotel, owner, container } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [0, 1]); // arriving today
    await payInFull(app, customer, booking.reference);
    const base = `/api/v1/partner/hotels/${hotel.hotelId}/bookings`;
    const list = await request(app)
      .get(`${base}?view=arrivals`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(list.body.data.items).toMatchObject([
      { reference: booking.reference, guestName: 'Meera Iyer', actions: { canCheckIn: true } },
    ]);
    await request(app)
      .post(`${base}/${booking.reference}/check-out`)
      .set(bearer(owner.accessToken))
      .expect(409);
    await request(app)
      .post(`${base}/${booking.reference}/check-in`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app)
      .post(`${base}/${booking.reference}/check-out`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(
      await container.services.lifecycle.completeStays(new Date(Date.now() + 2 * 86_400_000)),
    ).toBe(1);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      status: 'COMPLETED',
      actions: { canReview: true, canCancel: false },
    });
    // The customer cannot drive property operations.
    await request(app)
      .post(`${base}/${booking.reference}/check-in`)
      .set(bearer(customer.accessToken))
      .expect(403);
  });

  it('records a no-show with the policy refund and frees remaining nights', async () => {
    const { app, customer, hotel, owner } = await bookingWorld({
      rate: {
        cancellationPolicy: {
          type: 'FREE_CANCELLATION',
          freeCancellationHours: 24,
          refundBasisPointsAfterDeadline: 0,
          noShowRefundBasisPoints: 1_000,
        },
      },
    });
    const { booking } = await holdAndBook(app, customer, hotel, [0, 2]);
    await payInFull(app, customer, booking.reference);
    await request(app)
      .post(`/api/v1/partner/hotels/${hotel.hotelId}/bookings/${booking.reference}/no-show`)
      .set(bearer(owner.accessToken))
      .send({ note: 'Guest did not arrive' })
      .expect(200);
    const final = await getBooking(app, customer, booking.reference);
    expect(final).toMatchObject({
      status: 'CANCELLED',
      cancellation: { reason: 'NO_SHOW', refundableAmountMinor: 105_000 },
    });
    const days = await DailyInventoryModel.find({
      roomTypeId: hotel.roomTypeId,
      localDate: { $in: [daysFromToday(0), daysFromToday(1)] },
    }).lean();
    expect(days.map((d) => d.bookedRooms)).toEqual([0, 0]);
    expect(await BookingModel.countDocuments({ bookingStatus: 'CANCELLED' })).toBe(1);
  });
});
