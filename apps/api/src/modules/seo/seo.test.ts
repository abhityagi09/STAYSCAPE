import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HotelModel } from '@/modules/hotels/hotel.model';
import { bookingWorld } from '@/test/booking-fixtures';

describe('SEO metadata, sitemap and robots', () => {
  it('describes a published hotel with canonical URL, Open Graph and safe JSON-LD', async () => {
    const { app, hotel } = await bookingWorld();
    const res = await request(app).get(`/api/v1/seo/head/hotels/${hotel.slug}`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/<title>.+ · STAYSCAPE<\/title>/);
    expect(res.text).toContain(
      `<link rel="canonical" href="http://localhost:5173/hotels/${hotel.slug}" />`,
    );
    expect(res.text).toMatch(/<meta property="og:title"/);
    expect(res.text).toMatch(/"@type":"(Hotel|Resort)"/);
    expect(res.text).toMatch(/"@type":"BreadcrumbList"/);
    // Seeded/sample ratings never become structured-data ratings.
    expect(res.text).not.toMatch(/AggregateRating/);
    const body = await request(app).get(`/api/v1/seo/body/hotels/${hotel.slug}`).expect(200);
    expect(body.text).toMatch(/^<main><h1>/);
  });

  it('escapes hostile content so it cannot break out of attributes or the JSON-LD script', async () => {
    const { app, hotel } = await bookingWorld();
    await HotelModel.updateOne(
      { _id: hotel.hotelId },
      { $set: { name: '</script><script>alert(1)</script>"><img src=x onerror=alert(2)>' } },
    );
    const res = await request(app).get(`/api/v1/seo/head/hotels/${hotel.slug}`).expect(200);
    expect(res.text).not.toMatch(/<\/script><script>alert/);
    expect(res.text).not.toMatch(/<img src=x/);
    expect(res.text).toContain('&lt;/script&gt;');
    expect(res.text).toContain('\u003c/script\u003e');
  });

  it('keeps private, transactional and unknown pages out of the index', async () => {
    const { app } = await bookingWorld();
    for (const path of [
      'account/bookings',
      'admin/finance',
      'partner/properties',
      'checkout',
      'login',
      'trips/shared/abc',
    ]) {
      const res = await request(app).get(`/api/v1/seo/head/${path}`).expect(200);
      expect(res.text, path).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(res.text, path).not.toMatch(/canonical|og:title|ld\+json/);
    }
    const missing = await request(app).get('/api/v1/seo/head/hotels/no-such-stay').expect(200);
    expect(missing.text).toContain('noindex');
    const home = await request(app).get('/api/v1/seo/head').expect(200);
    expect(home.text).toMatch(/"@type":"WebSite"/);
    const destination = await request(app)
      .get('/api/v1/seo/head/hotels?destination=Goa&checkIn=2026-12-01')
      .expect(200);
    expect(destination.text).toContain('<title>Stays in Goa · STAYSCAPE</title>');
    expect(destination.text).toContain('href="http://localhost:5173/hotels?destination=Goa"');
  });

  it('lists only published hotels in the sitemap and points robots at it', async () => {
    const { app, hotel } = await bookingWorld();
    await HotelModel.create({
      ...(await HotelModel.findById(hotel.hotelId).lean()),
      _id: undefined,
      slug: 'unpublished-draft-stay',
      publicationStatus: 'DRAFT',
    });
    const map = await request(app).get('/sitemap.xml').expect(200);
    expect(map.headers['content-type']).toMatch(/application\/xml/);
    expect(map.text).toContain(`<loc>http://localhost:5173/hotels/${hotel.slug}</loc>`);
    expect(map.text).not.toContain('unpublished-draft-stay');
    const robots = await request(app).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Disallow: /account');
    expect(robots.text).toContain('Disallow: /admin');
    expect(robots.text).toContain('Sitemap: http://localhost:5173/sitemap.xml');
  });
});
