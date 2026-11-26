import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { BookingModel } from '@/modules/bookings/booking.models';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { bearer, registerUser } from '@/test/helpers';
import { createPublishedHotel, daysFromToday, hotelContent } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';
import { HotelDailyStatModel } from './hotel-stats.model';
import { toCsv } from './analytics.service';

describe('analytics', () => {
  it('computes partner KPIs from real bookings and inventory, scoped to permitted properties', async () => {
    const { app, customer, hotel, owner, admin } = await bookingWorld();
    const second = await createPublishedHotel(app, owner, admin, {
      content: hotelContent({ name: 'Second Stay', city: 'Jaipur' }),
    });
    // Stay A: 2 nights × ₹5,000 (+5 % tax) — confirmed. Stay B: 1 night — confirmed then cancelled.
    const a = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, a.booking.reference);
    const b = await holdAndBook(app, customer, hotel, [14, 15]);
    await payInFull(app, customer, b.booking.reference);
    await BookingModel.updateOne(
      { bookingReference: b.booking.reference },
      { $set: { bookingStatus: 'CANCELLED', cancelledAt: new Date() } },
    );
    // Maintenance block of 2 rooms on the first night of stay A.
    await DailyInventoryModel.updateOne(
      { roomTypeId: hotel.roomTypeId, localDate: daysFromToday(10) },
      { $set: { blockedRooms: 2 } },
    );
    await HotelDailyStatModel.create({ hotelId: hotel.hotelId, date: daysFromToday(0), views: 40 });

    const range = `from=${daysFromToday(0)}&to=${daysFromToday(30)}`;
    const res = await request(app)
      .get(`/api/v1/partner/analytics?${range}&hotelIds=${hotel.hotelId}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    const k = res.body.data.kpis;
    expect(k).toMatchObject({
      totalReservations: 2,
      cancelledBookings: 1,
      cancellationRateBp: 5_000,
      grossBookingValueMinor: 1_050_000 + 525_000,
      averageBookingValueMinor: 787_500,
      recognisedRoomRevenueMinor: 1_000_000, // taxes and the cancelled stay excluded
      roomNightsSold: 2,
      availableRoomNights: 5 * 30 - 2,
      adrMinor: 500_000,
      revparMinor: Math.round(1_000_000 / 148),
      occupancyBp: Math.round((2 * 10_000) / 148),
      detailViews: 40,
      bookingConversionBp: 500,
      upcomingArrivals: 0,
      currentGuests: 0,
    });
    const night = res.body.data.trend.find((t: { date: string }) => t.date === daysFromToday(10));
    expect(night).toMatchObject({
      roomNightsSold: 1,
      availableRoomNights: 3,
      revenueMinor: 500_000,
    });
    expect(res.body.data.roomPerformance[0]).toMatchObject({
      roomNightsSold: 2,
      revenueMinor: 1_000_000,
    });

    // Stay nights are clipped to the period: only the second night of stay A falls inside.
    const clipped = (
      await request(app)
        .get(
          `/api/v1/partner/analytics?from=${daysFromToday(11)}&to=${daysFromToday(13)}&hotelIds=${hotel.hotelId}`,
        )
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data.kpis;
    expect(clipped).toMatchObject({
      recognisedRoomRevenueMinor: 500_000,
      roomNightsSold: 1,
      availableRoomNights: 10,
    });

    // CSV export.
    const csv = await request(app)
      .get(`/api/v1/partner/analytics?${range}&hotelIds=${hotel.hotelId}&format=csv`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toBe(
      'date,currency,bookings,cancellations,room_nights_sold,available_room_nights,occupancy_percent,recognised_room_revenue_minor',
    );
    expect(csv.text.split('\n')).toHaveLength(31);

    // Staff only see the properties where they hold analytics:view.
    const staff = await registerUser(app);
    const invite = await request(app)
      .post('/api/v1/partner/staff')
      .set(bearer(owner.accessToken))
      .send({
        email: staff.email,
        assignedProperties: [second.hotelId],
        permissions: ['analytics:view'],
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/partner/invitations/${invite.body.data.id}/accept`)
      .set(bearer(staff.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/partner/analytics?hotelIds=${hotel.hotelId}`)
      .set(bearer(staff.accessToken))
      .expect(404);
    const own = (
      await request(app)
        .get(`/api/v1/partner/analytics?${range}`)
        .set(bearer(staff.accessToken))
        .expect(200)
    ).body.data;
    expect(own.hotelIds).toEqual([second.hotelId]);
    expect(own.kpis.totalReservations).toBe(0);
    await request(app)
      .get('/api/v1/partner/analytics')
      .set(bearer(customer.accessToken))
      .expect(403);
    await request(app)
      .get(`/api/v1/partner/analytics?from=${daysFromToday(5)}&to=${daysFromToday(1)}`)
      .set(bearer(owner.accessToken))
      .expect(422);
  });

  it('counts detail-page views per property-local day', async () => {
    const { app, hotel } = await bookingWorld();
    await request(app).get(`/api/v1/hotels/${hotel.slug}`).expect(200);
    await vi.waitFor(async () =>
      expect((await HotelDailyStatModel.findOne({ hotelId: hotel.hotelId }).lean())?.views).toBe(1),
    );
    expect((await HotelDailyStatModel.findOne({ hotelId: hotel.hotelId }).lean())?.date).toBe(
      daysFromToday(0),
    );
  });

  it('builds the admin dashboard with period comparison, from the ledger, behind permissions', async () => {
    const { app, customer, hotel, admin } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    const from = daysFromToday(-1);
    const to = daysFromToday(2);
    const dash = (
      await request(app)
        .get(`/api/v1/admin/dashboard?from=${from}&to=${to}`)
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data;
    expect(dash.metrics).toMatchObject({
      totalBookings: 1,
      confirmedBookings: 1,
      grossBookingValueMinor: 1_050_000,
      commissionRevenueMinor: 150_000,
      publishedProperties: 1,
      activePartners: 1,
      refundVolumeMinor: 0,
    });
    expect(dash.metrics.totalCustomers).toBeGreaterThanOrEqual(1);
    expect(dash.comparison.totalBookings).toEqual({ previous: 0, changeBp: null });

    const analytics = (
      await request(app)
        .get(`/api/v1/admin/analytics?from=${from}&to=${to}`)
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data;
    expect(analytics.bookingVolume).toEqual([
      { date: expect.any(String), bookings: 1, grossBookingValueMinor: 1_050_000 },
    ]);
    expect(analytics.commissionRevenue[0].amountMinor).toBe(150_000);
    expect(analytics.propertyDistribution.byCity[0]).toMatchObject({ count: 1 });
    const csv = await request(app)
      .get(`/api/v1/admin/analytics?from=${from}&to=${to}&format=csv`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(csv.text).toMatch(/^date,bookings,gross_booking_value_minor,commission_minor/);

    await request(app).get('/api/v1/admin/dashboard').set(bearer(customer.accessToken)).expect(403);
    await request(app).get('/api/v1/admin/analytics').set(bearer(customer.accessToken)).expect(403);
  });

  it('escapes CSV cells and neutralises formula injection', () => {
    expect(toCsv([{ name: '=HYPERLINK("x")', note: 'a,b', n: -5 }])).toBe(
      'name,note,n\n"\'=HYPERLINK(""x"")","a,b",-5',
    );
  });
});
