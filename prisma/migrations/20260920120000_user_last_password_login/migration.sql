-- When this person last signed in by typing a password.
--
-- Passkeys are replacing passwords over a grace period, and the staff list has
-- to say who is still typing one. Stamped in the same write as last_login_at,
-- only by the password provider; a passkey sign-in leaves it alone. Nullable,
-- no backfill: nobody's history is known before this.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_password_login_at" TIMESTAMPTZ(6);
