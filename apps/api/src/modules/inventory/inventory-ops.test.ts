import request from 'supertest';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { BookingModel } from '@/modules/bookings/booking.models';
import { bearer, registerUser, type SignedInUser } from '@/test/helpers';
import { daysFromToday, ratePlanInput, type PublishedHotel } from '@/test/marketplace-fixtures';
import {
  bookingWorld,
  createHold,
  holdAndBook,
  holdBody,
  payInFull,
} from '@/test/booking-fixtures';

const calendar = async (
  app: Express,
  owner: SignedInUser,
  hotel: PublishedHotel,
  from: string,
  to: string,
) =>
  (
    await request(app)
      .get(
        `/api/v1/partner/hotels/${hotel.hotelId}/inventory?roomTypeId=${hotel.roomTypeId}&from=${from}&to=${to}`,
      )
      .set(bearer(owner.accessToken))
      .expect(200)
  ).body.data as Array<Record<string, unknown>>;
const quote = async (app: Express, hotel: PublishedHotel, checkIn: string, checkOut: string) =>
  await request(app).post('/api/v1/availability/quote').send({
    hotelId: hotel.hotelId,
    roomTypeId: hotel.roomTypeId,
    ratePlanId: hotel.ratePlanId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    childrenAges: [],
    rooms: 1,
  });

describe('advanced inventory', () => {
  it('stop-sell closes a date to new holds without touching existing reservations', async () => {
    const { app, owner, hotel, customer } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [30, 31]);
    await payInFull(app, customer, booking.reference);
    await request(app)
      .patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(30),
        to: daysFromToday(30),
        set: { stopSell: true },
      })
      .expect(200);
    const [day] = await calendar(app, owner, hotel, daysFromToday(30), daysFromToday(30));
    expect(day).toMatchObject({ stopSell: true, available: 0, bookedRooms: 1 });
    expect((await quote(app, hotel, daysFromToday(30), daysFromToday(31))).status).not.toBe(200);
    expect(
      (await createHold(app, customer, holdBody(hotel, daysFromToday(30), daysFromToday(31))))
        .status,
    ).not.toBe(201);
    expect(
      (await BookingModel.findOne({ bookingReference: booking.reference }).lean())?.bookingStatus,
    ).toBe('CONFIRMED');
    await request(app)
      .patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(30),
        to: daysFromToday(30),
        set: { stopSell: false },
      })
      .expect(200);
    expect(
      (await createHold(app, customer, holdBody(hotel, daysFromToday(30), daysFromToday(31))))
        .status,
    ).toBe(201);
  });

  it('applies maintenance blocks atomically alongside manual blocks and releases future nights', async () => {
    const { app, owner, hotel, customer } = await bookingWorld();
    const base = `/api/v1/partner/hotels/${hotel.hotelId}/inventory`;
    const { booking } = await holdAndBook(app, customer, hotel, [41, 42]);
    await payInFull(app, customer, booking.reference);

    // 5 rooms, 1 booked on day 41: a 5-room block cannot fit; nothing is changed (all nights or none).
    const tooMany = await request(app)
      .post(`${base}/blocks`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(40),
        to: daysFromToday(42),
        rooms: 5,
        reason: 'RENOVATION',
      })
      .expect(409);
    expect(tooMany.body.error.details.dates).toEqual([daysFromToday(41)]);
    expect(
      (await calendar(app, owner, hotel, daysFromToday(40), daysFromToday(42))).every(
        (d) => d.maintenanceRooms === 0,
      ),
    ).toBe(true);

    const block = (
      await request(app)
        .post(`${base}/blocks`)
        .set(bearer(owner.accessToken))
        .send({
          roomTypeId: hotel.roomTypeId,
          from: daysFromToday(40),
          to: daysFromToday(42),
          rooms: 3,
          reason: 'MAINTENANCE',
          note: 'AC replacement',
        })
        .expect(201)
    ).body.data;
    // A manual block is set on top of the maintenance block, never replacing it.
    await request(app)
      .patch(base)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(40),
        to: daysFromToday(42),
        set: { blockedRooms: 1 },
      })
      .expect(200);
    let days = await calendar(app, owner, hotel, daysFromToday(40), daysFromToday(42));
    expect(days[0]).toMatchObject({ blockedRooms: 1, maintenanceRooms: 3, available: 1 });
    expect(days[1]).toMatchObject({
      blockedRooms: 1,
      maintenanceRooms: 3,
      bookedRooms: 1,
      available: 0,
    });
    // Manual blocks cannot eat into maintenance + committed rooms.
    await request(app)
      .patch(base)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(41),
        to: daysFromToday(41),
        set: { blockedRooms: 2 },
      })
      .expect(409);

    expect(
      (await request(app).get(`${base}/blocks`).set(bearer(owner.accessToken)).expect(200)).body
        .data,
    ).toEqual([expect.objectContaining({ id: block.id, rooms: 3, reason: 'MAINTENANCE' })]);
    await request(app)
      .post(`${base}/blocks/${block.id}/release`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app)
      .post(`${base}/blocks/${block.id}/release`)
      .set(bearer(owner.accessToken))
      .expect(409);
    days = await calendar(app, owner, hotel, daysFromToday(40), daysFromToday(42));
    expect(days[0]).toMatchObject({ blockedRooms: 1, maintenanceRooms: 0, available: 4 });

    // Staff with view-only inventory access can see but not place blocks.
    const staff = await registerUser(app);
    const invite = await request(app)
      .post('/api/v1/partner/staff')
      .set(bearer(owner.accessToken))
      .send({
        email: staff.email,
        assignedProperties: [hotel.hotelId],
        permissions: ['inventory:view'],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/partner/invitations/${invite.body.data.id}/accept`)
      .set(bearer(staff.accessToken))
      .expect(200);
    await request(app)
      .get(`${base}/blocks?status=RELEASED`)
      .set(bearer(staff.accessToken))
      .expect(200);
    await request(app)
      .post(`${base}/blocks`)
      .set(bearer(staff.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(50),
        to: daysFromToday(50),
        rooms: 1,
        reason: 'OTHER',
      })
      .expect(404);
    await request(app)
      .post(`${base}/blocks`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(-2),
        to: daysFromToday(1),
        rooms: 1,
        reason: 'OTHER',
      })
      .expect(422);
  });
});

describe('advanced pricing', () => {
  it('applies occupancy-based adjustments and promotional booking windows', async () => {
    const { app, owner, hotel, customer } = await bookingWorld();
    const rules = `/api/v1/partner/hotels/${hotel.hotelId}/pricing-rules`;
    await request(app)
      .post(rules)
      .set(bearer(owner.accessToken))
      .send({
        name: 'High demand',
        ruleType: 'OCCUPANCY',
        adjustmentType: 'PERCENT',
        adjustmentValue: 2_000,
        conditions: { minOccupancyBp: 4_000 },
      })
      .expect(201);
    await request(app)
      .post(rules)
      .set(bearer(owner.accessToken))
      .send({
        name: 'Bad',
        ruleType: 'OCCUPANCY',
        adjustmentType: 'PERCENT',
        adjustmentValue: 2_000,
      })
      .expect(422);

    // Night 60 starts empty: base price.
    expect(
      (await quote(app, hotel, daysFromToday(60), daysFromToday(61))).body.data.totals
        .roomChargesMinor,
    ).toBe(500_000);
    // Two of five rooms sold → 40 % occupancy → +20 %.
    for (let i = 0; i < 2; i += 1) {
      const guest = await registerUser(app);
      const { booking } = await holdAndBook(app, guest, hotel, [60, 61]);
      await payInFull(app, guest, booking.reference);
    }
    const busy = (await quote(app, hotel, daysFromToday(60), daysFromToday(61))).body.data;
    expect(busy.totals.roomChargesMinor).toBe(600_000);
    expect(busy.nightly[0].adjustments).toEqual([{ label: 'High demand', amountMinor: 100_000 }]);

    // Promotions only inside their booking window.
    await request(app)
      .post(rules)
      .set(bearer(owner.accessToken))
      .send({
        name: 'Flash sale',
        ruleType: 'PROMOTIONAL',
        adjustmentType: 'PERCENT',
        adjustmentValue: -1_000,
        conditions: { bookFrom: daysFromToday(0), bookTo: daysFromToday(2) },
      })
      .expect(201);
    await request(app)
      .post(rules)
      .set(bearer(owner.accessToken))
      .send({
        name: 'Future sale',
        ruleType: 'PROMOTIONAL',
        adjustmentType: 'PERCENT',
        adjustmentValue: -5_000,
        conditions: { bookFrom: daysFromToday(5), bookTo: daysFromToday(9) },
      })
      .expect(201);
    await request(app)
      .post(rules)
      .set(bearer(owner.accessToken))
      .send({
        name: 'No window',
        ruleType: 'PROMOTIONAL',
        adjustmentType: 'PERCENT',
        adjustmentValue: -1_000,
      })
      .expect(422);
    const promo = (await quote(app, hotel, daysFromToday(70), daysFromToday(71))).body.data;
    expect(promo.nightly[0].discounts).toEqual([{ label: 'Flash sale', amountMinor: -50_000 }]);
    expect(customer).toBeTruthy();
  });

  it('never changes the price snapshot of an existing booking when rates or rules change', async () => {
    const { app, owner, hotel, customer } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [80, 82]);
    const paid = await payInFull(app, customer, booking.reference);
    const before = (await BookingModel.findOne({ bookingReference: booking.reference }).lean())!
      .priceSnapshot;

    await request(app)
      .put(`/api/v1/partner/hotels/${hotel.hotelId}/rate-plans/${hotel.ratePlanId}`)
      .set(bearer(owner.accessToken))
      .send(ratePlanInput(hotel.roomTypeId, { basePriceMinor: 900_000 }))
      .expect(200);
    await request(app)
      .post(`/api/v1/partner/hotels/${hotel.hotelId}/pricing-rules`)
      .set(bearer(owner.accessToken))
      .send({
        name: 'Peak',
        ruleType: 'SEASONAL',
        startDate: daysFromToday(80),
        endDate: daysFromToday(82),
        adjustmentType: 'PERCENT',
        adjustmentValue: 5_000,
      })
      .expect(201);
    await request(app)
      .patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(80),
        to: daysFromToday(81),
        set: { stopSell: true },
      })
      .expect(200);

    const after = (await BookingModel.findOne({ bookingReference: booking.reference }).lean())!
      .priceSnapshot;
    expect(after).toEqual(before);
    const detail = (
      await request(app)
        .get(`/api/v1/bookings/${booking.reference}`)
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    expect(detail.price.totals.totalMinor).toBe(paid.price.totals.totalMinor);
    expect(detail.price.totals.totalMinor).toBe(1_050_000);
    // New quotes use the new rates.
    expect(
      (await quote(app, hotel, daysFromToday(90), daysFromToday(91))).body.data.totals
        .roomChargesMinor,
    ).toBe(900_000);
  });
});
