import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, createTestContext, createUserWithRoles, registerUser } from '@/test/helpers';
import { assertCanAccessResource, canAccessResource } from './ownership.policy';

describe('permission middleware', () => {
  it('denies customers access to administrative endpoints', async () => {
    const { app } = createTestContext();
    const customer = await registerUser(app);
    for (const path of ['/api/v1/users', '/api/v1/audit', '/api/v1/roles', '/api/v1/permissions']) {
      const res = await request(app).get(path).set(bearer(customer.accessToken)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('allows administrators to read users, roles and the audit log', async () => {
    const { app } = createTestContext();
    const admin = await createUserWithRoles(app, ['ADMIN']);
    await registerUser(app);

    const users = await request(app)
      .get('/api/v1/users?limit=10')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(users.body.data.pagination.total).toBe(2);
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash/);

    const audit = await request(app)
      .get('/api/v1/audit')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(
      audit.body.data.items.some((entry: { action: string }) => entry.action === 'auth.register'),
    ).toBe(true);
    expect(JSON.stringify(audit.body)).not.toMatch(/Str0ng-Passw0rd/);

    const roles = await request(app)
      .get('/api/v1/roles')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(roles.body.data.map((r: { role: string }) => r.role)).toContain('SUPER_ADMIN');
  });

  it('support staff can read users but not manage them', async () => {
    const { app } = createTestContext();
    const support = await createUserWithRoles(app, ['SUPPORT']);
    const customer = await registerUser(app);
    await request(app).get('/api/v1/users').set(bearer(support.accessToken)).expect(200);
    await request(app).get('/api/v1/audit').set(bearer(support.accessToken)).expect(403);
    await request(app)
      .patch(`/api/v1/users/${customer.id}/roles`)
      .set(bearer(support.accessToken))
      .send({ roles: ['HOTEL_OWNER'] })
      .expect(403);
  });

  it('returns effective permissions for the caller', async () => {
    const { app } = createTestContext();
    const owner = await createUserWithRoles(app, ['CUSTOMER', 'HOTEL_OWNER']);
    const res = await request(app)
      .get('/api/v1/permissions/me')
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(res.body.data.permissions).toEqual(
      expect.arrayContaining(['hotels:create', 'bookings:create']),
    );
    expect(res.body.data.permissions).not.toContain('users:manage');
  });
});

describe('role management', () => {
  it('admins can grant non-privileged roles but not privileged ones', async () => {
    const { app } = createTestContext();
    const admin = await createUserWithRoles(app, ['ADMIN']);
    const customer = await registerUser(app);

    const ok = await request(app)
      .patch(`/api/v1/users/${customer.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ['CUSTOMER', 'HOTEL_OWNER'] })
      .expect(200);
    expect(ok.body.data.roles).toEqual(['CUSTOMER', 'HOTEL_OWNER']);

    const denied = await request(app)
      .patch(`/api/v1/users/${customer.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ['ADMIN'] })
      .expect(403);
    expect(denied.body.error.message).toMatch(/super administrator/i);
  });

  it('super admins can grant privileged roles; nobody can change their own roles', async () => {
    const { app } = createTestContext();
    const superAdmin = await createUserWithRoles(app, ['SUPER_ADMIN']);
    const customer = await registerUser(app);
    await request(app)
      .patch(`/api/v1/users/${customer.id}/roles`)
      .set(bearer(superAdmin.accessToken))
      .send({ roles: ['ADMIN'] })
      .expect(200);
    await request(app)
      .patch(`/api/v1/users/${superAdmin.id}/roles`)
      .set(bearer(superAdmin.accessToken))
      .send({ roles: ['CUSTOMER'] })
      .expect(403);
  });

  it('rejects unknown roles and invalid ids', async () => {
    const { app } = createTestContext();
    const admin = await createUserWithRoles(app, ['ADMIN']);
    await request(app)
      .patch('/api/v1/users/not-an-id/roles')
      .set(bearer(admin.accessToken))
      .send({ roles: ['CUSTOMER'] })
      .expect(422);
    const customer = await registerUser(app);
    await request(app)
      .patch(`/api/v1/users/${customer.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ['GOD'] })
      .expect(422);
    await request(app)
      .patch('/api/v1/users/0123456789abcdef01234567/roles')
      .set(bearer(admin.accessToken))
      .send({ roles: ['CUSTOMER'] })
      .expect(404);
  });

  it('suspending a user revokes their sessions immediately', async () => {
    const { app } = createTestContext();
    const admin = await createUserWithRoles(app, ['ADMIN']);
    const customer = await registerUser(app);
    await request(app)
      .patch(`/api/v1/users/${customer.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'SUSPENDED', reason: 'Fraud review' })
      .expect(200);
    await request(app).get('/api/v1/auth/me').set(bearer(customer.accessToken)).expect(401);
  });

  it('admins cannot suspend more senior accounts', async () => {
    const { app } = createTestContext();
    const admin = await createUserWithRoles(app, ['ADMIN']);
    const superAdmin = await createUserWithRoles(app, ['SUPER_ADMIN']);
    await request(app)
      .patch(`/api/v1/users/${superAdmin.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: 'SUSPENDED' })
      .expect(403);
  });
});

describe('resource ownership policy', () => {
  const hotelOfOwnerA = { ownerId: 'owner-a', memberIds: ['staff-a'] };

  it('owners access their own resources only', () => {
    const ownerA = { userId: 'owner-a', roles: ['HOTEL_OWNER'] as const };
    const ownerB = { userId: 'owner-b', roles: ['HOTEL_OWNER'] as const };
    expect(canAccessResource(ownerA, hotelOfOwnerA, { permission: 'hotels:update' })).toBe(true);
    // Same role, same permission, different owner → denied. Changing an ID is not enough.
    expect(canAccessResource(ownerB, hotelOfOwnerA, { permission: 'hotels:update' })).toBe(false);
  });

  it('delegated staff need both membership and the permission', () => {
    const staff = { userId: 'staff-a', roles: ['HOTEL_STAFF'] as const };
    expect(canAccessResource(staff, hotelOfOwnerA, { permission: 'rooms:manage' })).toBe(true);
    expect(canAccessResource(staff, hotelOfOwnerA, { permission: 'hotels:update' })).toBe(false);
  });

  it('platform override permissions bypass ownership', () => {
    const admin = { userId: 'admin', roles: ['ADMIN'] as const };
    const customer = { userId: 'owner-a', roles: ['CUSTOMER'] as const };
    expect(
      canAccessResource(admin, hotelOfOwnerA, {
        permission: 'hotels:update',
        overridePermission: 'hotels:moderate',
      }),
    ).toBe(true);
    // Ownership without the permission is not enough either.
    expect(canAccessResource(customer, hotelOfOwnerA, { permission: 'hotels:update' })).toBe(false);
  });

  it('assertCanAccessResource throws a not-found error to avoid leaking existence', () => {
    const ownerB = { userId: 'owner-b', roles: ['HOTEL_OWNER'] as const };
    expect(() =>
      assertCanAccessResource(ownerB, hotelOfOwnerA, {
        permission: 'hotels:update',
        resourceName: 'Hotel',
      }),
    ).toThrowError(/Hotel not found/);
  });
});
