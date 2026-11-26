#!/bin/sh
# Restore drill: restore the newest backup into a scratch database and compare it with the
# manifest written at backup time (every collection's document count) plus a financial
# checksum (ledger cash total). Exits non-zero on any mismatch. Drops the scratch database
# afterwards unless KEEP_RESTORE=1.
set -eu
DIR="${BACKUP_DIR:-/backups}"
LATEST="$(ls -1t "$DIR"/stayscape-*.archive.gz.enc | head -1)"
MANIFEST="${LATEST%.archive.gz.enc}.manifest.json"
export BACKUP_FILE="$LATEST"
export RESTORE_TARGET_DB="${RESTORE_TARGET_DB:-stayscape_restore_check}"
START=$(date +%s)
sh "$(dirname "$0")/restore.sh"
mongosh "$MONGO_URI" --quiet --eval "
  const manifest = JSON.parse(require('fs').readFileSync('$MANIFEST', 'utf8'));
  const src = db.getSiblingDB(manifest.db); const dst = db.getSiblingDB('$RESTORE_TARGET_DB');
  const bad = [];
  for (const [c, n] of Object.entries(manifest.counts)) {
    const got = dst.getCollection(c).countDocuments();
    if (got !== n) bad.push(c + ': manifest ' + n + ', restored ' + got);
  }
  const cash = (d) => (d.ledgerentries.aggregate([{ \$match: { account: 'CASH' } }, { \$group: { _id: null, s: { \$sum: '\$amountMinor' } } }]).toArray()[0] || { s: 0 }).s;
  print(JSON.stringify({ collections: Object.keys(manifest.counts).length, mismatches: bad, ledgerCashRestored: cash(dst) }));
  if (cash(dst) !== manifest.ledgerCash) bad.push('ledger cash: manifest ' + manifest.ledgerCash + ', restored ' + cash(dst));
  if (bad.length) { print(JSON.stringify(bad)); quit(1); }
"
echo "restore drill passed in $(( $(date +%s) - START ))s using $(basename "$LATEST")"
if [ "${KEEP_RESTORE:-0}" != "1" ]; then
  mongosh "$MONGO_URI" --quiet --eval "db.getSiblingDB('$RESTORE_TARGET_DB').dropDatabase()" >/dev/null
fi
