import type { NextAuthConfig } from "next-auth";
import type { AppUserFields } from "@/types/session";
import { SESSION_IDLE_SECONDS } from "@/constants/session";

// Edge-safe auth config: NO database / bcrypt imports here, so it can be used
// by middleware on the Edge runtime. The credentials provider (which needs
// Prisma + bcrypt) is added in auth.ts only.
export const authConfig = {
  // Trust the deploy host. Vercel sets this implicitly; needed for local
  // production builds and any self-hosted environment behind a known proxy.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    // An idle timeout, not a fixed lifetime. For the JWT strategy Auth.js
    // ignores `updateAge` completely and re-encodes the token on every session
    // read (@auth/core lib/actions/session.js only consults it on the database
    // branch), so this expiry slides forward with each request and lapses only
    // once the till has been quiet for the whole window. Do not add `updateAge`
    // alongside it expecting to throttle the cookie writes: it does nothing.
    maxAge: SESSION_IDLE_SECONDS,
  },
  providers: [],
  callbacks: {
    // Persist app-specific fields onto the JWT at sign-in. `authorize` returns
    // a user already enriched with role + permissions, so the token carries
    // everything middleware needs, so no DB call on the Edge.
    jwt({ token, user }) {
      if (user) {
        token.userId = user.userId;
        token.roleName = user.roleName;
        token.permissions = user.permissions;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        // Stamped once, here, and never touched again. Auth.js rewrites `iat`
        // and `jti` every time it re-encodes the token, which is on every
        // request, so neither can answer "when did this session begin". This
        // rides in the payload and survives the round trip.
        token.signedInAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      // The JWT is an untyped payload (Record<string, unknown>); read our
      // fields through the known shape we wrote in the jwt callback.
      const t = token as Partial<AppUserFields>;
      if (t.userId !== undefined) session.user.userId = t.userId;
      if (t.roleName !== undefined) session.user.roleName = t.roleName;
      session.user.permissions = t.permissions ?? [];
      if (t.firstName !== undefined) session.user.firstName = t.firstName;
      if (t.lastName !== undefined) session.user.lastName = t.lastName;
      if (t.signedInAt !== undefined) session.user.signedInAt = t.signedInAt;
      return session;
    },
  },
} satisfies NextAuthConfig;
