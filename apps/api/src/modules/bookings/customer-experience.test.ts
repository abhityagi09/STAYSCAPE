import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceModel } from '@/modules/documents/invoice.model';
import { HotelModel } from '@/modules/hotels/hotel.model';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { NotificationDeliveryModel, OutboxEventModel } from '@/modules/outbox/outbox.models';
import { UserModel } from '@/modules/users/user.model';
import { bearer, registerUser } from '@/test/helpers';
import { PDF, daysFromToday, testImage } from '@/test/marketplace-fixtures';
import {
  bookingWorld,
  getBooking,
  holdAndBook,
  payInFull,
  type BookingWorld,
} from '@/test/booking-fixtures';

const ratings = { cleanliness: 5, staff: 4, location: 5, comfort: 4, facilities: 4, value: 4 };
const reviewBody = {
  ratings,
  title: 'Lovely lakeside stay',
  body: 'Quiet room, superb breakfast and very helpful staff throughout.',
};

/** A real completed stay: pay, then let the lifecycle job complete it after check-out. */
async function completedStay(world: BookingWorld) {
  const { booking } = await holdAndBook(world.app, world.customer, world.hotel, [0, 1]);
  await payInFull(world.app, world.customer, booking.reference);
  await world.container.services.lifecycle.completeStays(new Date(Date.now() + 2 * 86_400_000));
  return booking.reference;
}

describe('verified reviews', () => {
  it('only lets the guest of a completed stay review it, once, and updates the rating summary', async () => {
    const world = await bookingWorld();
    const { app, customer, hotel } = world;
    const { booking: upcoming } = await holdAndBook(app, customer, hotel, [20, 21]);
    await payInFull(app, customer, upcoming.reference);
    const early = await request(app)
      .post(`/api/v1/bookings/${upcoming.reference}/review`)
      .set(bearer(customer.accessToken))
      .send(reviewBody);
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('NOT_ELIGIBLE');

    const reference = await completedStay(world);
    const stranger = await registerUser(app);
    await request(app)
      .post(`/api/v1/bookings/${reference}/review`)
      .set(bearer(stranger.accessToken))
      .send(reviewBody)
      .expect(404);
    const created = await request(app)
      .post(`/api/v1/bookings/${reference}/review`)
      .set(bearer(customer.accessToken))
      .send(reviewBody)
      .expect(201);
    expect(created.body.data).toMatchObject({
      overall: 4.3,
      verifiedStay: true,
      status: 'PUBLISHED',
      canEdit: true,
    });
    expect(
      (
        await request(app)
          .post(`/api/v1/bookings/${reference}/review`)
          .set(bearer(customer.accessToken))
          .send(reviewBody)
      ).status,
    ).toBe(409);
    expect((await HotelModel.findById(hotel.hotelId).lean())!.ratingSummary).toEqual({
      average: 4.3,
      count: 1,
      source: 'REVIEWS',
    });

    const pub = await request(app).get(`/api/v1/hotels/${hotel.slug}/reviews`).expect(200);
    expect(pub.body.data.items).toHaveLength(1);
    expect(pub.body.data.summary.categories.cleanliness).toBe(5);
    expect(JSON.stringify(pub.body.data.items[0])).not.toMatch(/customerId|bookingId|@/);
  });

  it('limits edits, supports reports, owner responses and moderation — owners cannot delete', async () => {
    const world = await bookingWorld();
    const { app, customer, hotel, owner, admin } = world;
    const reference = await completedStay(world);
    const review = (
      await request(app)
        .post(`/api/v1/bookings/${reference}/review`)
        .set(bearer(customer.accessToken))
        .send(reviewBody)
        .expect(201)
    ).body.data;
    for (let i = 0; i < 3; i += 1)
      await request(app)
        .put(`/api/v1/reviews/${review.id}`)
        .set(bearer(customer.accessToken))
        .send({ ...reviewBody, ratings: { ...ratings, value: 5 } })
        .expect(200);
    expect(
      (
        await request(app)
          .put(`/api/v1/reviews/${review.id}`)
          .set(bearer(customer.accessToken))
          .send(reviewBody)
      ).status,
    ).toBe(409);
    const stranger = await registerUser(app);
    await request(app)
      .put(`/api/v1/reviews/${review.id}`)
      .set(bearer(stranger.accessToken))
      .send(reviewBody)
      .expect(404);

    await request(app)
      .post(`/api/v1/reviews/${review.id}/report`)
      .set(bearer(customer.accessToken))
      .send({ reason: 'SPAM' })
      .expect(409);
    await request(app)
      .post(`/api/v1/reviews/${review.id}/report`)
      .set(bearer(stranger.accessToken))
      .send({ reason: 'OFFENSIVE', details: 'Test report' })
      .expect(200);
    await request(app)
      .post(`/api/v1/reviews/${review.id}/report`)
      .set(bearer(stranger.accessToken))
      .send({ reason: 'OFFENSIVE' })
      .expect(200); // idempotent

    const base = `/api/v1/partner/hotels/${hotel.hotelId}/reviews`;
    await request(app)
      .put(`${base}/${review.id}/response`)
      .set(bearer(owner.accessToken))
      .send({ body: 'Thank you for staying with us!' })
      .expect(200);
    await request(app).delete(`${base}/${review.id}`).set(bearer(owner.accessToken)).expect(404); // no delete route exists
    const partnerView = await request(app).get(base).set(bearer(owner.accessToken)).expect(200);
    expect(partnerView.body.data[0]).toMatchObject({
      status: 'FLAGGED',
      reportCount: 1,
      response: { body: 'Thank you for staying with us!' },
    });
    expect(
      await NotificationModel.countDocuments({ userId: customer.id, type: 'REVIEW_RESPONSE' }),
    ).toBe(1);

    const flagged = await request(app)
      .get('/api/v1/admin/reviews')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(flagged.body.data[0].reports).toHaveLength(1);
    await request(app)
      .post(`/api/v1/admin/reviews/${review.id}/moderation`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'REMOVE', reason: 'Policy violation' })
      .expect(200);
    expect(
      (await request(app).get(`/api/v1/hotels/${hotel.slug}/reviews`).expect(200)).body.data.items,
    ).toHaveLength(0);
    expect((await HotelModel.findById(hotel.hotelId).lean())!.ratingSummary.count).toBe(0);
  });

  it('accepts only photos uploaded by the reviewer', async () => {
    const world = await bookingWorld();
    const { app, customer } = world;
    const reference = await completedStay(world);
    const stranger = await registerUser(app);
    const theirs = await request(app)
      .post('/api/v1/reviews/photos')
      .set(bearer(stranger.accessToken))
      .attach('file', await testImage(), { filename: 'x.png', contentType: 'image/png' })
      .expect(201);
    const mine = await request(app)
      .post('/api/v1/reviews/photos')
      .set(bearer(customer.accessToken))
      .attach('file', await testImage(), { filename: 'y.png', contentType: 'image/png' })
      .expect(201);
    await request(app)
      .post(`/api/v1/bookings/${reference}/review`)
      .set(bearer(customer.accessToken))
      .send({ ...reviewBody, photoIds: [theirs.body.data.id] })
      .expect(400);
    const ok = await request(app)
      .post(`/api/v1/bookings/${reference}/review`)
      .set(bearer(customer.accessToken))
      .send({ ...reviewBody, photoIds: [mine.body.data.id] })
      .expect(201);
    expect(ok.body.data.photos).toHaveLength(1);
  });
});

describe('wishlists', () => {
  it('manages named lists with notes, live availability and owner-only access', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const stranger = await registerUser(app);
    const list = (
      await request(app)
        .post('/api/v1/wishlists')
        .set(bearer(customer.accessToken))
        .send({ name: 'Rajasthan trip' })
        .expect(201)
    ).body.data;
    await request(app)
      .put(`/api/v1/wishlists/${list.id}/items/${hotel.hotelId}`)
      .set(bearer(customer.accessToken))
      .send({ note: 'Ask for lake view' })
      .expect(200);
    await request(app)
      .put(`/api/v1/wishlists/${list.id}/items/${hotel.hotelId}`)
      .set(bearer(customer.accessToken))
      .send({ note: 'Ask for lake view' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/wishlists/${list.id}`)
      .set(bearer(customer.accessToken))
      .send({ name: 'Udaipur' })
      .expect(200);
    const detail = await request(app)
      .get(
        `/api/v1/wishlists/${list.id}?checkIn=${daysFromToday(30)}&checkOut=${daysFromToday(32)}`,
      )
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      name: 'Udaipur',
      itemCount: 1,
      items: [
        { note: 'Ask for lake view', availableForDates: true, price: { totalMinor: 1_050_000 } },
      ],
    });

    for (const [method, path] of [
      ['get', ''],
      ['patch', ''],
      ['delete', ''],
      ['put', `/items/${hotel.hotelId}`],
      ['post', '/share'],
    ] as const) {
      const res = await request(app)
        [method](`/api/v1/wishlists/${list.id}${path}`)
        .set(bearer(stranger.accessToken))
        .send(method === 'patch' ? { name: 'x' } : {});
      expect(res.status).toBe(404);
    }

    const { shareUrl } = (
      await request(app)
        .post(`/api/v1/wishlists/${list.id}/share`)
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    const token = String(shareUrl).split('/').pop()!;
    const shared = await request(app).get(`/api/v1/wishlists/shared/${token}`).expect(200);
    expect(shared.body.data).toMatchObject({
      name: 'Udaipur',
      items: [{ hotel: { id: hotel.hotelId } }],
    });
    expect(JSON.stringify(shared.body.data)).not.toMatch(/Ask for lake view|userId|email/);
    await request(app)
      .delete(`/api/v1/wishlists/${list.id}/share`)
      .set(bearer(customer.accessToken))
      .expect(200);
    await request(app).get(`/api/v1/wishlists/shared/${token}`).expect(404);

    // The heart button keeps working through the default list.
    await request(app)
      .put(`/api/v1/wishlist/${hotel.hotelId}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    const lists = (
      await request(app).get('/api/v1/wishlists').set(bearer(customer.accessToken)).expect(200)
    ).body.data;
    const def = lists.find((l: { isDefault: boolean }) => l.isDefault);
    expect(def.itemCount).toBe(1);
    expect(
      (await request(app).delete(`/api/v1/wishlists/${def.id}`).set(bearer(customer.accessToken)))
        .status,
    ).toBe(409);
    await request(app)
      .delete(`/api/v1/wishlist/${hotel.hotelId}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(
      (await request(app).get('/api/v1/wishlist/ids').set(bearer(customer.accessToken)).expect(200))
        .body.data,
    ).toEqual([]);
  });
});

describe('support tickets', () => {
  it('links tickets to the customer’s own bookings and keeps attachments private', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel);
    const stranger = await registerUser(app);
    const create = (user: typeof customer, bookingReference: string) =>
      request(app)
        .post('/api/v1/support/tickets')
        .set(bearer(user.accessToken))
        .field('subject', 'Question about my stay')
        .field('category', 'BOOKING')
        .field('bookingReference', bookingReference)
        .field('message', 'Can I get an early check-in please?')
        .attach('file', PDF, { filename: 'id.pdf', contentType: 'application/pdf' });
    expect((await create(stranger, booking.reference)).status).toBe(422);
    const ticket = (await create(customer, booking.reference).expect(201)).body.data;
    expect(ticket).toMatchObject({
      status: 'OPEN',
      bookingReference: booking.reference,
      messages: [{ author: 'CUSTOMER', attachments: [{ fileName: 'id.pdf' }] }],
    });
    const fileId = ticket.messages[0].attachments[0].id;
    const file = await request(app)
      .get(`/api/v1/support/tickets/${ticket.id}/attachments/${fileId}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(file.headers['cache-control']).toContain('no-store');
    await request(app)
      .get(`/api/v1/support/tickets/${ticket.id}/attachments/${fileId}`)
      .set(bearer(stranger.accessToken))
      .expect(404);
    await request(app)
      .get(`/api/v1/support/tickets/${ticket.id}`)
      .set(bearer(stranger.accessToken))
      .expect(404);
    await request(app)
      .post(`/api/v1/support/tickets/${ticket.id}/messages`)
      .set(bearer(customer.accessToken))
      .field('body', 'Any update?')
      .expect(201);
    const closed = await request(app)
      .post(`/api/v1/support/tickets/${ticket.id}/close`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', messages: [{}, {}] });
    expect(
      (
        await request(app)
          .post(`/api/v1/support/tickets/${ticket.id}/messages`)
          .set(bearer(customer.accessToken))
          .field('body', 'Hello?')
      ).status,
    ).toBe(409);
  });
});

describe('notifications', () => {
  it('retries a failed email without duplicating deliveries (outbox + delivery log)', async () => {
    const world = await bookingWorld();
    const { app, customer, hotel, mailer, container, admin } = world;
    const send = vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('SMTP unavailable'));
    const { booking } = await holdAndBook(app, customer, hotel);
    expect((await getBooking(app, customer, booking.reference)).status).toBe('PENDING_PAYMENT'); // the booking itself is unaffected
    const event = await OutboxEventModel.findOne({ type: 'booking.created' }).lean();
    expect(event).toMatchObject({ status: 'PENDING', attempts: 1 });
    const failed = await NotificationDeliveryModel.findOne({
      eventId: event!.eventId,
      channel: 'EMAIL',
    }).lean();
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'SMTP unavailable' });
    const ops = await request(app)
      .get('/api/v1/admin/operations')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(ops.body.data.failedDeliveries).toHaveLength(1);
    expect(ops.body.data.failedDeliveries[0].recipient).toMatch(/^.\*\*\*@/);

    await OutboxEventModel.updateOne({ _id: event!._id }, { $set: { availableAt: new Date() } });
    await container.services.outbox.dispatchPending();
    await container.services.outbox.dispatchPending(); // nothing left; never re-sent
    expect(
      await NotificationDeliveryModel.findOne({ eventId: event!.eventId, channel: 'EMAIL' }).lean(),
    ).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(mailer.sent.filter((m) => m.subject.startsWith('Complete your booking'))).toHaveLength(
      1,
    );
    expect(
      await NotificationModel.countDocuments({ userId: customer.id, type: 'BOOKING_CREATED' }),
    ).toBe(1);
    expect(await OutboxEventModel.findById(event!._id).lean()).toMatchObject({
      status: 'DISPATCHED',
    });
  });

  it('respects the booking-update email preference for reminders but always sends receipts', async () => {
    const { app, customer, hotel, mailer, container } = await bookingWorld();
    await UserModel.updateOne(
      { _id: customer.id },
      { $set: { 'preferences.notifications.emailBookingUpdates': false } },
    );
    const { booking } = await holdAndBook(app, customer, hotel, [1, 2]);
    await payInFull(app, customer, booking.reference);
    expect(mailer.sent.filter((m) => m.subject.startsWith('Booking confirmed'))).toHaveLength(1);
    expect(await container.services.lifecycle.remindCheckins()).toBe(1);
    expect(await container.services.lifecycle.remindCheckins()).toBe(1); // re-queued id is a no-op
    expect(mailer.sent.filter((m) => m.subject.includes('starts tomorrow'))).toHaveLength(0);
    expect(
      await NotificationDeliveryModel.findOne({ template: 'checkin-reminder' }).lean(),
    ).toMatchObject({ status: 'SKIPPED' });
    expect(
      await NotificationModel.countDocuments({ userId: customer.id, type: 'CHECKIN_REMINDER' }),
    ).toBe(1);
  });
});

describe('documents and dashboard', () => {
  it('issues one invoice per paid booking and serves documents only to the owner', async () => {
    const world = await bookingWorld();
    const { app, customer, hotel } = world;
    const { booking: unpaid } = await holdAndBook(app, customer, hotel, [40, 41]);
    expect(
      (
        await request(app)
          .get(`/api/v1/bookings/${unpaid.reference}/documents/invoice`)
          .set(bearer(customer.accessToken))
      ).status,
    ).toBe(409);
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    expect(await InvoiceModel.countDocuments()).toBe(1); // generated by the confirmation event
    const pdf = await request(app)
      .get(`/api/v1/bookings/${booking.reference}/documents/invoice`)
      .set(bearer(customer.accessToken))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['content-disposition']).toMatch(/SSI-\d{4}-\d{6}\.pdf/);
    await request(app)
      .get(`/api/v1/bookings/${booking.reference}/documents/invoice`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(await InvoiceModel.countDocuments()).toBe(1);
    // A lost file is re-rendered from the stored invoice record — same number, never re-issued.
    const issued = (await InvoiceModel.findOne().lean())!;
    await world.container.privateStorage.delete(issued.documentReference!);
    const healed = await request(app)
      .get(`/api/v1/bookings/${booking.reference}/documents/invoice`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(healed.headers['content-disposition']).toContain(`${issued.invoiceNumber}.pdf`);
    expect(await InvoiceModel.countDocuments()).toBe(1);
    await request(app)
      .get(`/api/v1/bookings/${booking.reference}/documents/confirmation`)
      .set(bearer(customer.accessToken))
      .expect(200);
    const stranger = await registerUser(app);
    await request(app)
      .get(`/api/v1/bookings/${booking.reference}/documents/invoice`)
      .set(bearer(stranger.accessToken))
      .expect(404);
  });

  it('builds the dashboard only from the customer’s own records', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    await holdAndBook(app, customer, hotel, [30, 31]); // pending payment
    const other = await registerUser(app);
    await holdAndBook(app, other, hotel, [15, 16]);
    const overview = (
      await request(app)
        .get('/api/v1/account/overview')
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    expect(overview.counts).toMatchObject({ upcoming: 1, pending: 1, completed: 0, cancelled: 0 });
    expect(overview.upcoming[0].reference).toBe(booking.reference);
    expect(overview.recentActivity.length).toBeGreaterThan(0);
    const payments = (
      await request(app)
        .get('/api/v1/account/payments')
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    expect(payments).toHaveLength(1);
    const filtered = (
      await request(app)
        .get(`/api/v1/bookings?view=pending&q=${encodeURIComponent(hotel.slug.slice(0, 4))}`)
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    expect(filtered.items).toHaveLength(1);
  });
});
