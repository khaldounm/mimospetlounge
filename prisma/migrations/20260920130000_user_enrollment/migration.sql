-- One-time enrollment links, so a person can be given their first passkey (or
-- a fresh one after a lost phone) without anyone ever handing out a password.
--
-- The link carries a random token; only its SHA-256 is stored, so a copy of
-- the database cannot be turned into a working link. Single use: redeeming it
-- clears both columns. Issuing a new link overwrites them, which is how the
-- previous link is revoked. Nullable, no backfill, no cleanup job: an expired
-- hash is just refused on read.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "enrollment_token_hash" CHAR(64),
ADD COLUMN     "enrollment_expires_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "users_enrollment_token_hash_key" ON "users"("enrollment_token_hash");
