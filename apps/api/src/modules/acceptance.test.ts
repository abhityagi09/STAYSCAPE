/**
 * Phase 5 acceptance scenario, steps 1–30, as one continuous flow through the real API, database
 * (transaction-capable replica set), pricing engine, payment provider (labelled sandbox) and
 * background jobs. The browser journeys for the same steps are in tests/e2e (auth, marketplace,
 * booking, phase4 specs); this test proves the steps connect end to end in a single story.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BookingModel } from '@/modules/bookings/booking.models';
import { LedgerEntryModel, SettlementModel } from '@/modules/finance/finance.models';
import {
  bearer,
  createTestContext,
  extractToken,
  loginUser,
  registerPayload,
  TEST_PASSWORD,
} from '@/test/helpers';
import {
  createAdmin,
  createApprovedPartner,
  createPublishedHotel,
  daysFromToday,
} from '@/test/marketplace-fixtures';
import { guestDetails, idem, sandboxPay, startPayment, verify } from '@/test/booking-fixtures';

const ratings = { cleanliness: 5, staff: 5, location: 5, comfort: 4, facilities: 4, value: 5 };

describe('acceptance: guest, partner and administrator journey (steps 1–30)', () => {
  it('runs the complete marketplace scenario', { timeout: 120_000 }, async () => {
    const { app, mailer, container } = createTestContext();
    const api = (path: string) => `/api/v1${path}`;

    // 1. Register customer.
    const email = 'acceptance.guest@example.com';
    await request(app).post(api('/auth/register')).send(registerPayload({ email })).expect(201);
    // 2. Verify email with the emailed single-use link.
    const token = extractToken(mailer.lastTo(email)?.text ?? '');
    await request(app).post(api('/auth/verify-email')).send({ token }).expect(200);
    // 3. Log in.
    const guest = await loginUser(app, email, TEST_PASSWORD);
    const me = (await request(app).get(api('/auth/me')).set(bearer(guest.accessToken))).body.data;
    expect(me.user ?? me).toMatchObject({
      email,
      emailVerified: true,
    });

    // 4–6. Partner registers, submits business details and documents; admin approves.
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const application = await request(app)
      .get(api('/partner/application'))
      .set(bearer(owner.accessToken));
    expect(application.body.data.verificationStatus).toBe('APPROVED');

    // 7–11. Partner creates the hotel, room categories, rates and inventory; admin approves
    // the listing and it is published.
    const hotel = await createPublishedHotel(app, owner, admin);
    const inventory = await request(app)
      .get(api(`/partner/hotels/${hotel.hotelId}/inventory`))
      .query({ roomTypeId: hotel.roomTypeId, from: daysFromToday(0), to: daysFromToday(3) })
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(inventory.body.data[0]).toMatchObject({
      totalRooms: expect.any(Number),
      available: expect.any(Number),
    });

    // 12. Customer searches the destination.
    const checkIn = daysFromToday(0);
    const checkOut = daysFromToday(1);
    const search = await request(app)
      .get(api('/hotels'))
      .query({ destination: 'Udaipur', checkIn, checkOut, adults: 2, rooms: 1 })
      .expect(200);
    expect(search.body.data.items.map((h: { id: string }) => h.id)).toContain(hotel.hotelId);
    expect(search.body.data.availabilityChecked).toBe(true);
    // 13. Customer filters results (type and star rating).
    const filtered = await request(app)
      .get(api('/hotels'))
      .query({ destination: 'Udaipur', propertyTypes: 'BOUTIQUE', stars: '4', checkIn, checkOut })
      .expect(200);
    expect(filtered.body.data.items.map((h: { id: string }) => h.id)).toContain(hotel.hotelId);
    // 14. Views hotel details.
    const detail = await request(app)
      .get(api(`/hotels/${hotel.slug}`))
      .expect(200);
    expect(detail.body.data).toMatchObject({ id: hotel.hotelId, slug: hotel.slug });
    // 15. Compares hotels.
    const compare = await request(app)
      .get(api('/hotels/compare'))
      .query({ ids: hotel.hotelId })
      .expect(200);
    expect(compare.body.data).toHaveLength(1);
    // 16. Selects a room (live offers for the dates).
    const offers = await request(app)
      .get(api(`/hotels/${hotel.slug}/offers`))
      .query({ checkIn, checkOut, adults: 2, rooms: 1 })
      .expect(200);
    expect(offers.body.data[0].offers.length).toBeGreaterThan(0);
    // 17. Backend creates a signed quote.
    const quote = await request(app)
      .post(api('/availability/quote'))
      .send({
        hotelId: hotel.hotelId,
        roomTypeId: hotel.roomTypeId,
        ratePlanId: hotel.ratePlanId,
        checkIn,
        checkOut,
        adults: 2,
        children: 0,
        childrenAges: [],
        rooms: 1,
      })
      .expect(200);
    expect(quote.body.data.totals.totalMinor).toBeGreaterThan(0);

    // 18. Customer acquires an inventory hold (server-priced).
    const hold = await request(app)
      .post(api('/bookings/holds'))
      .set(bearer(guest.accessToken))
      .set(idem())
      .send({
        hotelId: hotel.hotelId,
        checkIn,
        checkOut,
        items: [
          {
            roomTypeId: hotel.roomTypeId,
            ratePlanId: hotel.ratePlanId,
            rooms: 1,
            adults: 2,
            childrenAges: [],
            extraBeds: 0,
          },
        ],
      })
      .expect(201);
    expect(hold.body.data.price.totals.totalMinor).toBe(quote.body.data.totals.totalMinor);
    // 19. Enters guest details.
    const booked = await request(app)
      .post(api('/bookings'))
      .set(bearer(guest.accessToken))
      .set(idem())
      .send({ holdReference: hold.body.data.reference, guestDetails, acceptTerms: true })
      .expect(201);
    const reference = booked.body.data.reference as string;
    expect(booked.body.data.status).toBe('PENDING_PAYMENT');
    // 20. Completes the sandbox payment.
    await startPayment(app, guest, reference);
    const completion = await sandboxPay(app, guest, reference);
    // 21. Backend verifies the payment with the provider (signature + provider fetch).
    const verified = await verify(app, guest, reference, completion).expect(200);
    // 22. Booking is confirmed.
    expect(verified.body.data.booking).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'SUCCESS',
    });
    // 23. Customer receives the confirmation.
    expect(
      mailer.sent.filter((m) => m.to === email && m.subject.startsWith('Booking confirmed')),
    ).toHaveLength(1);

    // 24. Partner sees the reservation.
    const base = api(`/partner/hotels/${hotel.hotelId}/bookings`);
    const arrivals = await request(app)
      .get(`${base}?view=arrivals`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(arrivals.body.data.items.map((b: { reference: string }) => b.reference)).toContain(
      reference,
    );
    // 25. Partner checks the guest in.
    await request(app)
      .post(`${base}/${reference}/check-in`)
      .set(bearer(owner.accessToken))
      .expect(200);
    // 26. Partner checks the guest out; the lifecycle job completes the stay.
    await request(app)
      .post(`${base}/${reference}/check-out`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(
      await container.services.lifecycle.completeStays(new Date(Date.now() + 2 * 86_400_000)),
    ).toBe(1);

    // 27. Customer submits a verified review.
    await request(app)
      .post(api(`/bookings/${reference}/review`))
      .set(bearer(guest.accessToken))
      .send({
        ratings,
        title: 'A wonderful lakeside stay',
        body: 'Warm welcome, spotless room and a very calm atmosphere all weekend.',
      })
      .expect(201);
    // 28. The review appears publicly (post-moderation: published, reportable, moderators can remove).
    const reviews = await request(app)
      .get(api(`/hotels/${hotel.slug}/reviews`))
      .expect(200);
    expect(reviews.body.data.items).toEqual([
      expect.objectContaining({ title: 'A wonderful lakeside stay' }),
    ]);

    // 29. Admin sees updated analytics.
    const dashboard = await request(app)
      .get(api('/admin/dashboard'))
      .query({ from: daysFromToday(-1), to: daysFromToday(1) })
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(dashboard.body.data.metrics.totalBookings).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.data.metrics.grossBookingValueMinor).toBeGreaterThan(0);
    expect(dashboard.body.data.metrics.commissionRevenueMinor).toBeGreaterThan(0);

    // 30. Commission and settlement records are generated correctly.
    const stored = await BookingModel.findOne({ bookingReference: reference }).lean();
    expect(stored!.commissionSnapshot?.commissionMinor).toBeGreaterThan(0);
    const entries = await LedgerEntryModel.find({ bookingId: stored!._id }).lean();
    const sum = (account: string) =>
      entries.filter((e) => e.account === account).reduce((s, e) => s + e.amountMinor, 0);
    expect(sum('CASH')).toBe(stored!.priceSnapshot.totals.totalMinor);
    expect(sum('PLATFORM_REVENUE')).toBe(stored!.commissionSnapshot!.commissionMinor);
    expect(sum('CASH')).toBe(
      sum('PARTNER_PAYABLE') + sum('PLATFORM_REVENUE') + sum('PROMOTION_EXPENSE'),
    );
    // Once the settlement hold period has passed, the payable becomes a settlement batch.
    await BookingModel.updateOne(
      { _id: stored!._id },
      { $set: { checkOutLocalDate: '2020-01-02' } },
    );
    const settlement = await request(app)
      .post(api('/admin/settlements'))
      .set(bearer(admin.accessToken))
      .send({ partnerId: owner.partnerId })
      .expect(201);
    expect(settlement.body.data).toMatchObject({
      status: 'ELIGIBLE',
      netPayableMinor: sum('PARTNER_PAYABLE'),
      entryCount: 1,
    });
    expect(await SettlementModel.countDocuments({ partnerId: owner.partnerId })).toBe(1);
    // The independent reconciliation agrees with every source.
    expect((await container.services.reconciliation.exceptions()).length).toBe(0);
  });
});
