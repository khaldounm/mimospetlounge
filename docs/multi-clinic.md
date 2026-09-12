# One codebase, several clinics

This repository is deployed once per clinic. Each deployment is its own Vercel
project with its own database, its own environment, and its own identity. A
push to `main` builds every project, so one update reaches every clinic.

## How a deployment knows who it is

`NEXT_PUBLIC_CLINIC_ID` selects a profile from `src/constants/clinics/`:

| id       | profile                           | database          |
| -------- | --------------------------------- | ----------------- |
| `mimo`   | `src/constants/clinics/mimo.ts`   | Mimo's Supabase   |
| `nadine` | `src/constants/clinics/nadine.ts` | Nadine's Supabase |

The profile holds everything that differs between clinics: name, logos,
address, phone, email, website, invoice terms, whether a roll printer sits at
the counter, the list of product modules switched on, and the prefix of its
backup files. `src/constants/clinic.ts` exports the selected profile as
`CLINIC`; all code reads that and nothing else. A missing or unknown id throws
at module load, which fails the build on purpose.

`FEATURES` in the environment still overrides the profile's module list
wholesale, for demos. Unset means the profile decides.

Logos live under `public/clinics/<id>/` and both sets ship in every build;
only the selected profile's paths are referenced.

## Per-project environment (Vercel)

| variable                                         | notes                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CLINIC_ID`                          | `mimo` or `nadine`                                                                         |
| `DATABASE_URL`                                   | that clinic's transaction pooler (6543, `pgbouncer=true`)                                  |
| `DIRECT_URL`                                     | that clinic's session pooler (5432); the build runs migrations through it                  |
| `AUTH_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | per clinic; the URL is that clinic's domain                                                |
| `CRON_SECRET`                                    | per clinic                                                                                 |
| `WASENDER_API_KEY`                               | that clinic's own WhatsApp sender; the other clinic's key would send from the wrong number |
| `FEATURES`                                       | optional override, normally unset                                                          |

Vercel Bot Protection must carry the custom Bypass rule for the WhatsApp
document fetch on every project, or document sends get a 429 challenge.

## Migrations run in the build

Every Vercel project's Build Command is overridden to `pnpm vercel` (Settings >
Build and Deployment, Override on). Anything else, such as the earlier
`pnpm db:generate && next build`, bypasses the script and silently stops
migrating. The `vercel` script runs `prisma migrate deploy` before
`next build` when `VERCEL_ENV` is `production`, so each project migrates its
own database and the code that needs the new schema goes live right after it. A failing
migration fails the build and the previous deployment stays up. Preview
builds never migrate anything.

Because one migration now runs against every clinic's data, every migration
must be safe on all of them:

- no `NOT NULL` column without a default on a table that has rows anywhere;
- no data statement that assumes one clinic's vocabulary (category names,
  service names, client names);
- a data backfill inside a migration is a no-op on a database that was rebuilt
  and seeded afterwards, so do not rely on one for correctness.

A migration that needs data-aware SQL (`client_account_and_salutation` added
a `NOT NULL` column to `payments`, which only works on an empty table) is
applied by hand with `migrate resolve` before the push, on every database
that needs it.

## The database says who it is

Each database carries one settings row, `clinic.id`, written once:

```sql
INSERT INTO settings (key, value) VALUES ('clinic.id', 'mimo');
```

`src/lib/clinic-guard.ts` compares it with what a script expects before the
script touches a row. The seeds and the legacy import carry Mimo's data and
refuse any other database outright; `seed.ts` claims a fresh database on
first run; `add-user.ts` requires the database to match the build's clinic.
The application never reads the row, so a missing one cannot take a
deployment down. Prove the connection from inside it before writing the row:

```sql
SELECT current_database(), inet_server_addr();
```

## Nightly backups

`.github/workflows/db-backup.yml` is a matrix with one entry per clinic: its
R2 bucket, and the names of the secrets holding its `DIRECT` connection
string, passphrase and R2 API token. Backups go to Cloudflare R2, a different
provider from the database on purpose. A clinic whose secrets are not set yet
is skipped with a notice, not failed. Setup is in `docs/backup-setup.md`.

## Adding a clinic

1. Add `src/constants/clinics/<id>.ts` and register it in
   `src/constants/clinic.ts` and the `ClinicId` type.
2. Put its logos under `public/clinics/<id>/`.
3. Create its R2 bucket, add a matrix entry to the backup workflow and set
   its secrets (`docs/backup-setup.md`).
4. Create the Vercel project from this repository with the environment above.
5. Write the `clinic.id` row into its database.
