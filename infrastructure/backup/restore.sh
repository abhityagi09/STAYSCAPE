#!/bin/sh
# Restore an encrypted backup (docs/backup-recovery.md). By default it restores into a
# SEPARATE database (RESTORE_TARGET_DB, default stayscape_restore_check) so a restore can be
# rehearsed or inspected without touching live data. Restoring over the live database requires
# RESTORE_TARGET_DB=stayscape and RESTORE_CONFIRM=overwrite-live-database.
set -eu
: "${MONGO_URI:?}" ; : "${BACKUP_PASSPHRASE:?}" ; : "${BACKUP_FILE:?path to stayscape-*.archive.gz.enc}"
SOURCE_DB="${MONGO_DB:-stayscape}"
TARGET_DB="${RESTORE_TARGET_DB:-stayscape_restore_check}"
if [ "$TARGET_DB" = "$SOURCE_DB" ] && [ "${RESTORE_CONFIRM:-}" != "overwrite-live-database" ]; then
  echo "Refusing to restore over $SOURCE_DB without RESTORE_CONFIRM=overwrite-live-database" >&2
  exit 2
fi
( cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE").sha256" )
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$BACKUP_FILE" \
  | mongorestore --uri="$MONGO_URI" --archive --gzip --drop --quiet \
      --nsInclude="${SOURCE_DB}.*" --nsFrom="${SOURCE_DB}.*" --nsTo="${TARGET_DB}.*"
echo "restored $SOURCE_DB → $TARGET_DB from $(basename "$BACKUP_FILE")"
