import type { Db } from 'mongodb';

/**
 * Versioned data migrations, applied in order by `npm run db:migrate`
 * (`node dist/scripts/migrate.js` in the runtime image). Rules (docs/database.md "Migrations"):
 *  - ids are immutable and sortable (YYYYMMDD-NNN-slug); never edit or reorder an applied one;
 *  - every migration is idempotent and BACKWARD COMPATIBLE with the code currently deployed
 *    (expand → deploy → contract): add fields/collections first, remove them only in a later
 *    release once no running version reads them;
 *  - no migration deletes or rewrites financial history (ledger, payments, refunds, invoices);
 *    corrections to money are new, auditable entries, never edits.
 */
export interface Migration {
  id: string;
  description: string;
  up(db: Db): Promise<{ modified: number }>;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '20261127-001-user-deleted-at',
    description:
      'Backfill users.deletedAt = null for accounts created before self-service deletion.',
    async up(db) {
      const r = await db
        .collection('users')
        .updateMany({ deletedAt: { $exists: false } }, { $set: { deletedAt: null } });
      return { modified: r.modifiedCount };
    },
  },
];
