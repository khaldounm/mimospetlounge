#!/bin/sh
# Runs the nightly backup pipeline by hand for one clinic: the same steps and
# flags as .github/workflows/db-backup.yml, against that clinic's LOCAL
# database, then proves the file reads back from R2 and decrypts. The file is
# KEPT in the bucket by default (a real backup, encrypted with the clinic's
# own passphrase); KEEP=0 removes it at the end.
#
#   sh r2-backup-test.sh nadine
#   sh r2-backup-test.sh mimo
#   KEEP=0 sh r2-backup-test.sh mimo     # clean up afterwards
#
# Reads R2 keys and Nadine's passphrase from .env.r2 (git-ignored), and Mimo's
# passphrase from the BACKUP_PASSPHRASE line in .env.
set -eu
cd /Users/khal/Desktop/Workspace/mimospetloung

CLINIC="${1:-}"
case "$CLINIC" in
  mimo)   BUCKET=mimos-backups;  PREFIX=mimos;  DB=mimos_pet_lounge ;;
  nadine) BUCKET=nadine-backups; PREFIX=nadine; DB=dr_nadine_said ;;
  *) echo "usage: sh r2-backup-test.sh mimo|nadine"; exit 1 ;;
esac

[ -f .env.r2 ] || { echo "missing .env.r2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, NADINE_BACKUP_PASSPHRASE)"; exit 1; }
set -a; . ./.env.r2; set +a

case "$R2_ACCOUNT_ID" in *your-account-id*|"") echo "R2_ACCOUNT_ID in .env.r2 is still the placeholder"; exit 1 ;; esac
echo "$R2_ACCOUNT_ID" | grep -Eq '^[0-9a-f]{32}$' || { echo "R2_ACCOUNT_ID should be the 32-character hex id from https://<id>.r2.cloudflarestorage.com"; exit 1; }
case "$R2_ACCESS_KEY_ID$R2_SECRET_ACCESS_KEY" in *your-*) echo "R2 keys in .env.r2 are still placeholders"; exit 1 ;; esac

# Each clinic's file is encrypted with ITS passphrase, the same one its GitHub
# secret holds, so what is kept in the bucket restores like a nightly file.
if [ "$CLINIC" = mimo ]; then
  # The line may be commented out in .env; the value is the same either way.
  PASSPHRASE=$(grep -E '^#?\s*BACKUP_PASSPHRASE=' .env | head -1 | cut -d= -f2- | tr -d '"')
else
  PASSPHRASE="${NADINE_BACKUP_PASSPHRASE:-}"
fi
[ -n "$PASSPHRASE" ] || { echo "no passphrase found for $CLINIC (BACKUP_PASSPHRASE in .env for mimo, NADINE_BACKUP_PASSPHRASE in .env.r2 for nadine)"; exit 1; }

# Same remote definition as the workflow, from the environment only.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_REGION=auto
# An object-scoped token may not HEAD or create buckets; without this rclone
# mistakes the refusal for a missing bucket and tries to create it (403).
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_RETRIES=1 RCLONE_LOW_LEVEL_RETRIES=2

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
STAMP="TEST-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="$PREFIX-$STAMP.dump"

echo "[$CLINIC] 1. dump local $DB"
pg_dump -d "$DB" --format=custom --no-owner --no-privileges --schema=public --file="$WORK/$FILE"
ls -lh "$WORK/$FILE" | awk '{print "   " $5}'

echo "[$CLINIC] 2. verify readable"
TABLES=$(pg_restore --list "$WORK/$FILE" | grep -c "TABLE DATA" || true)
echo "   tables with data: $TABLES"
[ "$TABLES" -ge 20 ] || { echo "   too few tables"; exit 1; }

echo "[$CLINIC] 3. encrypt"
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$PASSPHRASE" \
  --output "$WORK/$FILE.gpg" "$WORK/$FILE"
BEFORE=$(shasum -a 256 "$WORK/$FILE.gpg" | cut -d' ' -f1)

echo "[$CLINIC] 4. upload to r2:$BUCKET"
rclone copy "$WORK/$FILE.gpg" "r2:$BUCKET" --no-traverse
rclone lsl "r2:$BUCKET" --include "$FILE.gpg" | tee "$WORK/verify"
[ -s "$WORK/verify" ] || { echo "   upload not visible"; exit 1; }

echo "[$CLINIC] 5. download it back and compare"
mkdir "$WORK/back"
rclone copy "r2:$BUCKET" "$WORK/back" --include "$FILE.gpg"
AFTER=$(shasum -a 256 "$WORK/back/$FILE.gpg" | cut -d' ' -f1)
[ "$BEFORE" = "$AFTER" ] && echo "   checksum identical" || { echo "   CHECKSUM MISMATCH"; exit 1; }

echo "[$CLINIC] 6. decrypt and read"
gpg --decrypt --batch --quiet --passphrase "$PASSPHRASE" "$WORK/back/$FILE.gpg" > "$WORK/back/$FILE"
echo "   tables with data after round trip: $(pg_restore --list "$WORK/back/$FILE" | grep -c "TABLE DATA")"

echo "[$CLINIC] 7. prune dry run (nothing under 30 days is touched)"
rclone delete "r2:$BUCKET" --min-age 30d --include "$PREFIX-*.dump.gpg" --dry-run 2>&1 | sed 's/^/   /' || true

if [ "${KEEP:-1}" = "1" ]; then
  echo "[$CLINIC] 8. kept $FILE.gpg in $BUCKET"
else
  echo "[$CLINIC] 8. remove the test object"
  rclone deletefile "r2:$BUCKET/$FILE.gpg"
  rclone lsl "r2:$BUCKET" --include "$FILE.gpg" | grep -q . && { echo "   still there"; exit 1; } || echo "   gone"
fi

echo; echo "[$CLINIC] ALL GOOD. $BUCKET now holds:"
rclone lsl "r2:$BUCKET" | sed 's/^/   /'
