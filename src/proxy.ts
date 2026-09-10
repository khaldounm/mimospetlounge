import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import {
  firstAllowedHref,
  hasPermission,
  requiredPermissionForPath,
} from "@/lib/permissions";

// Edge-safe NextAuth instance (config has no DB/bcrypt providers).
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const user = req.auth?.user ?? null;
  const isLoggedIn = Boolean(req.auth);

  // Auth.js endpoints must always pass through.
  if (path.startsWith("/api/auth")) return NextResponse.next();

  // Unauthenticated machine endpoints that authorize themselves:
  //   /api/webhooks/* : verified by provider verify token / signature
  //   /api/cron/*     : verified by the CRON_SECRET bearer token
  //   /api/public/*   : verified by a per-request signed token (e.g. invoice PDF
  //                     links fetched by WaSenderApi)
  if (
    path.startsWith("/api/webhooks") ||
    path.startsWith("/api/cron") ||
    path.startsWith("/api/public")
  ) {
    return NextResponse.next();
  }

  // Only the sign-in screen is reachable signed out. /reset-password is no
  // longer one of these: it is now the signed-in "change my password" page, so
  // reaching it without a session should bounce to login like any other page.
  const isAuthPage = path === "/login";

  if (!isLoggedIn) {
    if (isAuthPage) return NextResponse.next();
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", nextUrl);
    // Only carry a callbackUrl when it says something the login page does not
    // already assume: it defaults to "/", so tagging the root path on just
    // produces a noisy /login?callbackUrl=%2F. Deep links still round-trip.
    if (path !== "/") loginUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(loginUrl);
  }

  // Logged in: keep users out of the auth pages.
  if (isAuthPage) {
    // Except when they have just come from /api/account/signout. If that clear
    // ever fails, bouncing them back into the dashboard makes an infinite loop
    // and the app becomes unreachable, which is what happened on 2026-09-03.
    // Landing on /login while technically still holding a cookie is harmless;
    // looping is not.
    if (nextUrl.searchParams.has("signedout")) return NextResponse.next();

    return NextResponse.redirect(
      new URL(firstAllowedHref(user) ?? "/login", nextUrl),
    );
  }

  // Root → first module the user can see.
  if (path === "/") {
    return NextResponse.redirect(
      new URL(firstAllowedHref(user) ?? "/login", nextUrl),
    );
  }

  // Server-side RBAC: reject access to gated paths without the permission.
  //
  // This reads the token's copy of the permissions, which is written at sign-in
  // and never rewritten. That is safe only because the copy is never allowed to
  // drift: liveSession() ends the session as soon as it differs from the
  // database in either direction, so by the time a request gets here the token
  // either matches or the session is already over. See permissionsChanged() in
  // src/lib/session-user.ts.
  //
  // Do not be tempted to delete this gate in favour of the live checks. The
  // top-level module pages do not enforce anything, they only vary their content
  // by permission, so this is the only thing standing in front of them.
  const required = requiredPermissionForPath(path);
  if (required && !hasPermission(user, required)) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(
      new URL(firstAllowedHref(user) ?? "/login", nextUrl),
    );
  }

  return NextResponse.next();
});

export const config = {
  // Run on everything except Next internals and static files.
  //
  // /api/account/signout is excluded deliberately, not as an optimisation. This
  // proxy reads the session on every path it matches, Auth.js re-encodes and
  // re-sets the cookie on every read, and next-auth copies those Set-Cookie
  // headers onto the response after the handler has run. A route whose whole job
  // is to clear that cookie would therefore ship a fresh token alongside the
  // clear, and which one stuck would depend on the client. Returning early from
  // the function above does not help: the session read has already happened by
  // then. It has to stay out of the matcher.
  //
  // api/auth, api/cron, api/public and api/webhooks are excluded because the
  // function above already waves all four straight through. Matching them only
  // bought an invocation that ran NextResponse.next() and nothing else, and on
  // Vercel middleware bills separately from the function behind it, so every
  // PDF fetch and every inbound WhatsApp webhook was paying twice for one
  // request. Behaviour is unchanged: they authorize themselves.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/cron|api/public|api/webhooks|api/account/signout|.*\\.[\\w]+$).*)",
  ],
};
