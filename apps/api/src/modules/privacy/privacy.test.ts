import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { RefreshSessionModel } from '@/modules/sessions/refresh-session.model';
import { UserModel } from '@/modules/users/user.model';
import { WishlistModel } from '@/modules/wishlists/wishlist.model';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';
import {
  bearer,
  createTestContext,
  registerPayload,
  registerUser,
  TEST_PASSWORD,
} from '@/test/helpers';

describe('privacy: data export and account deletion', () => {
  it('exports the account’s own data without secrets', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    await request(app)
      .post('/api/v1/wishlists')
      .set(bearer(user.accessToken))
      .send({ name: 'Monsoon ideas' })
      .expect(201);
    const res = await request(app)
      .get('/api/v1/users/me/export')
      .set(bearer(user.accessToken))
      .expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="stayscape-data-/);
    expect(res.headers['cache-control']).toBe('no-store');
    const data = res.body.data;
    expect(data.formatVersion).toBe(1);
    expect(data.account).toMatchObject({ id: user.id, email: user.email });
    expect(data.wishlists).toEqual([expect.objectContaining({ name: 'Monsoon ideas' })]);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/passwordHash|tokenHash|\$argon2/);
    await request(app).get('/api/v1/users/me/export').expect(401);
    expect(await AuditLogModel.countDocuments({ action: 'user.data_exported' })).toBe(1);
  });

  it('blocks deletion while a booking is active and explains why', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const paid = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, paid.booking.reference);
    const blockers = (
      await request(app)
        .get('/api/v1/users/me/deletion')
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data.blockers;
    expect(blockers).toEqual([expect.stringMatching(/upcoming or in-progress booking/)]);
    const res = await request(app)
      .post('/api/v1/users/me/deletion')
      .set(bearer(customer.accessToken))
      .send({ password: TEST_PASSWORD, confirm: 'DELETE' })
      .expect(409);
    expect(res.body.error.details.formErrors).toHaveLength(1);
    expect(await UserModel.countDocuments({ _id: customer.id, accountStatus: 'ACTIVE' })).toBe(1);
  });

  it('refuses partner and staff accounts; requires the password and explicit confirmation', async () => {
    const { app, owner } = await bookingWorld();
    const blockers = (
      await request(app).get('/api/v1/users/me/deletion').set(bearer(owner.accessToken)).expect(200)
    ).body.data.blockers;
    expect(blockers.join(' ')).toMatch(/closed through support/);
    const user = await registerUser(app);
    await request(app)
      .post('/api/v1/users/me/deletion')
      .set(bearer(user.accessToken))
      .send({ password: TEST_PASSWORD })
      .expect(422);
    await request(app)
      .post('/api/v1/users/me/deletion')
      .set(bearer(user.accessToken))
      .send({ password: 'wrong-password', confirm: 'DELETE' })
      .expect(401);
    // Mass assignment: unknown fields are rejected, not applied.
    await request(app)
      .post('/api/v1/users/me/deletion')
      .set(bearer(user.accessToken))
      .send({ password: TEST_PASSWORD, confirm: 'DELETE', userId: owner.id })
      .expect(422);
  });

  it('anonymises the account, revokes every session, removes personal lists and frees the email', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    await request(app)
      .post('/api/v1/wishlists')
      .set(bearer(user.accessToken))
      .send({ name: 'Goa' })
      .expect(201);
    await request(app)
      .post('/api/v1/users/me/deletion')
      .set(bearer(user.accessToken))
      .send({ password: TEST_PASSWORD, confirm: 'DELETE' })
      .expect(200);

    const stored = await UserModel.findById(user.id).lean();
    expect(stored).toMatchObject({
      firstName: 'Deleted',
      phone: null,
      accountStatus: 'DEACTIVATED',
      email: `deleted+${user.id}@deleted.stayscape.invalid`,
    });
    expect(stored?.deletedAt).toBeInstanceOf(Date);
    expect(await WishlistModel.countDocuments({ userId: user.id })).toBe(0);
    expect(await RefreshSessionModel.countDocuments({ userId: user.id, revokedAt: null })).toBe(0);
    // The old access token no longer works and the old credentials cannot sign in.
    await request(app).get('/api/v1/auth/me').set(bearer(user.accessToken)).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    // The address can be used for a fresh account.
    await request(app)
      .post('/api/v1/auth/register')
      .send(registerPayload({ email: user.email }))
      .expect(201);
    expect(
      await AuditLogModel.countDocuments({ action: 'user.account_deleted', entityId: user.id }),
    ).toBe(1);
  });
});
