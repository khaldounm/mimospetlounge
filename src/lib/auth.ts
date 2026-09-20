import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { prisma } from "./prisma";
import { sessionUserInclude, toSessionUser } from "@/lib/users";
import {
  readChallenge,
  UnknownPasskeyError,
  verifyAssertion,
} from "@/lib/passkeys";
import {
  PASSKEY_ONLY,
  PASSKEY_PROVIDER_ID,
  PASSKEY_UNKNOWN_CODE,
} from "@/constants/passkeys";
import { authenticationResponseSchema } from "@/schemas/passkey";

// The one sign-in failure the browser can do something about: the phone
// offered a passkey this account no longer holds. The code rides back to the
// login page in the sign-in result, which then asks the browser to forget
// that credential so it stops being offered. Says nothing about who exists.
class UnknownPasskeySignin extends CredentialsSignin {
  code = PASSKEY_UNKNOWN_CODE;
}

// Two ways to prove who you are, one shape coming out. Both providers return
// toSessionUser(), so the jwt callback in auth.config.ts stamps the same fields
// whichever door someone came through, and nothing downstream can tell them
// apart.
//
// At a passkey-only clinic the password provider is not registered at all,
// which is what makes the flag a lock rather than a hidden form: a request to
// /api/auth/callback/credentials finds no provider to answer it.
const passwordProvider = Credentials({
  id: "credentials",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    const email =
      typeof credentials?.email === "string" ? credentials.email : "";
    const password =
      typeof credentials?.password === "string" ? credentials.password : "";
    if (!email || !password) return null;

    // email column is citext → match is case-insensitive at the DB level.
    const user = await prisma.user.findUnique({
      where: { email },
      include: sessionUserInclude,
    });

    if (!user || !user.passwordHash || !user.isActive) return null;

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;

    // Both stamps in the one write. The second is what the staff list
    // reads to say who is still typing a password.
    const now = new Date();
    await prisma.user.update({
      where: { userId: user.userId },
      data: { lastLoginAt: now, lastPasswordLoginAt: now },
    });

    return toSessionUser(user);
  },
});

// A passkey assertion, verified against the challenge cookie that
// /api/auth/passkey/options set moments earlier. The response arrives as a
// JSON string because Credentials fields are strings; it is the object
// @simplewebauthn/browser's startAuthentication() resolved with.
const passkeyProvider = Credentials({
  id: PASSKEY_PROVIDER_ID,
  name: "Passkey",
  credentials: { response: { type: "text" } },
  async authorize(credentials, request) {
    const raw =
      typeof credentials?.response === "string" ? credentials.response : "";
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const response = authenticationResponseSchema.safeParse(parsed);
    if (!response.success) return null;

    const challenge = readChallenge(
      request.headers.get("cookie"),
      "authenticate",
      null,
    );
    if (!challenge) return null;

    try {
      return await verifyAssertion(response.data, challenge);
    } catch (err) {
      if (err instanceof UnknownPasskeyError) {
        throw new UnknownPasskeySignin();
      }
      throw err;
    }
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: PASSKEY_ONLY
    ? [passkeyProvider]
    : [passwordProvider, passkeyProvider],
});
