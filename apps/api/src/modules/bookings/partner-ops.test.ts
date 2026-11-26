import request from 'supertest';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { PartnerStaffModel } from '@/modules/partners/partner.model';
import { bearer, registerUser, type SignedInUser } from '@/test/helpers';
import { createPublishedHotel, hotelContent } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';

async function addStaff(
  app: Express,
  owner: SignedInUser,
  hotelIds: string[],
  permissions: string[],
) {
  const staff = await registerUser(app);
  const invite = await request(app)
    .post('/api/v1/partner/staff')
    .set(bearer(owner.accessToken))
    .send({ email: staff.email, assignedProperties: hotelIds, permissions })
    .expect(201);
  await request(app)
    .post(`/api/v1/partner/invitations/${invite.body.data.id}/accept`)
    .set(bearer(staff.accessToken))
    .expect(200);
  return { staff, staffId: invite.body.data.id as string };
}

describe('property staff permissions', () => {
  it('enforces the specific permission for the specific property on every request', async () => {
    const { app, customer, hotel, owner, admin } = await bookingWorld();
    const second = await createPublishedHotel(app, owner, admin, {
      content: hotelContent({ name: 'Second Stay', city: 'Jaipur' }),
    });
    const { booking } = await holdAndBook(app, customer, hotel, [0, 2]);
    await payInFull(app, customer, booking.reference);
    const base = `/api/v1/partner/hotels/${hotel.hotelId}/bookings`;

    const viewer = await addStaff(app, owner, [hotel.hotelId], ['bookings:view']);
    await request(app).get(base).set(bearer(viewer.staff.accessToken)).expect(200);
    await request(app)
      .get(`${base}/${booking.reference}`)
      .set(bearer(viewer.staff.accessToken))
      .expect(200);
    await request(app)
      .post(`${base}/${booking.reference}/check-in`)
      .set(bearer(viewer.staff.accessToken))
      .expect(404);
    await request(app)
      .post(`${base}/${booking.reference}/notes`)
      .set(bearer(viewer.staff.accessToken))
      .send({ body: 'x' })
      .expect(404);
    // Not assigned to the second property.
    await request(app)
      .get(`/api/v1/partner/hotels/${second.hotelId}/bookings`)
      .set(bearer(viewer.staff.accessToken))
      .expect(404);
    // Cannot change rates or inventory without those permissions.
    await request(app)
      .get(
        `/api/v1/partner/hotels/${hotel.hotelId}/inventory?roomTypeId=${hotel.roomTypeId}&from=2030-01-01&to=2030-01-02`,
      )
      .set(bearer(viewer.staff.accessToken))
      .expect(404);

    const frontDesk = await addStaff(
      app,
      owner,
      [hotel.hotelId],
      ['bookings:view', 'bookings:check-in', 'bookings:notes'],
    );
    await request(app)
      .put(`${base}/${booking.reference}/rooms`)
      .set(bearer(frontDesk.staff.accessToken))
      .send({ assignments: [{ roomTypeId: hotel.roomTypeId, roomNumbers: ['204'] }] })
      .expect(200);
    await request(app)
      .put(`${base}/${booking.reference}/rooms`)
      .set(bearer(frontDesk.staff.accessToken))
      .send({ assignments: [{ roomTypeId: hotel.roomTypeId, roomNumbers: ['204', '205'] }] })
      .expect(400);
    await request(app)
      .post(`${base}/${booking.reference}/notes`)
      .set(bearer(frontDesk.staff.accessToken))
      .send({ body: 'VIP — late arrival' })
      .expect(201);
    const checkedIn = await request(app)
      .post(`${base}/${booking.reference}/check-in`)
      .set(bearer(frontDesk.staff.accessToken))
      .expect(200);
    expect(checkedIn.body.data.status).toBe('CHECKED_IN');
    await request(app)
      .post(`${base}/${booking.reference}/check-out`)
      .set(bearer(frontDesk.staff.accessToken))
      .expect(404); // no check-out permission

    const detail = (
      await request(app)
        .get(`${base}/${booking.reference}`)
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data;
    expect(detail).toMatchObject({
      status: 'CHECKED_IN',
      roomAssignments: [{ roomNumbers: ['204'] }],
      notes: [{ body: 'VIP — late arrival' }],
    });
    expect(detail.checkedInBy).toBe('Asha Rao');
    expect(JSON.stringify(detail.payments)).not.toMatch(/providerPaymentId|pay_/);

    // Activity log for the staff member, scoped to this partner.
    const activity = (
      await request(app)
        .get(`/api/v1/partner/staff/${frontDesk.staffId}/activity`)
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data.items;
    expect(activity.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining([
        'booking.checked_in',
        'booking.note_added',
        'booking.rooms_assigned',
      ]),
    );
    // Staff cannot manage the team.
    await request(app)
      .get(`/api/v1/partner/staff/${frontDesk.staffId}/activity`)
      .set(bearer(frontDesk.staff.accessToken))
      .expect(403);
  });

  it('suspends and reactivates staff, edits permissions, and honours legacy permission codes', async () => {
    const { app, hotel, owner } = await bookingWorld();
    const base = `/api/v1/partner/hotels/${hotel.hotelId}/bookings`;
    const { staff, staffId } = await addStaff(app, owner, [hotel.hotelId], ['bookings:view']);
    await request(app)
      .post(`/api/v1/partner/staff/${staffId}/suspend`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app).get(base).set(bearer(staff.accessToken)).expect(404);
    await request(app)
      .post(`/api/v1/partner/staff/${staffId}/reactivate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app).get(base).set(bearer(staff.accessToken)).expect(200);

    await request(app)
      .patch(`/api/v1/partner/staff/${staffId}`)
      .set(bearer(owner.accessToken))
      .send({ assignedProperties: [hotel.hotelId], permissions: ['analytics:view'] })
      .expect(200);
    await request(app).get(base).set(bearer(staff.accessToken)).expect(404);

    // A Phase 3 record with the old coarse code still grants the equivalent new permissions.
    await PartnerStaffModel.updateOne(
      { _id: staffId },
      { $set: { permissions: ['BOOKINGS_MANAGE'] } },
    );
    await request(app).get(base).set(bearer(staff.accessToken)).expect(200);
    const team = (
      await request(app).get('/api/v1/partner/staff').set(bearer(owner.accessToken)).expect(200)
    ).body.data;
    expect(team[0].permissions).toEqual(
      expect.arrayContaining(['bookings:view', 'bookings:check-in', 'reviews:respond']),
    );
  });

  it('refuses check-in for cancelled or unconfirmed reservations and filters/searches the list', async () => {
    const { app, customer, hotel, owner } = await bookingWorld();
    const base = `/api/v1/partner/hotels/${hotel.hotelId}/bookings`;
    const unpaid = await holdAndBook(app, customer, hotel, [0, 1]);
    await request(app)
      .post(`${base}/${unpaid.booking.reference}/check-in`)
      .set(bearer(owner.accessToken))
      .expect(404); // unpaid holds are not visible
    const { booking } = await holdAndBook(app, customer, hotel, [3, 4]);
    await payInFull(app, customer, booking.reference);
    await request(app)
      .post(`${base}/${booking.reference}/check-in`)
      .set(bearer(owner.accessToken))
      .expect(409); // not yet arrival date
    const other = await registerUser(app, { lastName: 'Kapoor' });
    const { booking: b2 } = await holdAndBook(app, other, hotel, [5, 6]);
    await payInFull(app, other, b2.reference);
    // Guest-name search (the fixture's primary guest is "Meera Iyer").
    const byName = (
      await request(app).get(`${base}?view=all&q=iyer`).set(bearer(owner.accessToken)).expect(200)
    ).body.data.items;
    expect(byName.map((b: { reference: string }) => b.reference).sort()).toEqual(
      [booking.reference, b2.reference].sort(),
    );
    expect(
      (
        await request(app)
          .get(`${base}?view=all&q=nobody`)
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(0);
    const byDate = (
      await request(app)
        .get(`${base}?view=all&from=${b2.checkIn}&to=${b2.checkIn}`)
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data.items;
    expect(byDate.map((b: { reference: string }) => b.reference)).toEqual([b2.reference]);
    const byRef = (
      await request(app)
        .get(`${base}?view=all&q=${booking.reference}`)
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data.items;
    expect(byRef).toHaveLength(1);
    const byStatus = (
      await request(app)
        .get(`${base}?view=all&status=CANCELLED`)
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data.items;
    expect(byStatus).toHaveLength(0);
  });
});
