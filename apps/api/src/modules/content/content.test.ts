import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { bearer, createTestContext, createUserWithRoles, registerUser } from '@/test/helpers';
import { createAdmin, testImage } from '@/test/marketplace-fixtures';
import { ContentEntryModel, ContentRevisionModel } from './content.models';

const guide = {
  type: 'GUIDE',
  slug: 'monsoon-in-goa',
  title: 'Monsoon in Goa',
  summary: 'Green hills and quiet beaches',
  body: '## Why go\n\nFewer crowds.',
  tags: ['goa', 'monsoon'],
};

describe('content management', () => {
  it('keeps drafts off the public site until published, and edits off it until republished', async () => {
    const { app } = createTestContext();
    const editor = await createAdmin(app);
    const created = (
      await request(app)
        .post('/api/v1/admin/content')
        .set(bearer(editor.accessToken))
        .send(guide)
        .expect(201)
    ).body.data;
    expect(created).toMatchObject({ state: 'DRAFT', version: 1, hasUnpublishedChanges: true });
    await request(app).get('/api/v1/content/guide/monsoon-in-goa').expect(404);
    expect(
      (await request(app).get('/api/v1/content?type=GUIDE').expect(200)).body.data,
    ).toHaveLength(0);

    const live = (
      await request(app)
        .post(`/api/v1/admin/content/${created.id}/publish`)
        .set(bearer(editor.accessToken))
        .send({})
        .expect(200)
    ).body.data;
    expect(live).toMatchObject({ state: 'LIVE', hasUnpublishedChanges: false });
    expect(
      (await request(app).get('/api/v1/content/guide/monsoon-in-goa').expect(200)).body.data,
    ).toMatchObject({
      title: 'Monsoon in Goa',
      body: '## Why go\n\nFewer crowds.',
      tags: ['goa', 'monsoon'],
    });

    // Editing changes the draft only.
    const edited = (
      await request(app)
        .put(`/api/v1/admin/content/${created.id}`)
        .set(bearer(editor.accessToken))
        .send({
          ...guide,
          type: undefined,
          slug: undefined,
          title: 'Goa in the monsoon',
          version: 1,
        })
        .expect(200)
    ).body.data;
    expect(edited).toMatchObject({ version: 2, hasUnpublishedChanges: true, state: 'LIVE' });
    expect(
      (await request(app).get('/api/v1/content/guide/monsoon-in-goa').expect(200)).body.data.title,
    ).toBe('Monsoon in Goa');
    // A stale editor cannot overwrite the newer draft.
    await request(app)
      .put(`/api/v1/admin/content/${created.id}`)
      .set(bearer(editor.accessToken))
      .send({ ...guide, type: undefined, slug: undefined, title: 'Stale', version: 1 })
      .expect(409);

    // Preview shows the draft with a short-lived token, never indexed.
    const { token } = (
      await request(app)
        .post(`/api/v1/admin/content/${created.id}/preview`)
        .set(bearer(editor.accessToken))
        .expect(201)
    ).body.data;
    const preview = await request(app).get(`/api/v1/content/preview/${token}`).expect(200);
    expect(preview.body.data).toMatchObject({
      title: 'Goa in the monsoon',
      seo: { noindex: true },
    });
    expect(preview.headers['x-robots-tag']).toMatch(/noindex/);
    await ContentEntryModel.updateOne(
      { _id: created.id },
      { $set: { previewExpiresAt: new Date(Date.now() - 1000) } },
    );
    await request(app).get(`/api/v1/content/preview/${token}`).expect(404);

    await request(app)
      .post(`/api/v1/admin/content/${created.id}/publish`)
      .set(bearer(editor.accessToken))
      .send({})
      .expect(200);
    expect(
      (await request(app).get('/api/v1/content/guide/monsoon-in-goa').expect(200)).body.data.title,
    ).toBe('Goa in the monsoon');

    const revisions = (
      await request(app)
        .get(`/api/v1/admin/content/${created.id}/revisions`)
        .set(bearer(editor.accessToken))
        .expect(200)
    ).body.data;
    expect(revisions.map((r: { action: string }) => r.action)).toEqual([
      'PUBLISHED',
      'SAVED',
      'PUBLISHED',
      'CREATED',
    ]);
    expect(
      await AuditLogModel.countDocuments({ entityType: 'ContentEntry', entityId: created.id }),
    ).toBeGreaterThanOrEqual(5);

    await request(app)
      .post(`/api/v1/admin/content/${created.id}/archive`)
      .set(bearer(editor.accessToken))
      .expect(200);
    await request(app).get('/api/v1/content/guide/monsoon-in-goa').expect(404);
    await request(app)
      .put(`/api/v1/admin/content/${created.id}`)
      .set(bearer(editor.accessToken))
      .send({ ...guide, type: undefined, slug: undefined, version: 3 })
      .expect(409);
    expect(await ContentRevisionModel.countDocuments({ entryId: created.id })).toBe(5);
  });

  it('honours schedules, language fallback, and editor permissions', async () => {
    const { app } = createTestContext();
    const editor = await createAdmin(app);
    const banner = {
      type: 'BANNER',
      slug: 'diwali',
      title: 'Diwali getaways',
      cta: { label: 'Explore', href: '/search?city=Jaipur' },
    };
    const b = (
      await request(app)
        .post('/api/v1/admin/content')
        .set(bearer(editor.accessToken))
        .send(banner)
        .expect(201)
    ).body.data;
    const later = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/content/${b.id}/publish`)
          .set(bearer(editor.accessToken))
          .send({ publishAt: later })
          .expect(200)
      ).body.data.state,
    ).toBe('SCHEDULED');
    expect(
      (await request(app).get('/api/v1/content?type=BANNER').expect(200)).body.data,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/content?state=SCHEDULED')
          .set(bearer(editor.accessToken))
          .expect(200)
      ).body.data.items,
    ).toHaveLength(1);
    // Time passes: the schedule window opens, then closes.
    await ContentEntryModel.updateOne(
      { _id: b.id },
      {
        $set: {
          publishAt: new Date(Date.now() - 60_000),
          unpublishAt: new Date(Date.now() + 60_000),
        },
      },
    );
    expect(
      (await request(app).get('/api/v1/content?type=BANNER&locale=hi').expect(200)).body.data,
    ).toEqual([expect.objectContaining({ title: 'Diwali getaways', locale: 'en' })]);
    await ContentEntryModel.updateOne(
      { _id: b.id },
      { $set: { unpublishAt: new Date(Date.now() - 1_000) } },
    );
    expect(
      (await request(app).get('/api/v1/content?type=BANNER').expect(200)).body.data,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .get(`/api/v1/admin/content/${b.id}`)
          .set(bearer(editor.accessToken))
          .expect(200)
      ).body.data.state,
    ).toBe('EXPIRED');

    // A Hindi version takes precedence for Hindi readers.
    const hi = (
      await request(app)
        .post('/api/v1/admin/content')
        .set(bearer(editor.accessToken))
        .send({
          type: 'FAQ',
          locale: 'hi',
          slug: 'cancel',
          title: 'मैं बुकिंग कैसे रद्द करूँ?',
          body: 'खाता → बुकिंग → रद्द करें।',
          faqCategory: 'bookings',
        })
        .expect(201)
    ).body.data;
    await request(app)
      .post('/api/v1/admin/content')
      .set(bearer(editor.accessToken))
      .send({
        type: 'FAQ',
        slug: 'cancel',
        title: 'How do I cancel?',
        body: 'Account → Bookings → Cancel.',
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/admin/content/${hi.id}/publish`)
      .set(bearer(editor.accessToken))
      .send({})
      .expect(200);
    expect(
      (await request(app).get('/api/v1/content/faq/cancel?locale=hi').expect(200)).body.data,
    ).toMatchObject({ locale: 'hi', faqCategory: 'bookings' });
    await request(app).get('/api/v1/content/faq/cancel').expect(404); // English version still a draft

    // Validation and permissions.
    await request(app)
      .post('/api/v1/admin/content')
      .set(bearer(editor.accessToken))
      .send({ ...guide, slug: 'x2', body: '<script>alert(1)</script>' })
      .expect(422);
    await request(app)
      .post('/api/v1/admin/content')
      .set(bearer(editor.accessToken))
      .send({ ...banner, slug: 'bad-link', cta: { label: 'Go', href: 'javascript:alert(1)' } })
      .expect(422);
    await request(app)
      .post('/api/v1/admin/content')
      .set(bearer(editor.accessToken))
      .send(banner)
      .expect(409);
    const legal = (
      await request(app)
        .post('/api/v1/admin/content')
        .set(bearer(editor.accessToken))
        .send({ type: 'LEGAL', slug: 'terms', title: 'Terms', body: 'These terms…' })
        .expect(201)
    ).body.data;
    await request(app)
      .post(`/api/v1/admin/content/${legal.id}/publish`)
      .set(bearer(editor.accessToken))
      .send({ unpublishAt: later })
      .expect(422);
    const support = await createUserWithRoles(app, ['SUPPORT']);
    await request(app).get('/api/v1/admin/content').set(bearer(support.accessToken)).expect(403);
    const customer = await registerUser(app);
    await request(app)
      .post('/api/v1/admin/content')
      .set(bearer(customer.accessToken))
      .send(guide)
      .expect(403);
  });

  it('attaches only uploaded content images and serves responsive variants', async () => {
    const { app } = createTestContext();
    const editor = await createAdmin(app);
    const img = (
      await request(app)
        .post('/api/v1/admin/content/images')
        .set(bearer(editor.accessToken))
        .attach('file', await testImage(), 'goa.png')
        .expect(201)
    ).body.data;
    await request(app)
      .post('/api/v1/admin/content')
      .set(bearer(editor.accessToken))
      .send({ ...guide, imageIds: ['64b0000000000000000000ff'] })
      .expect(422);
    const e = (
      await request(app)
        .post('/api/v1/admin/content')
        .set(bearer(editor.accessToken))
        .send({ ...guide, imageIds: [img.id], imageAlts: ['Palm trees in the rain'] })
        .expect(201)
    ).body.data;
    await request(app)
      .post(`/api/v1/admin/content/${e.id}/publish`)
      .set(bearer(editor.accessToken))
      .send({})
      .expect(200);
    const pub = (await request(app).get('/api/v1/content/guide/monsoon-in-goa').expect(200)).body
      .data;
    expect(pub.images).toEqual([
      expect.objectContaining({
        id: img.id,
        alt: 'Palm trees in the rain',
        variants: expect.objectContaining({ md: expect.any(String) }),
      }),
    ]);
  });
});
