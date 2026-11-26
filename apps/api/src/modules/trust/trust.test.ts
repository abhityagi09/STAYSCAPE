import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, registerUser } from '@/test/helpers';
import { createPublishedHotel, hotelContent } from '@/test/marketplace-fixtures';
import { bookingWorld } from '@/test/booking-fixtures';
import { scoreTrust, trustConfidence } from './trust.service';

const facts = {
  reviewCount: 0,
  reviewSumTenths: 0,
  respondedReviews: 0,
  confirmed: 0,
  propertyCancellations: 0,
  complaints: 0,
  completedStays: 0,
  partnerApproved: true,
  listingVerified: true,
  completeness: { photos: 6, descriptionLength: 300, amenities: 6, houseRules: true, accessibility: 2 },
  months: 0,
  now: new Date('2026-11-26T00:00:00Z'),
};

describe('TrustScore formula', () => {
  it('withholds the score without enough evidence', () => {
    const t = scoreTrust(facts);
    expect(t.score).toBeNull();
    expect(t.confidence).toBe('LOW');
    expect(t.components.find((c) => c.key === 'guest_reviews')?.score).toBe(63); // prior 3.5 → (3.5−1)/4
    expect(t.components.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it('weights each component as documented', () => {
    // 30 reviews averaging 4.5 → bayes (135 + 35) / 40 = 4.25 → 81.25; 60 bookings, 3 property cancellations → 95;
    // verified → 100; 15/30 responses → 50; 2 complaints/60 → 1 − 1/6 → 83.3; complete → 100.
    const t = scoreTrust({ ...facts, reviewCount: 30, reviewSumTenths: 30 * 45, respondedReviews: 15, confirmed: 60, propertyCancellations: 3, complaints: 2, completedStays: 55 });
    const by = Object.fromEntries(t.components.map((c) => [c.key, c.score]));
    expect(by).toEqual({ guest_reviews: 81, reliability: 95, verification: 100, responsiveness: 50, complaints: 83, completeness: 100 });
    // 0.40·81 + 0.20·95 + 0.15·100 + 0.10·50 + 0.10·83 + 0.05·100 = 84.7 → 85
    expect(t.score).toBe(85);
    expect(t.confidence).toBe('HIGH');
    expect(trustConfidence(6, 12)).toBe('MEDIUM');
    expect(trustConfidence(30, 12)).toBe('MEDIUM');
  });
});

describe('accessibility with provenance', () => {
  it('lets partners declare, admins verify, and guests filter by verified features', async () => {
    const { app, owner, admin, hotel } = await bookingWorld();
    const other = await createPublishedHotel(app, owner, admin, { content: hotelContent({ name: 'Ramp House', city: 'Goa' }) });
    const declare = (hotelId: string, features: Array<{ code: string; note?: string }>) => request(app).put(`/api/v1/partner/hotels/${hotelId}/accessibility`).set(bearer(owner.accessToken)).send({ features });

    expect((await declare(hotel.hotelId, [{ code: 'STEP_FREE_ENTRANCE' }, { code: 'ROLL_IN_SHOWER', note: 'Rooms 101–104' }]).expect(200)).body.data).toEqual([
      expect.objectContaining({ code: 'STEP_FREE_ENTRANCE', source: 'PARTNER_DECLARED', verifiedAt: null }),
      expect.objectContaining({ code: 'ROLL_IN_SHOWER', label: 'Roll-in shower', note: 'Rooms 101–104' }),
    ]);
    await declare(other.hotelId, [{ code: 'STEP_FREE_ENTRANCE' }]).expect(200);
    await declare(hotel.hotelId, [{ code: 'NOT_A_FEATURE' }]).expect(422);
    const stranger = await registerUser(app);
    await request(app).put(`/api/v1/partner/hotels/${hotel.hotelId}/accessibility`).set(bearer(stranger.accessToken)).send({ features: [] }).expect(403);

    // Only declared features can be verified; verification needs evidence and admin rights.
    const verify = `/api/v1/admin/hotels/${hotel.hotelId}/accessibility/verify`;
    await request(app).post(verify).set(bearer(admin.accessToken)).send({ codes: ['ELEVATOR'], verified: true, evidence: 'Site visit photos' }).expect(422);
    await request(app).post(verify).set(bearer(owner.accessToken)).send({ codes: ['STEP_FREE_ENTRANCE'], verified: true, evidence: 'Self check' }).expect(403);
    await request(app).post(verify).set(bearer(admin.accessToken)).send({ codes: ['STEP_FREE_ENTRANCE'], verified: true, evidence: 'Site visit 2026-11-20, photos on file' }).expect(200);

    const search = (q: string) => request(app).get(`/api/v1/hotels?${q}`).expect(200).then((r) => r.body.data.items.map((h: { id: string }) => h.id).sort());
    expect(await search('accessibilityFeatures=STEP_FREE_ENTRANCE')).toEqual([hotel.hotelId, other.hotelId].sort());
    expect(await search('accessibilityFeatures=STEP_FREE_ENTRANCE&accessibilityVerifiedOnly=true')).toEqual([hotel.hotelId]);
    expect(await search('accessibilityFeatures=STEP_FREE_ENTRANCE,ROLL_IN_SHOWER')).toEqual([hotel.hotelId]);

    const detail = (await request(app).get(`/api/v1/hotels/${hotel.slug}`).expect(200)).body.data;
    expect(detail.accessibility).toEqual([
      expect.objectContaining({ code: 'STEP_FREE_ENTRANCE', source: 'ADMIN_VERIFIED', verifiedAt: expect.any(String) }),
      expect.objectContaining({ code: 'ROLL_IN_SHOWER', source: 'PARTNER_DECLARED' }),
    ]);
    expect(JSON.stringify(detail.accessibility)).not.toContain('Site visit'); // evidence stays internal
    expect(detail.trustScore).toMatchObject({ score: null, confidence: 'LOW', basis: { reviews: 0 } });
    expect(detail.trustScore.components).toHaveLength(6);

    // Changing a verified feature's description returns it to "declared".
    const redeclared = (await declare(hotel.hotelId, [{ code: 'STEP_FREE_ENTRANCE', note: 'Ramp at side door' }, { code: 'ROLL_IN_SHOWER', note: 'Rooms 101–104' }]).expect(200)).body.data;
    expect(redeclared[0]).toMatchObject({ source: 'PARTNER_DECLARED' });
  });
});
