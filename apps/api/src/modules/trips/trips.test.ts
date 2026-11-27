import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, registerUser } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';

describe('TripSpace', () => {
  it('shares a plan with invited collaborators without exposing private data', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const friend = await registerUser(app, { firstName: 'Kabir', lastName: 'Shah' });
    const stranger = await registerUser(app);
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);

    const trip = (await request(app).post('/api/v1/trips').set(bearer(customer.accessToken)).send({ title: 'Udaipur long weekend', destination: 'Udaipur', startDate: daysFromToday(10), endDate: daysFromToday(12) }).expect(201)).body.data;
    await request(app).post('/api/v1/trips').set(bearer(customer.accessToken)).send({ title: 'Bad', startDate: daysFromToday(5), endDate: daysFromToday(4) }).expect(422);
    await request(app).post(`/api/v1/trips/${trip.id}/items`).set(bearer(customer.accessToken)).send({ kind: 'BOOKING', bookingReference: booking.reference }).expect(201);
    await request(app).post(`/api/v1/trips/${trip.id}/items`).set(bearer(customer.accessToken)).send({ kind: 'NOTE', title: 'Boat ride', note: 'Lake Pichola at sunset', date: daysFromToday(11) }).expect(201);

    // Non-members cannot see it, even to learn it exists.
    await request(app).get(`/api/v1/trips/${trip.id}`).set(bearer(stranger.accessToken)).expect(404);

    // Invitations are bound to the invited email address.
    const { token } = (await request(app).post(`/api/v1/trips/${trip.id}/invitations`).set(bearer(customer.accessToken)).send({ email: friend.email, role: 'EDITOR' }).expect(201)).body.data;
    await request(app).post('/api/v1/trips/invitations/accept').set(bearer(stranger.accessToken)).send({ token }).expect(403);
    const joined = (await request(app).post('/api/v1/trips/invitations/accept').set(bearer(friend.accessToken)).send({ token }).expect(200)).body.data;
    expect(joined.myRole).toBe('EDITOR');
    await request(app).post('/api/v1/trips/invitations/accept').set(bearer(friend.accessToken)).send({ token }).expect(404); // single use

    const seen = JSON.stringify(joined);
    expect(seen).not.toContain(customer.email);
    expect(seen).not.toMatch(/totalMinor|priceSnapshot|Meera|guestDetails/);
    expect(joined.items.find((i: { kind: string }) => i.kind === 'BOOKING').booking).toEqual({ reference: booking.reference, checkIn: daysFromToday(10), checkOut: daysFromToday(12), status: 'CONFIRMED' });
    expect(joined.members.map((m: { name: string; role: string }) => [m.name, m.role])).toContainEqual(['Kabir S.', 'EDITOR']);

    // Editors add items but cannot attach someone else's booking or manage people.
    await request(app).post(`/api/v1/trips/${trip.id}/items`).set(bearer(friend.accessToken)).send({ kind: 'HOTEL', hotelId: hotel.hotelId }).expect(201);
    await request(app).post(`/api/v1/trips/${trip.id}/items`).set(bearer(friend.accessToken)).send({ kind: 'BOOKING', bookingReference: booking.reference }).expect(422);
    await request(app).post(`/api/v1/trips/${trip.id}/invitations`).set(bearer(friend.accessToken)).send({ email: stranger.email }).expect(403);
    await request(app).delete(`/api/v1/trips/${trip.id}`).set(bearer(friend.accessToken)).expect(403);

    // Read-only share link: hotels and dates only.
    const share = (await request(app).put(`/api/v1/trips/${trip.id}/sharing`).set(bearer(customer.accessToken)).send({ enabled: true }).expect(200)).body.data;
    const pub = (await request(app).get(`/api/v1/trips/shared/${share.token}`).expect(200)).body.data;
    expect(pub.items.map((i: { kind: string }) => i.kind)).toEqual(['HOTEL']);
    expect(JSON.stringify(pub)).not.toMatch(/Boat ride|SS-|Kabir|members/);
    await request(app).put(`/api/v1/trips/${trip.id}/sharing`).set(bearer(customer.accessToken)).send({ enabled: false }).expect(200);
    await request(app).get(`/api/v1/trips/shared/${share.token}`).expect(404);

    // A collaborator can leave; then they lose access.
    await request(app).delete(`/api/v1/trips/${trip.id}/members/${friend.id}`).set(bearer(friend.accessToken)).expect(200);
    await request(app).get(`/api/v1/trips/${trip.id}`).set(bearer(friend.accessToken)).expect(404);
    expect((await request(app).get('/api/v1/trips').set(bearer(customer.accessToken)).expect(200)).body.data).toHaveLength(1);
  });
});
