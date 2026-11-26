import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/modules/audit/audit-log.model';
import { UserModel } from '@/modules/users/user.model';
import { bootstrapFirstAdmin, CONFIRM_PHRASE } from '@/scripts/bootstrap-first-admin';
import { createTestContext, registerUser } from '@/test/helpers';
import { runMigrations } from './runner';
import type { Migration } from './index';

const db = () => mongoose.connection.db!;

describe('migrations', () => {
  it('applies pending migrations once, in order, and records them', async () => {
    const order: string[] = [];
    const make = (id: string): Migration => ({
      id,
      description: id,
      up: async () => {
        order.push(id);
        return { modified: 0 };
      },
    });
    const list = [make('20990102-002-b'), make('20990101-001-a')];
    const dry = await runMigrations(db(), { migrations: list, dryRun: true });
    expect(dry.pending).toEqual(['20990101-001-a', '20990102-002-b']);
    expect(order).toEqual([]);
    const first = await runMigrations(db(), { migrations: list });
    expect(first.applied.map((a) => a.id)).toEqual(['20990101-001-a', '20990102-002-b']);
    expect(order).toEqual(['20990101-001-a', '20990102-002-b']);
    const again = await runMigrations(db(), { migrations: list });
    expect(again.applied).toEqual([]);
    expect(order).toHaveLength(2);
    // The lock is released after the run.
    expect(
      await db()
        .collection('schema_migrations')
        .countDocuments({ _id: '__lock__' as never }),
    ).toBe(0);
  });

  it('refuses to run while another run holds the lock, and rejects duplicate ids', async () => {
    await db()
      .collection('schema_migrations')
      .insertOne({
        _id: '__lock__' as never,
        owner: 'other',
        expiresAt: new Date(Date.now() + 60_000),
      });
    const m: Migration = {
      id: '20990103-003-c',
      description: 'c',
      up: async () => ({ modified: 0 }),
    };
    await expect(runMigrations(db(), { migrations: [m] })).rejects.toThrow(/holds the lock/);
    await db()
      .collection('schema_migrations')
      .deleteOne({ _id: '__lock__' as never });
    await expect(runMigrations(db(), { migrations: [m, m] })).rejects.toThrow(/Duplicate/);
  });

  it('runs the real migration set idempotently', async () => {
    const { app } = createTestContext();
    const user = await registerUser(app);
    await UserModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(user.id) },
      { $unset: { deletedAt: '' } },
    );
    const result = await runMigrations(db());
    expect(result.applied.find((a) => a.id === '20261127-001-user-deleted-at')?.modified).toBe(1);
    expect((await runMigrations(db())).applied).toEqual([]);
  });
});

describe('first administrator bootstrap', () => {
  const cfg = { ARGON2_MEMORY_KIB: 1024, ARGON2_TIME_COST: 1 };
  const env = {
    ADMIN_BOOTSTRAP_CONFIRM: CONFIRM_PHRASE,
    ADMIN_BOOTSTRAP_EMAIL: 'ops@example.com',
    ADMIN_BOOTSTRAP_PASSWORD: 'Very-Str0ng-Passphrase!',
  };
  it('needs the confirmation phrase and a strong password', async () => {
    createTestContext();
    await expect(
      bootstrapFirstAdmin({ ...env, ADMIN_BOOTSTRAP_CONFIRM: 'yes' }, cfg),
    ).rejects.toThrow(/ADMIN_BOOTSTRAP_CONFIRM/);
    await expect(
      bootstrapFirstAdmin({ ...env, ADMIN_BOOTSTRAP_PASSWORD: 'short' }, cfg),
    ).rejects.toThrow();
    expect(await UserModel.countDocuments({ roles: 'SUPER_ADMIN' })).toBe(0);
  });

  it('creates exactly one first super admin, never promotes existing accounts, and audits it', async () => {
    const { app } = createTestContext();
    const existing = await registerUser(app);
    await expect(
      bootstrapFirstAdmin({ ...env, ADMIN_BOOTSTRAP_EMAIL: existing.email }, cfg),
    ).rejects.toThrow(/already exists/);
    expect((await UserModel.findById(existing.id).lean())!.roles).toEqual(['CUSTOMER']);
    const id = await bootstrapFirstAdmin(env, cfg);
    expect((await UserModel.findById(id).lean())!.roles).toEqual(['SUPER_ADMIN']);
    expect(
      await AuditLogModel.countDocuments({ action: 'admin.first_super_admin_bootstrapped' }),
    ).toBe(1);
    await expect(
      bootstrapFirstAdmin({ ...env, ADMIN_BOOTSTRAP_EMAIL: 'second@example.com' }, cfg),
    ).rejects.toThrow(/already exists/);
  });
});
