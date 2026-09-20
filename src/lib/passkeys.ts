// Passkeys (WebAuthn) on top of the existing Auth.js session.
//
// Nothing downstream of sign-in knows a passkey was involved. A verified
// assertion produces the same enriched user the password provider produces,
// the jwt callback stamps it the same way, and liveSession(), force sign-out
// and the idle window all carry on as before. This file owns the two
// ceremonies (register, authenticate) and the challenge that ties each
// options call to the verification that follows it.
//
// The challenge never touches the database. It rides in a signed, httpOnly,
// two-minute cookie bound to its purpose (and, for registration, the user), so
// a registration challenge cannot be replayed as a sign-in and a challenge
// minted for one person cannot register a key for another.
//
// This module is imported by lib/auth.ts, so it must not import lib/api (which
// reaches auth through session-user) or the module graph becomes a cycle.
// Failures are thrown as PasskeyError and mapped to a 400 by the route.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { NextResponse } from "next/server";
import type { User as SessionUser } from "next-auth";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sessionUserInclude, toSessionUser } from "@/lib/users";
import { CLINIC } from "@/constants/clinic";
import {
  PASSKEY_CEREMONY_TIMEOUT_MS,
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_CHALLENGE_TTL_SECONDS,
  PASSKEY_PROVIDER_NAMES,
} from "@/constants/passkeys";
import type { PasskeyDTO } from "@/types/passkeys";

export class PasskeyError extends Error {}

// The assertion named a credential we do not hold: it was removed from the
// account (or never belonged to this clinic) while the phone still keeps it.
// Told apart from a failed check so the browser can be asked to forget it.
export class UnknownPasskeyError extends PasskeyError {}

// ---- Relying party ----

// The origin passkeys are bound to. Pinned from NEXTAUTH_URL, which every
// deployment already sets to its own domain, rather than read off the Host
// header: a passkey registered for one clinic's domain must only ever be
// accepted on that domain, and the request is not the thing to ask.
function relyingParty(): { id: string; origin: string; secure: boolean } {
  const raw = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
  if (!raw) throw new Error("NEXTAUTH_URL is not set");
  const url = new URL(raw);
  return {
    id: url.hostname,
    origin: url.origin,
    secure: url.protocol === "https:",
  };
}

// ---- Challenge cookie ----

type ChallengePurpose = "register" | "authenticate";

function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Challenges are handled as base64url strings end to end: that is the form the
// browser echoes back in clientDataJSON and the form the verifier compares. The
// options builders want bytes, and would otherwise treat a string as text to
// encode, which is a different challenge from the one we then expect.
export function newChallenge(): string {
  return randomBytes(32).toString("base64url");
}

function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  return bytesOf(Buffer.from(challenge, "base64url"));
}

// The library types its byte inputs as Uint8Array<ArrayBuffer>; a Node Buffer
// is a Uint8Array over an ArrayBufferLike, so its bytes are copied into a
// plain one rather than cast.
function bytesOf(buffer: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(buffer.byteLength));
  out.set(buffer);
  return out;
}

// Sets the challenge on the response that carries the options it belongs to,
// signed and bound to its purpose and person.
export function setChallengeCookie(
  res: NextResponse,
  purpose: ChallengePurpose,
  userId: number | null,
  challenge: string,
): void {
  const expiresMs = Date.now() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000;
  const body = `${purpose}.${userId ?? 0}.${expiresMs}.${challenge}`;
  res.cookies.set(PASSKEY_CHALLENGE_COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: relyingParty().secure,
    path: "/",
    maxAge: PASSKEY_CHALLENGE_TTL_SECONDS,
  });
}

export function clearChallenge(res: NextResponse): void {
  res.cookies.set(PASSKEY_CHALLENGE_COOKIE, "", { path: "/", maxAge: 0 });
}

// Reads the challenge back off a raw Cookie header. Takes the header rather
// than next/headers because the sign-in path runs inside Auth.js's authorize(),
// which only has the Request. Null when missing, expired, tampered with, or
// minted for a different purpose or person.
export function readChallenge(
  cookieHeader: string | null,
  purpose: ChallengePurpose,
  userId: number | null,
): string | null {
  const value = parseCookie(cookieHeader, PASSKEY_CHALLENGE_COOKIE);
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [gotPurpose, gotUserId, gotExpires, challenge, sig] = parts;

  const body = `${gotPurpose}.${gotUserId}.${gotExpires}.${challenge}`;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  if (gotPurpose !== purpose) return null;
  if (gotUserId !== String(userId ?? 0)) return null;
  const expiresMs = Number(gotExpires);
  if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) return null;
  return challenge;
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// ---- Registration ----

// The WebAuthn user handle: opaque, stable per user, no PII. Stable matters:
// a phone that already holds a passkey for this handle replaces it instead of
// listing the same account twice.
function userHandle(userId: number): Uint8Array<ArrayBuffer> {
  return bytesOf(new TextEncoder().encode(`${CLINIC.id}:${userId}`));
}

// The tills are shared Windows PCs on one Windows login. A passkey saved into
// that Windows Hello is unlocked by the PIN everyone at the counter knows, so
// anyone could pick a colleague's and sign in as them. On Windows the ceremony
// is therefore restricted to cross-platform authenticators, which in practice
// means "scan this with your phone". Everywhere else (the phone itself, a
// personal laptop) the built-in authenticator is the right place for it.
function preferredAuthenticatorType(
  userAgent: string | null,
): "remoteDevice" | undefined {
  return userAgent && /Windows NT/.test(userAgent) ? "remoteDevice" : undefined;
}

export async function registrationOptions(
  user: { userId: number; email: string; firstName: string; lastName: string },
  challenge: string,
  userAgent: string | null,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await prisma.userPasskey.findMany({
    where: { userId: user.userId },
    select: { id: true, transports: true },
  });
  const rp = relyingParty();
  return generateRegistrationOptions({
    rpName: CLINIC.name,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: `${user.firstName} ${user.lastName}`.trim(),
    userID: userHandle(user.userId),
    challenge: challengeBytes(challenge),
    timeout: PASSKEY_CEREMONY_TIMEOUT_MS,
    attestationType: "none",
    excludeCredentials: existing,
    authenticatorSelection: {
      // Discoverable, so sign-in needs no email typed first; and always
      // unlocked by a biometric or PIN, never by mere possession.
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: preferredAuthenticatorType(userAgent),
  });
}

// Verifies a registration response and stores the credential. Throws
// PasskeyError when the browser's answer does not check out. Takes the client
// to write with, so the enrollment route can store the key inside the same
// transaction that burns the link.
export async function addPasskey(
  userId: number,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  db: Pick<Prisma.TransactionClient, "userPasskey"> = prisma,
): Promise<PasskeyDTO> {
  const rp = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new PasskeyError(
      err instanceof Error ? err.message : "Passkey could not be verified",
    );
  }
  if (!verification.verified) {
    throw new PasskeyError("Passkey could not be verified");
  }

  const { credential, aaguid, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  const transports = credential.transports ?? [];

  const row = await db.userPasskey.create({
    data: {
      id: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      aaguid,
      label: labelFor(aaguid, transports),
    },
  });
  return toPasskeyDTO(row);
}

// ---- Authentication ----

// Options for a discoverable sign-in: no allowCredentials, so the browser
// offers whichever passkeys it holds for this site and the person picks.
export function authenticationOptions(
  challenge: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: relyingParty().id,
    challenge: challengeBytes(challenge),
    timeout: PASSKEY_CEREMONY_TIMEOUT_MS,
    userVerification: "required",
  });
}

// Verifies an assertion and returns the user it belongs to, shaped exactly as
// the password provider shapes its result, or null. One select by primary key
// (the credential id the assertion carries) and one update, which also stamps
// the user's last sign-in: the same two queries a password sign-in costs,
// minus the bcrypt. Throws UnknownPasskeyError when no such credential exists.
export async function verifyAssertion(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<SessionUser | null> {
  const passkey = await prisma.userPasskey.findUnique({
    where: { id: response.id },
    include: { user: { include: sessionUserInclude } },
  });
  if (!passkey) throw new UnknownPasskeyError("Unknown passkey");
  if (!passkey.user.isActive) return null;

  const rp = relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: bytesOf(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  const now = new Date();
  await prisma.userPasskey.update({
    where: { id: passkey.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      lastUsedAt: now,
      user: { update: { lastLoginAt: now } },
    },
  });

  return toSessionUser(passkey.user);
}

// ---- Listing ----

export async function listPasskeys(userId: number): Promise<PasskeyDTO[]> {
  const rows = await prisma.userPasskey.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toPasskeyDTO);
}

function labelFor(aaguid: string, transports: string[]): string {
  const named = PASSKEY_PROVIDER_NAMES[aaguid];
  if (named) return named;
  if (transports.some((t) => t === "usb" || t === "nfc")) return "Security key";
  return "Passkey";
}

function toPasskeyDTO(row: {
  id: string;
  label: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}): PasskeyDTO {
  return {
    id: row.id,
    label: row.label,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}
