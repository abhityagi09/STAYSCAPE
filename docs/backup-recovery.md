# Backup and disaster recovery

## Objectives

|                                   | Target                           | How                                                                                 |
| --------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| **RPO** (data loss)               | ≤ 5 minutes for production data  | MongoDB Atlas continuous cloud backup with point-in-time restore (primary)          |
|                                   | ≤ 24 hours, provider-independent | nightly encrypted logical dump (`infrastructure/backup/backup.sh`), copied off-site |
| **RTO** (time to restore service) | ≤ 2 hours                        | restore to a new cluster/database, point the API at it, redeploy the current tag    |

Measured on staging (2026-11-26, 66 collections, ~1.7 MB compressed): backup 4 s, restore and
full verification 12–14 s. Restore time grows roughly linearly with data size; rehearse with
production-sized data before relying on the RTO.

## What is backed up

| Data                                                                                | Primary protection                                                                                                            | Secondary                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB (all collections, including the append-only ledger, audit log and invoices) | Atlas continuous backup, PITR, cross-region snapshot copy                                                                     | nightly `backup.sh`: oplog-consistent `mongodump`, AES-256 (PBKDF2, 200k iterations) with `BACKUP_PASSPHRASE`, SHA-256 checksum, manifest of document counts and the ledger cash total |
| Listing media (public bucket)                                                       | S3 versioning + cross-region replication; objects are content-addressed and never overwritten                                 | —                                                                                                                                                                                      |
| Verification documents (private bucket)                                             | S3 versioning, SSE-KMS, cross-region replication, no public access                                                            | —                                                                                                                                                                                      |
| Self-hosted media (`STORAGE_DRIVER=local`, staging)                                 | `backup.sh` also archives and encrypts the upload volumes                                                                     | —                                                                                                                                                                                      |
| Redis                                                                               | not backed up: caches, rate-limit counters and job queues are rebuilt; jobs are re-scheduled by the worker and are idempotent | —                                                                                                                                                                                      |
| Configuration                                                                       | images are immutable tags in GHCR; compose/nginx/alerts are in git; secrets live in the secret manager (versioned)            | `.env.production` is never committed                                                                                                                                                   |

Retention: Atlas snapshots per policy (e.g. 7 daily, 4 weekly, 12 monthly); local logical
dumps `BACKUP_RETENTION_DAYS` (14); off-site bucket lifecycle 35 days for dailies, 13 months for
monthly copies. Tax and accounting records must be retainable for the statutory period
(docs/compliance-india.md) — keep monthly copies accordingly.

## Running backups

```sh
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C --profile backup run --rm backup          # nightly via cron/ECS scheduled task
```

`BACKUP_MONGO_URI` must be the **cluster** URI (no database path) so the dump can include the
oplog for a consistent snapshot. Copy `/backups` (the `backups` volume) to an off-site bucket
with versioning and object lock after each run; the passphrase is stored separately in the
secret manager.

## Restore drill (monthly, and after every infrastructure change)

```sh
$C --profile backup run --rm restore-drill
```

Restores the newest dump into a scratch database (`stayscape_restore_check`), checks the
checksum, compares every collection's document count and the ledger cash total with the manifest,
and drops the scratch database. Any mismatch exits non-zero. Last result: **passed** —
66 collections, 0 mismatches (2026-11-26, staging). A wrong passphrase and a corrupted file were
both rejected.

For an exact-count drill, pause writers during the dump (stop `api` and `worker`); in
production the PITR restore is the source of truth and the logical drill tolerates the oplog.

## Recovery procedures

### Point-in-time restore (most incidents: bad migration, accidental deletion, corruption)

1. Declare an incident; stop the worker (`$C stop worker`) to avoid side effects (emails, refunds).
2. In Atlas, restore to a **new** cluster at the chosen time (before the incident).
3. Run the reconciliation report against it to confirm financial consistency.
4. Point `MONGO_URI` at the restored cluster, run the release task, deploy the current tag.
5. Compare with the old cluster for transactions after the restore point (payments captured at
   the provider); recover them with the payment reconciliation job and auditable adjustments.

### From a logical dump (provider loss or a portable copy)

```sh
$C --profile backup run --rm -e BACKUP_FILE=/backups/<file>.archive.gz.enc \
   -e RESTORE_TARGET_DB=stayscape_recovered --entrypoint sh backup /scripts/restore.sh
```

Restoring over the live database additionally requires `RESTORE_TARGET_DB=stayscape` and
`RESTORE_CONFIRM=overwrite-live-database`.

### Media

Restore object versions from S3 (or `tar -x` the decrypted media archive into the upload volume
for self-hosted stacks). Database records reference media by key, so restoring both to the same
point in time keeps them consistent; orphaned files are cleaned by the media job.

### Configuration and secrets

Re-create hosts from git (compose, nginx, alert rules) and the secret manager; deploy the last
known-good image tag (`.deploy/current-tag` or the GHCR history).
