// One-time enrollment links: how a person gets their first passkey, or a
// fresh one after a lost phone, without anyone ever handing out a password.
//
// An admin issues a link from the staff list. The link carries a random
// 32-byte token; the database keeps only its SHA-256 and an expiry, so a
// dump of the table cannot be turned into a working link. Redeeming it stores
// the passkey and clears the columns in one transaction, so it works once.
// Issuing a new link overwrites the columns, which revokes the old one.
//
// Issuing is also the recovery action. It wipes every passkey the person
// holds and ends every session they have open, so a stolen phone stops being
// a way in the moment the admin presses the button, before the new link is
// even delivered. Their password, while passwords still exist, is not
// touched: it was never on the phone.
//
// Nobody can request a link for themselves from the sign-in screen. The
// button is behind users:write, so a stolen phone number is not enough.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ENROLLMENT_LINK_TTL_MINUTES } from "@/constants/passkeys";

// The shape of a token in a link: base64url of 32 random bytes, 43 chars.
export const ENROLLMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newEnrollmentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashEnrollmentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function enrollmentExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + ENROLLMENT_LINK_TTL_MINUTES * 60_000);
}

// The link itself, on the same origin the passkey will be bound to.
export function enrollmentUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
  if (!base) throw new Error("NEXTAUTH_URL is not set");
  return `${new URL(base).origin}/enroll?t=${token}`;
}

export interface IssuedEnrollment {
  url: string;
  expiresAt: Date;
  passkeysRemoved: number;
}

// Issues a link for one person: wipe their passkeys, end their sessions, set
// the new token. One transaction, so there is no moment where the old
// passkeys are gone but the link does not exist yet, or the reverse.
export async function issueEnrollment(
  userId: number,
): Promise<IssuedEnrollment> {
  const token = newEnrollmentToken();
  const now = new Date();
  const expiresAt = enrollmentExpiry(now);

  const passkeysRemoved = await prisma.$transaction(async (tx) => {
    const removed = await tx.userPasskey.deleteMany({ where: { userId } });
    await tx.user.update({
      where: { userId },
      data: {
        enrollmentTokenHash: hashEnrollmentToken(token),
        enrollmentExpiresAt: expiresAt,
        sessionsValidFrom: now,
      },
    });
    return removed.count;
  });

  return { url: enrollmentUrl(token), expiresAt, passkeysRemoved };
}

export interface EnrollmentHolder {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
}

// Who a token belongs to, or null when it is malformed, unknown, expired, or
// the account is inactive. Does not consume it: the page calls this to say
// hello, the options route to build the ceremony, and the verify route once
// more before storing the key.
export async function lookupEnrollment(
  token: string,
): Promise<EnrollmentHolder | null> {
  if (!ENROLLMENT_TOKEN_PATTERN.test(token)) return null;
  const user = await prisma.user.findUnique({
    where: { enrollmentTokenHash: hashEnrollmentToken(token) },
    select: {
      userId: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      enrollmentExpiresAt: true,
    },
  });
  if (!user || !user.isActive) return null;
  if (!user.enrollmentExpiresAt || user.enrollmentExpiresAt < new Date()) {
    return null;
  }
  return {
    userId: user.userId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

// Burns the token. Called inside the transaction that stores the passkey, so
// the link cannot be redeemed twice and cannot be redeemed without a key
// being stored. The where clause carries the hash again: if two redemptions
// race, the second finds nothing to clear and the count says so.
export async function consumeEnrollment(
  tx: { user: { updateMany: typeof prisma.user.updateMany } },
  userId: number,
  token: string,
): Promise<boolean> {
  const result = await tx.user.updateMany({
    where: { userId, enrollmentTokenHash: hashEnrollmentToken(token) },
    data: { enrollmentTokenHash: null, enrollmentExpiresAt: null },
  });
  return result.count === 1;
}
