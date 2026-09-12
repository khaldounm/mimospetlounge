# Database backup setup

Supabase's free tier keeps no backups, so the live database is the only copy
of a clinic's data until this runs. `.github/workflows/db-backup.yml` dumps
every clinic's database nightly, encrypts the file, and uploads it to that
clinic's bucket in Cloudflare R2: a different provider from the database on
purpose, so nothing that takes the database takes its backups with it.

The workflow is a matrix with one entry per clinic. Adding a clinic means
adding its entry, its bucket, and its secrets. Everything below needs
credentials, so it is done by hand, once per clinic.

## Step 1: The bucket

Cloudflare dashboard > R2 > Create bucket. One per clinic, named as in the
workflow matrix: `mimos-backups`, `nadine-backups`. Location hint: EU. Leave
public access off; nothing here is ever served.

## Step 2: The API token

R2 > Manage R2 API Tokens > Create API Token:

- Permissions: **Object Read & Write**
- Specify buckets: the clinic's bucket (or both, for one shared token)
- TTL: forever

It shows an **Access Key ID** and a **Secret Access Key** once. Copy both now.
The account id is on the R2 overview page; the workflow derives the endpoint
`https://<account id>.r2.cloudflarestorage.com` from it.

## Step 3: The passphrase

```bash
openssl rand -base64 32
```

**Save this in a password manager right now.** If it is lost, every backup ever
made for that clinic is unrecoverable ciphertext. GitHub secrets are write-only,
so it cannot be read back out later.

## Step 4: The secrets

Repository > Settings > Secrets and variables > Actions. The names come from the
workflow matrix; these are Mimo's, Nadine's are prefixed `NADINE_`:

| Secret                 | Value                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID`        | shared by every clinic                                                                                      |
| `R2_ACCESS_KEY_ID`     | step 2. Both clinics may point at the same pair, or each at its own                                         |
| `R2_SECRET_ACCESS_KEY` | step 2                                                                                                      |
| `SUPABASE_DB_URL`      | the **direct** URL, port **5432**, that clinic's `DIRECT_URL`. Not the 6543 pooler: `pg_dump` cannot use it |
| `BACKUP_PASSPHRASE`    | step 3                                                                                                      |

A clinic whose secrets are missing is skipped with a notice, not failed, so
the workflow can be pushed before a clinic is set up.

## Step 5: Run it by hand

Actions tab > "Database backup" > Run workflow > main. One job per clinic,
about two minutes each. A skipped clinic shows a notice naming it.

If it fails on `citext` or `btree_gist`, enable that extension in the Supabase
dashboard under Database > Extensions, then rerun.

## Step 6: Prove a backup is actually restorable

This is the step people skip, and the only one that proves anything. From
your machine, with an rclone remote `r2` configured the same way (type `s3`,
provider `Cloudflare`, the endpoint and keys from step 2):

```bash
rclone copy r2:mimos-backups ./backup-test --include "mimos-*.dump.gpg" && ls -lh ./backup-test
```

```bash
gpg --decrypt --batch --passphrase 'YOUR_PASSPHRASE' ./backup-test/mimos-*.dump.gpg > /tmp/test.dump && pg_restore --list /tmp/test.dump | grep -c "TABLE DATA"
```

Expect a number in the high twenties or above. Anything under 20 would already
have failed the workflow's own check, so a low number here means the
encryption step mangled the archive.

Clean up afterwards. The decrypted dump is real client PII: names, phone
numbers, payment history.

```bash
rm -rf ./backup-test /tmp/test.dump
```

To restore one for real, `pnpm db:restore -- --yes --file /path/to/file.dump`
with `.env` on that clinic's pair; see `src/lib/db-transfer.ts`.

## Step 7: Confirm tomorrow

The cron is 22:00 UTC daily. Check the Actions tab the next day to confirm the
**scheduled** run fired, not just your manual one.

## Ongoing

- Each bucket holds 30 days; the workflow prunes anything older, by prefix, so
  one clinic's prune can never touch another's files.
- GitHub disables scheduled workflows on repos with no activity for 60 days. If
  the repo goes quiet for a couple of months, check the workflow is still
  enabled.
- Every clinic's `BACKUP_PASSPHRASE` must live in a password manager, not only
  in GitHub.
- Mimo's earlier backups (to 2026-09-12) sit in the Google Drive folder from
  the previous setup. Nothing prunes them; delete the folder once the R2
  history is a month deep.
