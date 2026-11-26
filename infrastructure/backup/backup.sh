#!/bin/sh
# Encrypted logical backup of the STAYSCAPE database (docs/backup-recovery.md).
# Runs inside the mongo:8.0 image (mongodump, mongosh, openssl, sha256sum):
#   docker compose -f docker-compose.prod.yml --env-file <env> --profile backup run --rm backup
# Required: MONGO_URI (cluster URI, no database path), BACKUP_PASSPHRASE (from the secret store).
# Optional: MONGO_DB (stayscape), BACKUP_DIR (/backups), BACKUP_RETENTION_DAYS (14), BACKUP_OPLOG (true).
set -eu
: "${MONGO_URI:?MONGO_URI is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
DB="${MONGO_DB:-stayscape}"
DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="stayscape-${STAMP}.archive.gz.enc"
mkdir -p "$DIR"
umask 077

# Point-in-time consistent dump: the oplog captured during the dump is included (replica sets).
OPLOG=""
if [ "${BACKUP_OPLOG:-true}" = "true" ]; then OPLOG="--oplog"; fi

# Document counts before the dump, recorded in the manifest for restore verification.
mongosh "$MONGO_URI" --quiet --eval "
  const d = db.getSiblingDB('$DB'); const out = {};
  d.getCollectionNames().sort().forEach((c) => { out[c] = d.getCollection(c).countDocuments(); });
  const cash = (d.ledgerentries.aggregate([{ \$match: { account: 'CASH' } }, { \$group: { _id: null, s: { \$sum: '\$amountMinor' } } }]).toArray()[0] || { s: 0 }).s;
  print(JSON.stringify({ db: '$DB', takenAt: new Date().toISOString(), counts: out, ledgerCash: cash }));
" > "$DIR/${NAME%.archive.gz.enc}.manifest.json"

if [ -n "$OPLOG" ]; then
  mongodump --uri="$MONGO_URI" $OPLOG --archive --gzip --quiet
else
  mongodump --uri="$MONGO_URI" --db="$DB" --archive --gzip --quiet
fi | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$DIR/$NAME"

( cd "$DIR" && sha256sum "$NAME" > "$NAME.sha256" )
echo "backup written: $DIR/$NAME ($(wc -c < "$DIR/$NAME") bytes)"

# Retention: local copies older than KEEP_DAYS are removed (off-site copies follow the bucket's lifecycle rules).
find "$DIR" -name 'stayscape-*' -type f -mtime "+$KEEP_DAYS" -print -delete

# Self-hosted media (STORAGE_DRIVER=local): archive the upload volumes too. With S3 storage,
# media durability comes from bucket versioning + replication instead (docs/backup-recovery.md).
if [ -d /media ] && [ -n "$(ls -A /media 2>/dev/null)" ]; then
  MEDIA="stayscape-media-${STAMP}.tar.gz.enc"
  tar -C /media -czf - . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$DIR/$MEDIA"
  ( cd "$DIR" && sha256sum "$MEDIA" > "$MEDIA.sha256" )
  echo "media backup written: $DIR/$MEDIA ($(wc -c < "$DIR/$MEDIA") bytes)"
fi
