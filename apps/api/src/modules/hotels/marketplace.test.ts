import request from 'supertest';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { MediaAssetModel } from '@/modules/media/media-asset.model';
import { referencedMediaIds } from '@/jobs/maintenance.jobs';
import { bearer, createTestContext, registerUser } from '@/test/helpers';
import {
  createAdmin,
  createApprovedPartner,
  createPublishedHotel,
  daysFromToday,
  hotelContent,
  ratePlanInput,
  roomTypeInput,
  testImage,
} from '@/test/marketplace-fixtures';
import { RoomTypeModel } from '@/modules/rooms/room.models';
import { withTransaction } from '@/lib/transaction';

const searchUrl = (params: Record<string, string | number>) =>
  `/api/v1/hotels?${new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString()}`;

describe('property listings', () => {
  it('requires an approved partner and enforces ownership', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const customer = await registerUser(app);
    await request(app)
      .post('/api/v1/partner/hotels')
      .set(bearer(customer.accessToken))
      .send(hotelContent())
      .expect(403);

    const owner = await createApprovedPartner(app, admin);
    const rival = await createApprovedPartner(app, admin);
    const created = await request(app)
      .post('/api/v1/partner/hotels')
      .set(bearer(owner.accessToken))
      .send(hotelContent())
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({
      publicationStatus: 'DRAFT',
      slug: 'lakeview-haveli-udaipur',
    });
    expect(created.body.data.working.location).toEqual({ lat: 24.576, lng: 73.682 });

    // Same role, different owner: indistinguishable from a missing listing.
    await request(app)
      .get(`/api/v1/partner/hotels/${id}`)
      .set(bearer(rival.accessToken))
      .expect(404);
    await request(app)
      .patch(`/api/v1/partner/hotels/${id}`)
      .set(bearer(rival.accessToken))
      .send({ name: 'Hijacked' })
      .expect(404);
    await request(app)
      .post(`/api/v1/partner/hotels/${id}/room-types`)
      .set(bearer(rival.accessToken))
      .send(roomTypeInput())
      .expect(404);
    expect(
      (await request(app).get('/api/v1/partner/hotels').set(bearer(rival.accessToken))).body.data,
    ).toHaveLength(0);
  });

  it('validates coordinates, content and completeness before submission', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const auth = bearer(owner.accessToken);
    const bad = await request(app)
      .post('/api/v1/partner/hotels')
      .set(auth)
      .send(hotelContent({ location: { lat: 95, lng: 200 } }))
      .expect(422);
    expect(Object.keys(bad.body.error.details.fieldErrors)).toEqual(
      expect.arrayContaining(['location.lat', 'location.lng']),
    );
    const { body } = await request(app)
      .post('/api/v1/partner/hotels')
      .set(auth)
      .send(hotelContent())
      .expect(201);
    const incomplete = await request(app)
      .post(`/api/v1/partner/hotels/${body.data.id}/submit`)
      .set(auth)
      .expect(422);
    expect(incomplete.body.error.details.formErrors).toEqual(
      expect.arrayContaining([
        'Missing: At least one photo',
        'Missing: An active room category with rooms',
      ]),
    );
  });

  it('runs the publication workflow and only exposes published listings publicly', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const auth = bearer(owner.accessToken);
    const { body } = await request(app)
      .post('/api/v1/partner/hotels')
      .set(auth)
      .send(hotelContent())
      .expect(201);
    const id = body.data.id;
    const image = await request(app)
      .post(`/api/v1/partner/hotels/${id}/media`)
      .set(auth)
      .attach('file', await testImage(), { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(image.body.data.variants.avif).toMatch(/\.avif$/);
    expect(image.body.data).toMatchObject({ width: 800, height: 600 });
    await request(app)
      .patch(`/api/v1/partner/hotels/${id}`)
      .set(auth)
      .send({
        images: [{ mediaId: image.body.data.id, alt: 'Front' }],
        coverImageId: image.body.data.id,
      })
      .expect(200);
    const room = await request(app)
      .post(`/api/v1/partner/hotels/${id}/room-types`)
      .set(auth)
      .send(roomTypeInput())
      .expect(201);
    await request(app)
      .post(`/api/v1/partner/hotels/${id}/rate-plans`)
      .set(auth)
      .send(ratePlanInput(room.body.data.id))
      .expect(201);

    await request(app).post(`/api/v1/partner/hotels/${id}/submit`).set(auth).expect(200);
    await request(app)
      .patch(`/api/v1/partner/hotels/${id}`)
      .set(auth)
      .send({ name: 'Locked' })
      .expect(409);
    await request(app)
      .post(`/api/v1/admin/hotels/${id}/decision`)
      .set(auth)
      .send({ decision: 'APPROVE' })
      .expect(403); // owner is not a moderator
    await request(app)
      .post(`/api/v1/admin/hotels/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'START_REVIEW' })
      .expect(200);
    expect((await request(app).get(`/api/v1/hotels/${body.data.slug}`)).status).toBe(404);
    await request(app)
      .post(`/api/v1/admin/hotels/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(
      (await request(app).get(searchUrl({ destination: 'Udaipur' }))).body.data.pagination.total,
    ).toBe(0); // approved ≠ published
    await request(app).post(`/api/v1/partner/hotels/${id}/publish`).set(auth).expect(200);

    const results = await request(app)
      .get(searchUrl({ destination: 'Udaipur' }))
      .expect(200);
    expect(results.body.data.items.map((h: { id: string }) => h.id)).toEqual([id]);
    const detail = await request(app).get(`/api/v1/hotels/${body.data.slug}`).expect(200);
    expect(detail.body.data.roomTypes[0].ratePlans[0].name).toBe('Flexible');
    expect(JSON.stringify(detail.body)).not.toMatch(/basePriceMinor|partnerId|revision/);

    // Editing a published listing creates a revision; the live listing is untouched until approved.
    const edited = await request(app)
      .patch(`/api/v1/partner/hotels/${id}`)
      .set(auth)
      .send({ name: 'Lakeview Palace' })
      .expect(200);
    expect(edited.body.data.working.amenities).toEqual(['wifi', 'pool', 'breakfast']); // untouched by a partial update
    expect(edited.body.data.revision).toMatchObject({ status: 'DRAFT', changedFields: ['name'] });
    expect(edited.body.data.live.name).toBe('Lakeview Haveli');
    await request(app).post(`/api/v1/partner/hotels/${id}/submit`).set(auth).expect(200);
    expect((await request(app).get(`/api/v1/hotels/${id}`)).body.data.name).toBe('Lakeview Haveli');
    await request(app)
      .post(`/api/v1/admin/hotels/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'APPROVE_REVISION' })
      .expect(200);
    expect((await request(app).get(`/api/v1/hotels/${id}`)).body.data.name).toBe('Lakeview Palace');

    // Suspension removes it from search; archive is owner-only and blocked while suspended.
    await request(app)
      .post(`/api/v1/admin/hotels/${id}/decision`)
      .set(bearer(admin.accessToken))
      .send({ decision: 'SUSPEND', reason: 'Guest safety complaint' })
      .expect(200);
    expect(
      (await request(app).get(searchUrl({ destination: 'Udaipur' }))).body.data.pagination.total,
    ).toBe(0);
    await request(app).post(`/api/v1/partner/hotels/${id}/archive`).set(auth).expect(409);
  });

  it('protects media: content checks, ownership, references and orphan cleanup', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const rival = await createApprovedPartner(app, admin);
    const { hotelId } = await createPublishedHotel(app, owner, admin);
    const rivalHotel = await request(app)
      .post('/api/v1/partner/hotels')
      .set(bearer(rival.accessToken))
      .send(hotelContent({ name: 'Rival Inn' }))
      .expect(201);

    await request(app)
      .post(`/api/v1/partner/hotels/${hotelId}/media`)
      .set(bearer(owner.accessToken))
      .attach('file', Buffer.from('<svg onload=alert(1)>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(415);
    const rivalImage = await request(app)
      .post(`/api/v1/partner/hotels/${rivalHotel.body.data.id}/media`)
      .set(bearer(rival.accessToken))
      .attach('file', await testImage(), { filename: 'r.png', contentType: 'image/png' })
      .expect(201);
    // Cannot attach or delete another partner's files.
    await request(app)
      .patch(`/api/v1/partner/hotels/${hotelId}`)
      .set(bearer(owner.accessToken))
      .send({ images: [{ mediaId: rivalImage.body.data.id }] })
      .expect(400);
    await request(app)
      .delete(`/api/v1/partner/hotels/${hotelId}/media/${rivalImage.body.data.id}`)
      .set(bearer(owner.accessToken))
      .expect(404);

    const live = await request(app)
      .get(`/api/v1/partner/hotels/${hotelId}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await request(app)
      .delete(`/api/v1/partner/hotels/${hotelId}/media/${live.body.data.images[0].id}`)
      .set(bearer(owner.accessToken))
      .expect(409);

    // Orphan cleanup removes the unattached upload but never a referenced one.
    await MediaAssetModel.collection.updateMany(
      {},
      { $set: { createdAt: new Date(Date.now() - 48 * 3600_000) } },
    );
    const { container } = createTestContext();
    const removed = await container.services.media.cleanupOrphans(
      new Date(Date.now() - 24 * 3600_000),
      referencedMediaIds,
    );
    expect(removed).toBe(1);
    expect((await MediaAssetModel.findById(rivalImage.body.data.id).lean())?.status).toBe(
      'DELETED',
    );
    expect((await MediaAssetModel.findById(live.body.data.images[0].id).lean())?.status).toBe(
      'ATTACHED',
    );
  });
});

describe('rooms and inventory', () => {
  it('validates room categories', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const { body } = await request(app)
      .post('/api/v1/partner/hotels')
      .set(bearer(owner.accessToken))
      .send(hotelContent())
      .expect(201);
    const url = `/api/v1/partner/hotels/${body.data.id}/room-types`;
    const res = await request(app)
      .post(url)
      .set(bearer(owner.accessToken))
      .send(roomTypeInput({ maximumOccupancy: 9, totalInventory: -1 }))
      .expect(422);
    expect(Object.keys(res.body.error.details.fieldErrors)).toEqual(
      expect.arrayContaining(['maximumOccupancy', 'totalInventory']),
    );
    await request(app)
      .post(url)
      .set(bearer(owner.accessToken))
      .send(roomTypeInput({ maximumAdults: 0 }))
      .expect(422);
  });

  it('blocks and unblocks atomically and never below committed rooms', async () => {
    const { app, container } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const hotel = await createPublishedHotel(app, owner, admin);
    const url = `/api/v1/partner/hotels/${hotel.hotelId}/inventory`;
    const from = daysFromToday(10);
    const to = daysFromToday(12);

    const blocked = await request(app)
      .patch(url)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from,
        to,
        set: { blockedRooms: 2, closedToArrival: true },
      })
      .expect(200);
    expect(blocked.body.data.map((d: { available: number }) => d.available)).toEqual([3, 3, 3]);

    // Hold 3 rooms on the middle night with the reservation primitives (as checkout does).
    const roomType = (await RoomTypeModel.findById(hotel.roomTypeId).lean())!;
    const middle = [daysFromToday(11)];
    const inv = container.services.inventory;
    await withTransaction((s) => inv.reserveHeld(roomType, middle, 3, s));
    await expect(
      withTransaction((s) => inv.reserveHeld(roomType, middle, 1, s)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'INVENTORY_UNAVAILABLE' });

    // Blocking 3 on a night where 3 are held would overcommit: rejected with the conflicting date.
    const conflict = await request(app)
      .patch(url)
      .set(bearer(owner.accessToken))
      .send({ roomTypeId: hotel.roomTypeId, from, to, set: { blockedRooms: 3 } })
      .expect(409);
    expect(conflict.body.error.details.dates).toEqual([daysFromToday(11)]);
    const unchanged = await request(app)
      .get(`${url}?roomTypeId=${hotel.roomTypeId}&from=${from}&to=${to}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(unchanged.body.data.map((d: { blockedRooms: number }) => d.blockedRooms)).toEqual([
      2, 2, 2,
    ]); // all-or-nothing

    // Reducing the room count below commitments is refused.
    await request(app)
      .put(`/api/v1/partner/hotels/${hotel.hotelId}/room-types/${hotel.roomTypeId}`)
      .set(bearer(owner.accessToken))
      .send(roomTypeInput({ totalInventory: 4 }))
      .expect(409);

    // Held → booked; counters can never go negative (a second commit of the same rooms is rejected).
    await withTransaction((s) => inv.commitHeld(roomType._id, middle, 3, s));
    await expect(
      withTransaction((s) => inv.commitHeld(roomType._id, middle, 3, s)),
    ).rejects.toMatchObject({ statusCode: 409 });
    const day = await DailyInventoryModel.findOne({
      roomTypeId: hotel.roomTypeId,
      localDate: daysFromToday(11),
    }).lean();
    expect(day).toMatchObject({ heldRooms: 0, bookedRooms: 3, blockedRooms: 2, totalRooms: 5 });
    // Booked rooms make the category archive instead of delete.
    expect(
      (
        await request(app)
          .delete(`/api/v1/partner/hotels/${hotel.hotelId}/room-types/${hotel.roomTypeId}`)
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data.archived,
    ).toBe(true);
  });

  it('never oversells under concurrent holds (all nights or none)', async () => {
    const { app, container } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const hotel = await createPublishedHotel(app, owner, admin); // 5 rooms
    const roomType = (await RoomTypeModel.findById(hotel.roomTypeId).lean())!;
    const checkIn = daysFromToday(20);
    const checkOut = daysFromToday(23);
    const nightsToHold = [daysFromToday(20), daysFromToday(21), daysFromToday(22)];
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        withTransaction((s) =>
          container.services.inventory.reserveHeld(roomType, nightsToHold, 1, s),
        ),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(5);
    for (const failure of attempts.filter(
      (a): a is PromiseRejectedResult => a.status === 'rejected',
    ))
      expect(failure.reason).toMatchObject({ statusCode: 409 });
    const nights = await DailyInventoryModel.find({
      roomTypeId: hotel.roomTypeId,
      localDate: { $gte: checkIn, $lt: checkOut },
    }).lean();
    expect(nights.map((n) => n.heldRooms)).toEqual([5, 5, 5]); // every night held equally: no partial holds
  });

  it('enforces the availability invariant in the database itself', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const hotel = await createPublishedHotel(app, owner, admin);
    await request(app)
      .patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(5),
        to: daysFromToday(5),
        set: { blockedRooms: 1 },
      })
      .expect(200);
    await expect(
      DailyInventoryModel.collection.updateOne(
        { roomTypeId: new Types.ObjectId(hotel.roomTypeId), localDate: daysFromToday(5) },
        { $set: { bookedRooms: 10 } },
      ),
    ).rejects.toThrow(/validation/i);
  });
});

describe('pricing quotes', () => {
  it('returns a complete, signed, revalidatable quote', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const hotel = await createPublishedHotel(app, owner, admin);
    await request(app)
      .post(`/api/v1/partner/hotels/${hotel.hotelId}/pricing-rules`)
      .set(bearer(owner.accessToken))
      .send({
        name: 'Long stay',
        ruleType: 'LONG_STAY',
        adjustmentType: 'PERCENT',
        adjustmentValue: -1000,
        conditions: { minNights: 3 },
      })
      .expect(201);

    const body = {
      hotelId: hotel.hotelId,
      roomTypeId: hotel.roomTypeId,
      ratePlanId: hotel.ratePlanId,
      checkIn: daysFromToday(40),
      checkOut: daysFromToday(43),
      adults: 3,
      children: 0,
      childrenAges: [],
      rooms: 1,
    };
    const quote = await request(app).post('/api/v1/availability/quote').send(body).expect(200);
    const q = quote.body.data;
    // (₹5,000 + ₹1,000 extra adult) × 3 nights = ₹18,000, −10% long stay = ₹16,200, GST 5% = ₹810
    expect(q.nights).toBe(3);
    expect(q.totals).toEqual({
      roomChargesMinor: 1_800_000,
      discountsMinor: -180_000,
      subtotalMinor: 1_620_000,
      taxesMinor: 81_000,
      feesMinor: 0,
      totalMinor: 1_701_000,
    });
    expect(q.nightly[0].discounts[0]).toEqual({ label: 'Long stay', amountMinor: -60_000 });
    expect(Date.parse(q.expiresAt)).toBeGreaterThan(Date.now());

    const valid = await request(app)
      .post('/api/v1/availability/quote/revalidate')
      .send({ quoteToken: q.quoteToken })
      .expect(200);
    expect(valid.body.data).toMatchObject({ valid: true, priceChanged: false });

    await request(app)
      .put(`/api/v1/partner/hotels/${hotel.hotelId}/rate-plans/${hotel.ratePlanId}`)
      .set(bearer(owner.accessToken))
      .send(
        ratePlanInput(hotel.roomTypeId, {
          basePriceMinor: 550_000,
          additionalAdultPriceMinor: 100_000,
        }),
      )
      .expect(200);
    const changed = await request(app)
      .post('/api/v1/availability/quote/revalidate')
      .send({ quoteToken: q.quoteToken })
      .expect(200);
    expect(changed.body.data).toMatchObject({ valid: false, priceChanged: true });

    const tampered = `${q.quoteToken.split('.')[0]}x.${q.quoteToken.split('.')[1]}`;
    expect(
      (
        await request(app)
          .post('/api/v1/availability/quote/revalidate')
          .send({ quoteToken: tampered })
      ).body.data.valid,
    ).toBe(false);
  });

  it('refuses unavailable, oversized and past stays', async () => {
    const { app } = createTestContext();
    const admin = await createAdmin(app);
    const owner = await createApprovedPartner(app, admin);
    const hotel = await createPublishedHotel(app, owner, admin);
    const base = {
      hotelId: hotel.hotelId,
      roomTypeId: hotel.roomTypeId,
      ratePlanId: hotel.ratePlanId,
      checkIn: daysFromToday(20),
      checkOut: daysFromToday(22),
      adults: 2,
      children: 0,
      childrenAges: [],
      rooms: 1,
    };
    expect(
      (
        await request(app)
          .post('/api/v1/availability/quote')
          .send({ ...base, adults: 4 })
          .expect(409)
      ).body.error.message,
    ).toMatch(/does not fit/);
    expect(
      (
        await request(app)
          .post('/api/v1/availability/quote')
          .send({ ...base, rooms: 6, adults: 6 })
          .expect(409)
      ).body.error.message,
    ).toMatch(/left|Sold out/);
    await request(app)
      .post('/api/v1/availability/quote')
      .send({ ...base, checkIn: daysFromToday(-3), checkOut: daysFromToday(-1) })
      .expect(409);
    await request(app)
      .post('/api/v1/availability/quote')
      .send({ ...base, childrenAges: [5] })
      .expect(422);
  });
});

describe('public search', () => {
  async function seedThree() {
    const ctx = createTestContext();
    const admin = await createAdmin(ctx.app);
    const owner = await createApprovedPartner(ctx.app, admin);
    const cheap = await createPublishedHotel(ctx.app, owner, admin, {
      content: {
        name: 'Budget Nest',
        propertyType: 'HOSTEL',
        starCategory: 2,
        amenities: ['wifi'],
        location: { lat: 24.58, lng: 73.69 },
      },
      rate: { basePriceMinor: 200_000, mealPlan: 'ROOM_ONLY' },
    });
    const mid = await createPublishedHotel(ctx.app, owner, admin, {
      content: {
        name: 'Lake Courtyard',
        amenities: ['wifi', 'pool'],
        location: { lat: 24.57, lng: 73.68 },
      },
    });
    const goa = await createPublishedHotel(ctx.app, owner, admin, {
      content: {
        name: 'Palm Cove',
        city: 'Goa',
        state: 'Goa',
        propertyType: 'RESORT',
        starCategory: 5,
        amenities: ['pool', 'parking'],
        location: { lat: 15.29, lng: 74.12 },
      },
      rate: { basePriceMinor: 900_000 },
    });
    return { ...ctx, owner, cheap, mid, goa };
  }

  it('filters by destination, type, stars and amenities, and paginates stably', async () => {
    const { app, cheap, mid, goa } = await seedThree();
    const ids = (res: request.Response) => res.body.data.items.map((h: { id: string }) => h.id);
    expect(ids(await request(app).get(searchUrl({ destination: 'udaipur' })))).toHaveLength(2);
    expect(ids(await request(app).get(searchUrl({ propertyTypes: 'RESORT' })))).toEqual([
      goa.hotelId,
    ]);
    expect(ids(await request(app).get(searchUrl({ stars: '2' })))).toEqual([cheap.hotelId]);
    expect(new Set(ids(await request(app).get(searchUrl({ pool: 'true' }))))).toEqual(
      new Set([mid.hotelId, goa.hotelId]),
    );
    expect(ids(await request(app).get(searchUrl({ amenities: 'pool,parking' })))).toEqual([
      goa.hotelId,
    ]);

    const page1 = await request(app).get(searchUrl({ limit: 2, page: 1, sort: 'popularity' }));
    const page2 = await request(app).get(searchUrl({ limit: 2, page: 2, sort: 'popularity' }));
    expect(page1.body.data.pagination).toMatchObject({ total: 3, totalPages: 2 });
    expect(new Set([...ids(page1), ...ids(page2)]).size).toBe(3);
  });

  it('prices date searches with real quotes, sorts by price and excludes unavailable hotels', async () => {
    const { app, owner, cheap, mid } = await seedThree();
    const stay = {
      destination: 'Udaipur',
      checkIn: daysFromToday(30),
      checkOut: daysFromToday(32),
      adults: 2,
      rooms: 1,
    };
    const asc = await request(app)
      .get(searchUrl({ ...stay, sort: 'price_asc' }))
      .expect(200);
    expect(asc.body.data.availabilityChecked).toBe(true);
    expect(asc.body.data.items.map((h: { id: string }) => h.id)).toEqual([
      cheap.hotelId,
      mid.hotelId,
    ]);
    // ₹2,000 × 2 nights + 5% GST = ₹4,200
    expect(asc.body.data.items[0].price).toMatchObject({
      totalMinor: 420_000,
      nightlyAverageMinor: 210_000,
      nights: 2,
      taxesIncluded: true,
    });
    const desc = await request(app).get(searchUrl({ ...stay, sort: 'price_desc' }));
    expect(desc.body.data.items[0].id).toBe(mid.hotelId);

    // Breakfast filter uses the rate plan's meal plan; price filter uses the nightly average.
    expect(
      (await request(app).get(searchUrl({ ...stay, breakfast: 'true' }))).body.data.items.map(
        (h: { id: string }) => h.id,
      ),
    ).toEqual([mid.hotelId]);
    expect(
      (await request(app).get(searchUrl({ ...stay, maxPrice: 300_000 }))).body.data.items.map(
        (h: { id: string }) => h.id,
      ),
    ).toEqual([cheap.hotelId]);

    // Block every room of the cheap hotel for one night: it must disappear for that stay.
    await request(app)
      .patch(`/api/v1/partner/hotels/${cheap.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: cheap.roomTypeId,
        from: daysFromToday(31),
        to: daysFromToday(31),
        set: { blockedRooms: 5 },
      })
      .expect(200);
    const after = await request(app).get(searchUrl({ ...stay, sort: 'price_asc' }));
    expect(after.body.data.items.map((h: { id: string }) => h.id)).toEqual([mid.hotelId]);
    // Room-quantity requirement: 6 rooms exceed every hotel's 5.
    expect(
      (await request(app).get(searchUrl({ ...stay, rooms: 6, adults: 6 }))).body.data.pagination
        .total,
    ).toBe(0);
  });

  it('supports geospatial bounding boxes, nearby and distance sorting', async () => {
    const { app, cheap, mid, goa } = await seedThree();
    const inUdaipur = await request(app)
      .get(searchUrl({ bbox: '73.5,24.4,73.9,24.8' }))
      .expect(200);
    expect(new Set(inUdaipur.body.data.items.map((h: { id: string }) => h.id))).toEqual(
      new Set([cheap.hotelId, mid.hotelId]),
    );
    await request(app)
      .get(searchUrl({ bbox: '73.9,24.4,73.5,24.8' }))
      .expect(422);
    await request(app)
      .get(searchUrl({ bbox: '200,0,201,1' }))
      .expect(422);

    const byDistance = await request(app)
      .get(searchUrl({ lat: 24.57, lng: 73.68, radiusKm: 500, sort: 'distance' }))
      .expect(200);
    // Goa (~800 km away) is outside the 500 km radius.
    expect(byDistance.body.data.items.map((h: { id: string }) => h.id)).toEqual([
      mid.hotelId,
      cheap.hotelId,
    ]);
    await request(app)
      .get(searchUrl({ lat: 24.57, lng: 73.68, radiusKm: 2000 }))
      .expect(422);
    expect(goa.hotelId).toBeTruthy();
    expect(byDistance.body.data.items[0].distanceKm).toBe(0);

    const nearby = await request(app)
      .get(`/api/v1/hotels/nearby?lat=24.57&lng=73.68&radiusKm=10&excludeId=${mid.hotelId}`)
      .expect(200);
    expect(nearby.body.data.map((h: { id: string }) => h.id)).toEqual([cheap.hotelId]);
  });

  it('validates search input', async () => {
    const { app } = createTestContext();
    await request(app)
      .get(searchUrl({ sort: 'price_asc' }))
      .expect(422);
    await request(app)
      .get(searchUrl({ checkIn: daysFromToday(5) }))
      .expect(422);
    await request(app)
      .get(searchUrl({ checkIn: daysFromToday(5), checkOut: daysFromToday(4) }))
      .expect(422);
    await request(app)
      .get(searchUrl({ children: 2, childrenAges: '4' }))
      .expect(422);
    await request(app)
      .get(searchUrl({ checkIn: daysFromToday(1), checkOut: daysFromToday(40) }))
      .expect(422);
  });

  it('returns room offers, comparison data, featured lists, suggestions and wishlist', async () => {
    const { app, mid, cheap } = await seedThree();
    const offers = await request(app)
      .get(
        `/api/v1/hotels/${mid.slug}/offers?checkIn=${daysFromToday(15)}&checkOut=${daysFromToday(16)}&adults=2&rooms=1`,
      )
      .expect(200);
    expect(offers.body.data[0].offers[0].totals.totalMinor).toBe(525_000);
    const compare = await request(app)
      .get(
        `/api/v1/hotels/compare?ids=${mid.hotelId},${cheap.hotelId}&checkIn=${daysFromToday(15)}&checkOut=${daysFromToday(16)}`,
      )
      .expect(200);
    expect(
      compare.body.data.map((h: { name: string; breakfastAvailable: boolean }) => [
        h.name,
        h.breakfastAvailable,
      ]),
    ).toEqual([
      ['Lake Courtyard', true],
      ['Budget Nest', false],
    ]);
    expect((await request(app).get('/api/v1/hotels/featured')).body.data.length).toBe(3);
    await request(app)
      .get(`/api/v1/hotels/compare?ids=${[1, 2, 3, 4, 5].map(() => mid.hotelId).join(',')}`)
      .expect(422);

    const customer = await registerUser(app);
    await request(app).put(`/api/v1/wishlist/${mid.hotelId}`).expect(401);
    await request(app)
      .put(`/api/v1/wishlist/${mid.hotelId}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    await request(app)
      .put(`/api/v1/wishlist/${mid.hotelId}`)
      .set(bearer(customer.accessToken))
      .expect(200);
    expect(
      (await request(app).get('/api/v1/wishlist').set(bearer(customer.accessToken))).body.data.map(
        (h: { id: string }) => h.id,
      ),
    ).toEqual([mid.hotelId]);
  });
});
