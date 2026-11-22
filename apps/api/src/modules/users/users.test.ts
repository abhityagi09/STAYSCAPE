import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NotificationModel } from '@/modules/notifications/notification.model';
import { bearer, createTestContext, loginUser, registerUser } from '@/test/helpers';

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('profile', () => {
  it('reads and updates the profile', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);

    const profile = await request(app)
      .get('/api/v1/users/profile')
      .set(bearer(user.accessToken))
      .expect(200);
    expect(profile.body.data.email).toBe(user.email);
    expect(profile.body.data).not.toHaveProperty('passwordHash');

    const updated = await request(app)
      .patch('/api/v1/users/profile')
      .set(bearer(user.accessToken))
      .send({ firstName: 'Meera', phone: '+14155550123' })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      firstName: 'Meera',
      lastName: 'Rao',
      phone: '+14155550123',
    });

    const cleared = await request(app)
      .patch('/api/v1/users/profile')
      .set(bearer(user.accessToken))
      .send({ phone: '' })
      .expect(200);
    expect(cleared.body.data.phone).toBeNull();
  });

  it('validates profile input and refuses protected fields', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const invalid = await request(app)
      .patch('/api/v1/users/profile')
      .set(bearer(user.accessToken))
      .send({ phone: '12345' })
      .expect(422);
    expect(invalid.body.error.details.fieldErrors.phone).toBeDefined();

    await request(app)
      .patch('/api/v1/users/profile')
      .set(bearer(user.accessToken))
      .send({})
      .expect(422);
    const escalation = await request(app)
      .patch('/api/v1/users/profile')
      .set(bearer(user.accessToken))
      .send({ roles: ['ADMIN'], email: 'other@example.com' })
      .expect(422);
    expect(Object.keys(escalation.body.error.details.fieldErrors)).toEqual(
      expect.arrayContaining(['roles', 'email']),
    );
  });

  it('merges preference updates', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const res = await request(app)
      .patch('/api/v1/users/preferences')
      .set(bearer(user.accessToken))
      .send({ currency: 'USD', notifications: { emailPromotions: true } })
      .expect(200);
    expect(res.body.data.preferences).toMatchObject({
      language: 'en',
      currency: 'USD',
      notifications: {
        emailPromotions: true,
        emailBookingUpdates: true,
        emailSecurityAlerts: true,
      },
    });
    await request(app)
      .patch('/api/v1/users/preferences')
      .set(bearer(user.accessToken))
      .send({ currency: 'BTC' })
      .expect(422);
  });

  it('requires authentication', async () => {
    const { app } = createTestContext();
    await request(app).get('/api/v1/users/profile').expect(401);
    await request(app).patch('/api/v1/users/preferences').send({ currency: 'USD' }).expect(401);
  });
});

describe('avatar upload', () => {
  it('stores a valid image and returns its URL', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/users/avatar')
      .set(bearer(user.accessToken))
      .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' })
      .expect(200);
    expect(res.body.data.avatarUrl).toMatch(
      new RegExp(`^/api/v1/media/avatars/${user.id}/.+\\.png$`),
    );
    const served = await request(app).get(res.body.data.avatarUrl).expect(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects files whose content is not an allowed image', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/users/avatar')
      .set(bearer(user.accessToken))
      .attach('avatar', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    await request(app)
      .post('/api/v1/users/avatar')
      .set(bearer(user.accessToken))
      .attach('avatar', PNG, { filename: 'x.gif', contentType: 'image/gif' })
      .expect(415);
  });

  it('rejects oversized files', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
    const res = await request(app)
      .post('/api/v1/users/avatar')
      .set(bearer(user.accessToken))
      .attach('avatar', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('sessions', () => {
  it('lists active sessions and revokes one', async () => {
    const { app } = createTestContext();
    const first = await registerUser(app);
    const second = await loginUser(app, first.email);

    const list = await request(app)
      .get('/api/v1/users/sessions')
      .set(bearer(first.accessToken))
      .expect(200);
    expect(list.body.data).toHaveLength(2);
    const current = list.body.data.find((s: { current: boolean }) => s.current);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    expect(current).toBeDefined();
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);

    await request(app)
      .delete(`/api/v1/users/sessions/${other.id}`)
      .set(bearer(first.accessToken))
      .expect(200);
    await request(app).get('/api/v1/auth/me').set(bearer(second.accessToken)).expect(401);
    await request(app).get('/api/v1/auth/me').set(bearer(first.accessToken)).expect(200);
  });

  it("cannot revoke another user's session (resource-level denial)", async () => {
    const { app } = createTestContext();
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const bobSessions = await request(app)
      .get('/api/v1/users/sessions')
      .set(bearer(bob.accessToken))
      .expect(200);
    const bobSessionId = bobSessions.body.data[0].id;

    const res = await request(app)
      .delete(`/api/v1/users/sessions/${bobSessionId}`)
      .set(bearer(alice.accessToken))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await request(app).get('/api/v1/auth/me').set(bearer(bob.accessToken)).expect(200);
    await request(app)
      .delete('/api/v1/users/sessions/not-a-uuid')
      .set(bearer(alice.accessToken))
      .expect(422);
  });
});

describe('notifications', () => {
  it('lists own notifications and blocks access to others', async () => {
    const { app } = createTestContext();
    const alice = await registerUser(app);
    const bob = await registerUser(app);

    const list = await request(app)
      .get('/api/v1/notifications')
      .set(bearer(alice.accessToken))
      .expect(200);
    expect(list.body.data.items[0]).toMatchObject({
      type: 'ACCOUNT_WELCOME',
      channel: 'IN_APP',
      readAt: null,
    });
    expect(
      (await request(app).get('/api/v1/notifications/unread-count').set(bearer(alice.accessToken)))
        .body.data.count,
    ).toBe(1);

    const bobNotification = await NotificationModel.findOne({ userId: bob.id }).lean();
    await request(app)
      .patch(`/api/v1/notifications/${bobNotification?._id.toString()}/read`)
      .set(bearer(alice.accessToken))
      .expect(404);
    const stillUnread = await NotificationModel.findById(bobNotification?._id).lean();
    expect(stillUnread?.readAt).toBeNull();

    const own = list.body.data.items[0].id;
    const read = await request(app)
      .patch(`/api/v1/notifications/${own}/read`)
      .set(bearer(alice.accessToken))
      .expect(200);
    expect(read.body.data.readAt).not.toBeNull();
  });
});
