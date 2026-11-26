import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { bearer, registerUser } from '@/test/helpers';
import { createPublishedHotel, daysFromToday, hotelContent, ratePlanInput, today } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';
import { PriceObservationModel } from './intelligence.service';

describe('recommendations', () => {
  it('personalises only with consent, explains every pick and can be switched off', async () => {
    const { app, customer, hotel, owner, admin } = await bookingWorld();
    const sameCity = await createPublishedHotel(app, owner, admin, { content: hotelContent({ name: 'Lake Pavilion', city: 'Udaipur' }) });
    const elsewhere = await createPublishedHotel(app, owner, admin, { content: hotelContent({ name: 'Hill Lodge', city: 'Shimla', propertyType: 'HOMESTAY' }) });
    const { booking } = await holdAndBook(app, customer, hotel, [-0, 1]);
    await payInFull(app, customer, booking.reference);

    const off = (await request(app).get('/api/v1/recommendations').set(bearer(customer.accessToken)).expect(200)).body.data;
    expect(off.personalized).toBe(false);
    expect(off.items.every((i: { reasons: string[] }) => i.reasons.join() === 'Popular on Stayscape')).toBe(true);

    const prefs = (await request(app).patch('/api/v1/users/preferences').set(bearer(customer.accessToken)).send({ personalization: { recommendations: true } }).expect(200)).body.data;
    expect(prefs.preferences.personalization).toMatchObject({ recommendations: true, consentedAt: expect.any(String) });
    const on = (await request(app).get('/api/v1/recommendations').set(bearer(customer.accessToken)).expect(200)).body.data;
    expect(on.personalized).toBe(true);
    const ids = on.items.map((i: { hotel: { id: string } }) => i.hotel.id);
    expect(ids[0]).toBe(sameCity.hotelId);
    expect(ids).not.toContain(hotel.hotelId); // stayed there recently
    expect(on.items[0].reasons[0]).toMatch(/Udaipur/);
    // Deterministic: the same inputs give the same order.
    expect((await request(app).get('/api/v1/recommendations').set(bearer(customer.accessToken)).expect(200)).body.data.items.map((i: { hotel: { id: string } }) => i.hotel.id)).toEqual(ids);
    expect(elsewhere).toBeTruthy();

    await request(app).patch('/api/v1/users/preferences').set(bearer(customer.accessToken)).send({ personalization: { recommendations: false } }).expect(200);
    expect((await request(app).get('/api/v1/recommendations').set(bearer(customer.accessToken)).expect(200)).body.data.personalized).toBe(false);
    await request(app).get('/api/v1/recommendations').expect(401);
  });
});

describe('price intelligence', () => {
  it('prices flexible dates from the real engine and records history once per day', async () => {
    const { app, owner, hotel, container } = await bookingWorld();
    await request(app).patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`).set(bearer(owner.accessToken)).send({ roomTypeId: hotel.roomTypeId, from: daysFromToday(11), to: daysFromToday(11), set: { stopSell: true } }).expect(200);
    const cal = (await request(app).get(`/api/v1/price-intelligence/${hotel.slug}/calendar?from=${daysFromToday(10)}&to=${daysFromToday(12)}&nights=1`).expect(200)).body.data;
    expect(cal.map((d: { available: boolean }) => d.available)).toEqual([true, false, true]);
    expect(cal[0]).toMatchObject({ lowestTotalMinor: 525_000, nightlyAverageMinor: 525_000, currency: 'INR' });
    await request(app).get(`/api/v1/price-intelligence/${hotel.slug}/calendar?from=${daysFromToday(0)}&to=${daysFromToday(60)}`).expect(422);

    expect(await container.services.intelligence.observePrices(3)).toBe(3);
    expect(await container.services.intelligence.observePrices(3)).toBe(0); // idempotent per day
    const history = (await request(app).get(`/api/v1/price-intelligence/${hotel.slug}/history?stayDate=${daysFromToday(1)}`).expect(200)).body.data;
    expect(history).toEqual([{ observedOn: today(), lowestNightlyMinor: 525_000 }]);
  });

  it('alerts once per new low, de-duplicates watches and expires past stays', async () => {
    const { app, owner, hotel, customer, container } = await bookingWorld();
    const body = { hotelId: hotel.hotelId, checkIn: daysFromToday(20), checkOut: daysFromToday(22) };
    const alert = (await request(app).post('/api/v1/price-alerts').set(bearer(customer.accessToken)).send(body).expect(201)).body.data;
    expect(alert).toMatchObject({ baselineTotalMinor: 1_050_000, active: true });
    const again = (await request(app).post('/api/v1/price-alerts').set(bearer(customer.accessToken)).send(body).expect(201)).body.data;
    expect(again.id).toBe(alert.id);

    const svc = container.services.intelligence;
    expect(await svc.checkAlerts()).toMatchObject({ checked: 1, notified: 0 });
    await request(app).put(`/api/v1/partner/hotels/${hotel.hotelId}/rate-plans/${hotel.ratePlanId}`).set(bearer(owner.accessToken)).send(ratePlanInput(hotel.roomTypeId, { basePriceMinor: 400_000 })).expect(200);
    expect(await svc.checkAlerts()).toMatchObject({ notified: 1 });
    expect(await svc.checkAlerts()).toMatchObject({ notified: 0 }); // same low: no repeat
    const notes = await NotificationModel.find({ type: 'PRICE_ALERT' }).lean();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toMatch(/₹8,400.00 total/); // 840,000 paise
    const listed = (await request(app).get('/api/v1/price-alerts').set(bearer(customer.accessToken)).expect(200)).body.data;
    expect(listed[0]).toMatchObject({ lastNotifiedTotalMinor: 840_000 });

    const other = await registerUser(app);
    await request(app).delete(`/api/v1/price-alerts/${alert.id}`).set(bearer(other.accessToken)).expect(404);
    await request(app).delete(`/api/v1/price-alerts/${alert.id}`).set(bearer(customer.accessToken)).expect(200);
    await request(app).post('/api/v1/price-alerts').set(bearer(customer.accessToken)).send({ ...body, checkIn: daysFromToday(-1), checkOut: daysFromToday(1) }).expect(422);
  });

  it('only calls something a deal against real observed history', async () => {
    const { app, hotel } = await bookingWorld();
    expect((await request(app).get('/api/v1/deals/last-minute').expect(200)).body.data).toHaveLength(0);
    // A week of observed prices around ₹8,000 makes today's ₹5,000 a genuine 37.5 % saving.
    await PriceObservationModel.insertMany(Array.from({ length: 7 }, (_, i) => ({ hotelId: hotel.hotelId, stayDate: daysFromToday(30 + i), observedOn: daysFromToday(-1 - i), lowestNightlyMinor: 800_000 + (i % 2) * 10_000, currency: 'INR' })));
    const deals = (await request(app).get('/api/v1/deals/last-minute?city=udaipur').expect(200)).body.data;
    expect(deals).toEqual([expect.objectContaining({ checkIn: daysFromToday(0), nightlyMinor: 525_000, typicalNightlyMinor: 800_000, savingBp: 3_438, observations: 7 })]);
  });
});
