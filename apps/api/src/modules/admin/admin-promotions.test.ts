import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, todayInTimeZone } from '@stayscape/shared';
import { PricingRuleModel } from '@/modules/rooms/room.models';
import { bearer, createUserWithRoles } from '@/test/helpers';
import { bookingWorld } from '@/test/booking-fixtures';

describe('admin promotions oversight', () => {
  it('lists partner discounts with property-local state, filters and permission checks', async () => {
    const { app, admin, hotel } = await bookingWorld();
    const today = todayInTimeZone('Asia/Kolkata');
    const base = {
      hotelId: hotel.hotelId,
      adjustmentType: 'PERCENT',
      adjustmentValue: -1500,
      stackingPolicy: 'STACKABLE',
    };
    await PricingRuleModel.create([
      {
        ...base,
        name: 'Monsoon flash sale',
        ruleType: 'PROMOTIONAL',
        conditions: { bookFrom: addDays(today, -1), bookTo: addDays(today, 5) },
      },
      {
        ...base,
        name: 'Diwali preview',
        ruleType: 'PROMOTIONAL',
        conditions: { bookFrom: addDays(today, 10), bookTo: addDays(today, 20) },
      },
      { ...base, name: 'Old early bird', ruleType: 'EARLY_BIRD', endDate: addDays(today, -3) },
      { ...base, name: 'Paused long stay', ruleType: 'LONG_STAY', active: false },
      // Surcharges are not promotions and must not appear.
      { ...base, name: 'Weekend uplift', ruleType: 'WEEKEND', adjustmentValue: 1000 },
    ]);

    const all = (
      await request(app).get('/api/v1/admin/promotions').set(bearer(admin.accessToken)).expect(200)
    ).body.data;
    expect(all.summary).toEqual({ ACTIVE: 1, UPCOMING: 1, ENDED: 1, PAUSED: 1 });
    expect(all.items).toHaveLength(4);
    expect(all.truncated).toBe(false);

    const active = (
      await request(app)
        .get('/api/v1/admin/promotions?state=ACTIVE')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data;
    expect(active.items).toEqual([
      expect.objectContaining({
        name: 'Monsoon flash sale',
        state: 'ACTIVE',
        windowKind: 'BOOKING',
        windowTo: addDays(today, 5),
        adjustmentValue: -1500,
        currency: 'INR',
      }),
    ]);
    expect(active.pagination.total).toBe(1);

    const byType = (
      await request(app)
        .get('/api/v1/admin/promotions?type=EARLY_BIRD')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data.items;
    expect(byType).toEqual([expect.objectContaining({ state: 'ENDED', windowKind: 'STAY' })]);

    const none = (
      await request(app)
        .get('/api/v1/admin/promotions?q=no-such-hotel')
        .set(bearer(admin.accessToken))
        .expect(200)
    ).body.data;
    expect(none.items).toEqual([]);

    await request(app)
      .get('/api/v1/admin/promotions?state=SOMETIME')
      .set(bearer(admin.accessToken))
      .expect(422);
    const support = await createUserWithRoles(app, ['SUPPORT']);
    await request(app).get('/api/v1/admin/promotions').set(bearer(support.accessToken)).expect(403);
    await request(app).get('/api/v1/admin/promotions').expect(401);
  });
});
