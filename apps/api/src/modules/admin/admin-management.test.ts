import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { BookingModel } from '@/modules/bookings/booking.models';
import { DestinationModel } from '@/modules/catalog/catalog.models';
import { PaymentModel } from '@/modules/payments/payment.models';
import { bearer, createTestContext, createUserWithRoles } from '@/test/helpers';
import { createAdmin } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';

describe('admin catalogue', () => {
  it('creates, updates, guards and deletes amenities, destinations and categories with audit', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const support = await createUserWithRoles(app, ['SUPPORT']);
    const amenity = { code: 'ev-charging', name: 'EV charging', category: 'GENERAL' };

    await request(app)
      .post('/api/v1/admin/catalog/amenities')
      .set(bearer(support.accessToken))
      .send(amenity)
      .expect(403);
    const created = (
      await request(app)
        .post('/api/v1/admin/catalog/amenities')
        .set(bearer(admin.accessToken))
        .send(amenity)
        .expect(201)
    ).body.data;
    await request(app)
      .post('/api/v1/admin/catalog/amenities')
      .set(bearer(admin.accessToken))
      .send(amenity)
      .expect(409);
    await request(app)
      .put(`/api/v1/admin/catalog/amenities/${created.id}`)
      .set(bearer(admin.accessToken))
      .send({ ...amenity, code: 'ev' })
      .expect(422);
    await request(app)
      .put(`/api/v1/admin/catalog/amenities/${created.id}`)
      .set(bearer(admin.accessToken))
      .send({ ...amenity, name: 'EV charging point' })
      .expect(200);
    const audit = await AuditLogModel.findOne({ action: 'catalog.amenity_updated' }).lean();
    expect(audit?.metadata).toMatchObject({
      before: { name: 'EV charging' },
      after: { name: 'EV charging point' },
    });

    // Categories may only reference real amenities and appear publicly when active.
    const category = {
      code: 'green-stays',
      name: 'Green stays',
      propertyTypes: ['VILLA'],
      amenityCodes: ['ev-charging'],
    };
    await request(app)
      .post('/api/v1/admin/catalog/categories')
      .set(bearer(admin.accessToken))
      .send({ ...category, amenityCodes: ['nope'] })
      .expect(422);
    await request(app)
      .post('/api/v1/admin/catalog/categories')
      .set(bearer(admin.accessToken))
      .send({ ...category, propertyTypes: [], amenityCodes: [] })
      .expect(422);
    await request(app)
      .post('/api/v1/admin/catalog/categories')
      .set(bearer(admin.accessToken))
      .send(category)
      .expect(201);
    expect((await request(app).get('/api/v1/categories').expect(200)).body.data).toEqual([
      expect.objectContaining({ code: 'green-stays', amenityCodes: ['ev-charging'] }),
    ]);
    // An amenity used by a category cannot be deleted.
    await request(app)
      .delete(`/api/v1/admin/catalog/amenities/${created.id}`)
      .set(bearer(admin.accessToken))
      .expect(409);

    const dest = (
      await request(app)
        .post('/api/v1/admin/catalog/destinations')
        .set(bearer(admin.accessToken))
        .send({
          name: 'Hampi',
          slug: 'hampi',
          city: 'Hampi',
          region: 'Karnataka',
          country: 'in',
          latitude: 15.335,
          longitude: 76.46,
          description: 'Boulder-strewn ruins of Vijayanagara.',
        })
        .expect(201)
    ).body.data;
    expect((await DestinationModel.findById(dest.id).lean())?.coordinates.coordinates).toEqual([
      76.46, 15.335,
    ]);
    const list = (
      await request(app)
        .get('/api/v1/admin/catalog/destinations?q=ham')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data;
    expect(list.items).toHaveLength(1);
    await request(app)
      .delete(`/api/v1/admin/catalog/destinations/${dest.id}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(
      await AuditLogModel.exists({ action: 'catalog.destination_deleted', entityId: dest.id }),
    ).toBeTruthy();
  });
});

describe('admin records', () => {
  it('searches bookings, escalates once, lists payment exceptions and refunds, shows customer detail', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const admin = await createAdmin(app);
    const support = await createUserWithRoles(app, ['SUPPORT']);
    const paid = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, paid.booking.reference);

    const found = (
      await request(app)
        .get(`/api/v1/admin/bookings?q=${paid.booking.reference}`)
        .set(bearer(support.accessToken))
        .expect(200)
    ).body.data;
    expect(found.items).toEqual([
      expect.objectContaining({
        reference: paid.booking.reference,
        status: 'CONFIRMED',
        guestName: 'Meera Iyer',
        escalation: null,
      }),
    ]);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/bookings?q=iyer&status=CANCELLED')
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(0);

    const path = `/api/v1/admin/bookings/${paid.booking.reference}/escalations`;
    await request(app)
      .post(path)
      .set(bearer(support.accessToken))
      .send({ reason: 'Guest reports overbooking' })
      .expect(403); // read-only role
    const esc = (
      await request(app)
        .post(path)
        .set(bearer(admin.accessToken))
        .send({ reason: 'Guest reports overbooking', priority: 'URGENT' })
        .expect(201)
    ).body.data;
    await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .send({ reason: 'Second escalation attempt' })
      .expect(409);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/bookings?escalated=true')
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body.data.items[0].escalation,
    ).toMatchObject({ priority: 'URGENT' });
    expect(
      (
        await request(app)
          .get('/api/v1/admin/escalations')
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    await request(app)
      .post(`/api/v1/admin/escalations/${esc.id}/resolve`)
      .set(bearer(admin.accessToken))
      .send({ resolution: 'Moved to sister property' })
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/escalations/${esc.id}/resolve`)
      .set(bearer(admin.accessToken))
      .send({ resolution: 'again' })
      .expect(409);
    // After resolution a new escalation may be opened.
    await request(app)
      .post(path)
      .set(bearer(admin.accessToken))
      .send({ reason: 'Guest reports noise complaint' })
      .expect(201);

    // Payment exceptions: a failed attempt shows up; the verified payment does not.
    const unpaid = await holdAndBook(app, customer, hotel, [20, 21]);
    const unpaidBooking = (await BookingModel.findOne({
      bookingReference: unpaid.booking.reference,
    }).lean())!;
    await PaymentModel.create({
      bookingId: unpaidBooking._id,
      customerId: customer.id,
      provider: 'SANDBOX',
      providerOrderId: 'order_failed_1',
      amountMinor: 525_000,
      currency: 'INR',
      status: 'FAILED',
      idempotencyKey: 'k-failed-1',
      requestHash: 'h',
      failureReason: 'Card declined',
    });
    const exceptions = (
      await request(app)
        .get('/api/v1/admin/payments?exceptions=true')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data.items;
    expect(exceptions.map((p: { providerOrderId: string }) => p.providerOrderId)).toEqual([
      'order_failed_1',
    ]);
    const all = (
      await request(app).get('/api/v1/admin/payments').set(bearer(admin.accessToken)).expect(200)
    ).body.data;
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    expect(
      (
        await request(app)
          .get(`/api/v1/admin/payments?q=${paid.booking.reference}`)
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    await request(app).get('/api/v1/admin/payments').set(bearer(customer.accessToken)).expect(403);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/refunds?status=REQUESTED')
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(0);

    const detail = (
      await request(app)
        .get(`/api/v1/admin/customers/${customer.id}`)
        .set(bearer(support.accessToken))
        .expect(200)
    ).body.data;
    expect(detail).toMatchObject({
      email: customer.email,
      stats: { bookings: 2, spend: [{ currency: 'INR', amountMinor: 1_050_000 }] },
    });
    expect(detail).not.toHaveProperty('passwordHash');
    expect(
      (
        await request(app)
          .get(`/api/v1/admin/customers?q=${encodeURIComponent(customer.email)}`)
          .set(bearer(admin.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
  });
});
