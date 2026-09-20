-- Passkeys (WebAuthn credentials), one row per registered authenticator.
--
-- Sign-in with a passkey looks the credential up by the id the authenticator
-- minted, so that id is the primary key. The private key never leaves the
-- person's phone or security key; this holds the public half and the counter
-- used to spot a cloned key. Deleting a user takes their passkeys with them.
-- Nothing is backfilled: every user keeps signing in with their password until
-- they add one.

-- CreateTable
CREATE TABLE "user_passkeys" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_type" VARCHAR(20) NOT NULL,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "aaguid" VARCHAR(36) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_passkeys_user_id_idx" ON "user_passkeys"("user_id");

-- AddForeignKey
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
