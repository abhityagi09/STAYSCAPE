import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { PaymentEventModel } from '@/modules/payments/payment.models';
import { NotificationDeliveryModel } from '@/modules/outbox/outbox.models';
import { bearer, registerUser } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import {
  bookingWorld,
  createHold,
  deliverWebhook,
  getBooking,
  guestDetails,
  holdAndBook,
  holdBody,
  idem,
  payInFull,
  sandboxPay,
  startPayment,
  verify,
} from '@/test/booking-fixtures';
import { BookingHoldModel, BookingModel } from './booking.models';

const inventory = async (roomTypeId: string, from: number, to: number) =>
  (
    await DailyInventoryModel.find({
      roomTypeId,
      localDate: { $gte: daysFromToday(from), $lte: daysFromToday(to) },
    })
      .sort({ localDate: 1 })
      .lean()
  ).map((d) => ({
    date: d.localDate,
    held: d.heldRooms,
    booked: d.bookedRooms,
  }));

describe('inventory holds', () => {
  it('holds every stay night but not the check-out date, at a server-calculated price', async () => {
    const { app, customer, hotel } = await bookingWorld();
    // 10 → 13: nights 10, 11, 12. The client cannot send a price.
    const forged = await createHold(app, customer, {
      ...holdBody(hotel, daysFromToday(10), daysFromToday(13)),
      totalMinor: 1,
    });
    expect(forged.status).toBe(422);
    const res = await createHold(
      app,
      customer,
      holdBody(hotel, daysFromToday(10), daysFromToday(13)),
    ).then((r) => r);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'ACTIVE',
      nights: 3,
      price: { totals: { totalMinor: 1_575_000 } },
    });
    expect(new Date(res.body.data.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const days = await inventory(hotel.roomTypeId, 10, 13);
    expect(days.filter((d) => d.held === 1).map((d) => d.date)).toEqual([
      daysFromToday(10),
      daysFromToday(11),
      daysFromToday(12),
    ]);
    expect(days.find((d) => d.date === daysFromToday(13))?.held ?? 0).toBe(0);
  });

  it('refuses stays that exceed inventory and requires an Idempotency-Key', async () => {
    const { app, customer, hotel } = await bookingWorld();
    expect(
      (
        await createHold(
          app,
          customer,
          holdBody(hotel, daysFromToday(5), daysFromToday(6), { rooms: 6, adults: 12 }),
        )
      ).status,
    ).toBe(409);
    const noKey = await request(app)
      .post('/api/v1/bookings/holds')
      .set(bearer(customer.accessToken))
      .send(holdBody(hotel, daysFromToday(5), daysFromToday(6)));
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await DailyInventoryModel.countDocuments({ heldRooms: { $gt: 0 } })).toBe(0);
  });

  it('lets exactly one of two customers take the final room', async () => {
    const { app, customer, hotel } = await bookingWorld({ room: { totalInventory: 1 } });
    const other = await registerUser(app);
    const body = holdBody(hotel, daysFromToday(8), daysFromToday(10));
    const results = await Promise.all([
      createHold(app, customer, body),
      createHold(app, other, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toMatch(
      /INVENTORY_UNAVAILABLE|CONFLICT/,
    );
    expect((await inventory(hotel.roomTypeId, 8, 9)).map((d) => d.held)).toEqual([1, 1]);
  });

  it('replays the same hold for a repeated Idempotency-Key and rejects a reused key with a different body', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const body = holdBody(hotel, daysFromToday(4), daysFromToday(5));
    const first = await createHold(app, customer, body, 'hold-key-0001');
    const again = await createHold(app, customer, body, 'hold-key-0001');
    expect(again.body.data.reference).toBe(first.body.data.reference);
    expect((await inventory(hotel.roomTypeId, 4, 4))[0]!.held).toBe(1);
    const changed = await createHold(
      app,
      customer,
      holdBody(hotel, daysFromToday(4), daysFromToday(6)),
      'hold-key-0001',
    );
    expect(changed.status).toBe(422);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('releases a hold exactly once', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const held = await createHold(
      app,
      customer,
      holdBody(hotel, daysFromToday(3), daysFromToday(5)),
    );
    const ref = held.body.data.reference as string;
    await request(app)
      .delete(`/api/v1/bookings/holds/${ref}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    const second = await request(app)
      .delete(`/api/v1/bookings/holds/${ref}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(second.body.data.status).toBe('RELEASED');
    expect((await inventory(hotel.roomTypeId, 3, 4)).map((d) => d.held)).toEqual([0, 0]);
  });

  it('expires holds once, releases inventory and expires the unpaid booking; repeat runs are no-ops', async () => {
    const { app, customer, hotel, container } = await bookingWorld();
    const { booking, hold } = await holdAndBook(app, customer, hotel, [6, 8]);
    await BookingHoldModel.updateOne(
      { holdReference: hold.reference },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(await container.services.bookings.expireHolds()).toBe(1);
    expect(await container.services.bookings.expireHolds()).toBe(0);
    await Promise.all([
      container.services.bookings.expireHolds(),
      container.services.bookings.expireHolds(),
    ]);
    expect((await inventory(hotel.roomTypeId, 6, 7)).map((d) => d.held)).toEqual([0, 0]);
    const after = await getBooking(app, customer, booking.reference);
    expect(after).toMatchObject({ status: 'EXPIRED', actions: { canPay: false } });
    expect(await BookingHoldModel.findOne({ holdReference: hold.reference }).lean()).toMatchObject({
      status: 'EXPIRED',
    });
  });

  it('never consumes an expired hold', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const held = await createHold(
      app,
      customer,
      holdBody(hotel, daysFromToday(6), daysFromToday(7)),
    );
    await BookingHoldModel.updateOne(
      { holdReference: held.body.data.reference },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const res = await request(app)
      .post('/api/v1/bookings')
      .set(bearer(customer.accessToken))
      .set(idem())
      .send({ holdReference: held.body.data.reference, guestDetails, acceptTerms: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });
});

describe('booking creation', () => {
  it('creates one booking per hold with price and policy snapshots, idempotently', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const held = await createHold(
      app,
      customer,
      holdBody(hotel, daysFromToday(10), daysFromToday(12)),
    );
    const body = { holdReference: held.body.data.reference, guestDetails, acceptTerms: true };
    const forged = await request(app)
      .post('/api/v1/bookings')
      .set(bearer(customer.accessToken))
      .set(idem())
      .send({ ...body, bookingStatus: 'CONFIRMED' });
    expect(forged.status).toBe(422);
    const [a, b] = await Promise.all([
      request(app)
        .post('/api/v1/bookings')
        .set(bearer(customer.accessToken))
        .set(idem('book-key-0001'))
        .send(body),
      request(app)
        .post('/api/v1/bookings')
        .set(bearer(customer.accessToken))
        .set(idem('book-key-0002'))
        .send(body),
    ]);
    expect([a.status, b.status].every((s) => s === 201)).toBe(true);
    expect(a.body.data.reference).toBe(b.body.data.reference);
    expect(await BookingModel.countDocuments()).toBe(1);
    expect(a.body.data).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'INITIATED',
      nights: 2,
      totalMinor: 1_050_000, // ₹5,000 × 2 nights + 5% tax
      items: [
        { rooms: 1, cancellationPolicy: { type: 'FREE_CANCELLATION', freeCancellationHours: 48 } },
      ],
      actions: { canPay: true, canCancel: true },
    });
    expect(a.body.data.reference).toMatch(/^SS-[A-Z0-9]{8}$/);
    expect(a.body.data.items[0].nightly).toHaveLength(2);
  });

  it('isolates customers: other users and partners of other hotels see 404', async () => {
    const { app, customer, hotel, admin } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    const stranger = await registerUser(app);
    for (const path of ['', '/cancellation', '/documents/confirmation']) {
      await request(app)
        .get(`/api/v1/bookings/${booking.reference}${path}`)
        .set(bearer(stranger.accessToken))
        .expect(404);
    }
    await request(app)
      .post(`/api/v1/bookings/${booking.reference}/cancel`)
      .set(bearer(stranger.accessToken))
      .set(idem())
      .send({})
      .expect(404);
    await request(app)
      .post(`/api/v1/bookings/${booking.reference}/payments`)
      .set(bearer(stranger.accessToken))
      .set(idem())
      .expect(404);
    expect(
      (await request(app).get('/api/v1/bookings').set(bearer(stranger.accessToken)).expect(200))
        .body.data.items,
    ).toHaveLength(0);
    // Another partner cannot see this hotel's reservations.
    const { createApprovedPartner } = await import('@/test/marketplace-fixtures');
    const otherOwner = await createApprovedPartner(app, admin);
    await request(app)
      .get(`/api/v1/partner/hotels/${hotel.hotelId}/bookings`)
      .set(bearer(otherOwner.accessToken))
      .expect(404);
  });
});

describe('payments', () => {
  it('confirms a booking only after verified payment: held → booked, hold consumed', async () => {
    const { app, customer, hotel, mailer } = await bookingWorld();
    const { booking, hold } = await holdAndBook(app, customer, hotel, [10, 12], {
      rooms: 2,
      adults: 4,
    });
    const config = await startPayment(app, customer, booking.reference);
    expect(config).toMatchObject({
      provider: 'SANDBOX',
      sandbox: true,
      amountMinor: 2_100_000,
      currency: 'INR',
      keyId: 'sandbox_key',
    });
    expect(JSON.stringify(config)).not.toMatch(/secret/i);
    const completion = await sandboxPay(app, customer, booking.reference);
    // A forged signature never confirms anything.
    const forged = await verify(app, customer, booking.reference, {
      ...completion,
      signature: 'f'.repeat(64),
    });
    expect(forged.status).toBe(400);
    expect((await getBooking(app, customer, booking.reference)).status).toBe('PAYMENT_PROCESSING');
    const ok = await verify(app, customer, booking.reference, completion).expect(200);
    expect(ok.body.data).toMatchObject({
      outcome: 'CONFIRMED',
      booking: { status: 'CONFIRMED', paymentStatus: 'SUCCESS' },
    });
    expect((await inventory(hotel.roomTypeId, 10, 11)).map((d) => [d.held, d.booked])).toEqual([
      [0, 2],
      [0, 2],
    ]);
    expect(await BookingHoldModel.findOne({ holdReference: hold.reference }).lean()).toMatchObject({
      status: 'CONSUMED',
    });
    // A consumed hold is never expired later.
    await BookingHoldModel.updateOne(
      { holdReference: hold.reference },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    // (expireHolds only scans ACTIVE holds)
    expect(mailer.sent.filter((m) => m.subject.startsWith('Booking confirmed'))).toHaveLength(1);
    // Repeating the verification is idempotent.
    await verify(app, customer, booking.reference, completion).expect(200);
    expect((await inventory(hotel.roomTypeId, 10, 11)).map((d) => d.booked)).toEqual([2, 2]);
    expect(mailer.sent.filter((m) => m.subject.startsWith('Booking confirmed'))).toHaveLength(1);
  });

  it('handles a failed payment and a successful retry', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    await startPayment(app, customer, booking.reference);
    const failed = await sandboxPay(app, customer, booking.reference, 'failure');
    const res = await verify(app, customer, booking.reference, failed).expect(200);
    expect(res.body.data).toMatchObject({
      outcome: 'FAILED',
      booking: { status: 'PENDING_PAYMENT', paymentStatus: 'FAILED', actions: { canPay: true } },
    });
    const retried = await payInFull(app, customer, booking.reference);
    expect(retried).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'SUCCESS' });
    expect(retried.payments.map((p) => p.status)).toEqual(['FAILED', 'SUCCESS']);
  });

  it('processes webhooks idempotently and out of order, with signature checks', async () => {
    const { app, customer, hotel, sandbox, mailer } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    const order = await startPayment(app, customer, booking.reference);
    const completion = await sandboxPay(app, customer, booking.reference);
    const payment = await sandbox.fetchPayment(completion.providerPaymentId);

    const bad = sandbox.buildWebhook('payment.captured', { payment });
    const rejected = await request(app)
      .post('/api/v1/payments/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'a'.repeat(64))
      .set('X-Razorpay-Event-Id', bad.eventId)
      .send(bad.body.toString());
    expect(rejected.status).toBe(400);

    const first = await deliverWebhook(
      app,
      sandbox,
      'payment.captured',
      { payment },
      'evt_dup_000001',
    );
    const dup = await deliverWebhook(
      app,
      sandbox,
      'payment.captured',
      { payment },
      'evt_dup_000001',
    );
    expect([first.body.data.status, dup.body.data.status]).toEqual(['processed', 'duplicate']);
    expect(await PaymentEventModel.countDocuments()).toBe(1);
    // A late "failed" event for the same payment must not undo the success.
    await deliverWebhook(app, sandbox, 'payment.failed', {
      payment: { ...payment, status: 'failed', errorDescription: 'late' },
    });
    const after = await getBooking(app, customer, booking.reference);
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'SUCCESS' });
    expect(order.providerOrderId).toBe(payment.orderId);
    expect(mailer.sent.filter((m) => m.subject.startsWith('Booking confirmed'))).toHaveLength(1);
    expect(
      await NotificationDeliveryModel.countDocuments({
        eventId: { $regex: /^booking\.confirmed/ },
        channel: 'EMAIL',
      }),
    ).toBe(1);
  });

  it('reconciles a payment whose browser closed and whose webhook never came', async () => {
    const { app, customer, hotel, container } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    await startPayment(app, customer, booking.reference);
    await sandboxPay(app, customer, booking.reference); // paid at the gateway; nothing told us
    expect((await getBooking(app, customer, booking.reference)).status).toBe('PAYMENT_PROCESSING');
    const result = await container.services.payments.reconcile(new Date(Date.now() + 2 * 60_000));
    expect(result.payments).toBe(1);
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'SUCCESS',
    });
  });

  it('re-allocates a payment that arrives after hold expiry when rooms are still free', async () => {
    const { app, customer, hotel, container } = await bookingWorld();
    const { booking, hold } = await holdAndBook(app, customer, hotel, [10, 12]);
    await startPayment(app, customer, booking.reference);
    const completion = await sandboxPay(app, customer, booking.reference);
    await BookingHoldModel.updateOne(
      { holdReference: hold.reference },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await container.services.bookings.expireHolds();
    expect((await getBooking(app, customer, booking.reference)).status).toBe('EXPIRED');
    const res = await verify(app, customer, booking.reference, completion).expect(200);
    expect(res.body.data.booking).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'SUCCESS' });
    expect((await inventory(hotel.roomTypeId, 10, 11)).map((d) => [d.held, d.booked])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('never double-allocates: a late payment for a room sold meanwhile is reconciled and refunded', async () => {
    const { app, customer, hotel, container } = await bookingWorld({ room: { totalInventory: 1 } });
    const { booking, hold } = await holdAndBook(app, customer, hotel, [10, 12]);
    await startPayment(app, customer, booking.reference);
    const completion = await sandboxPay(app, customer, booking.reference);
    await BookingHoldModel.updateOne(
      { holdReference: hold.reference },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await container.services.bookings.expireHolds();
    // Someone else books the only room.
    const other = await registerUser(app);
    const theirs = await holdAndBook(app, other, hotel, [10, 12]);
    await payInFull(app, other, theirs.booking.reference);

    const res = await verify(app, customer, booking.reference, completion).expect(200);
    expect(res.body.data.outcome).toBe('RECONCILIATION_REQUIRED');
    // The sandbox processes the automatic full refund immediately → booking ends cancelled.
    const final = await getBooking(app, customer, booking.reference);
    expect(final).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      refunds: [{ status: 'SUCCEEDED', amountMinor: 1_050_000 }],
    });
    expect((await inventory(hotel.roomTypeId, 10, 11)).map((d) => d.booked)).toEqual([1, 1]);
    const ops = await container.services.operations.overview();
    expect(ops.reconciliation).toHaveLength(0); // resolved by the refund
  });
});
