import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { liveSession } from "@/lib/session-user";
import { hasPermission } from "@/lib/permissions";
import type { Session } from "next-auth";
import { PASSKEY_ONLY } from "@/constants/passkeys";

// Thrown by guards to short-circuit a handler with a specific HTTP response.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Every route that reads or writes a password calls this first. At a
// passkey-only clinic those routes do not exist as far as the outside can
// tell: a 404, before any session or body is looked at.
export function requirePasswordsEnabled(): void {
  if (PASSKEY_ONLY) throw new ApiError(404, "Not found");
}

// Resolves the session and asserts nothing more. For the handful of endpoints
// that belong to whoever is signed in rather than to a module: changing your own
// password is one, and gating that on a permission would mean a role could exist
// that cannot change its own credentials.
//
// Goes through liveSession(), so the role and permissions on the returned
// session are the database's answer rather than the copy frozen into the cookie
// at sign-in, and a deactivated account fails here with a 401 even though its
// cookie is still perfectly valid.
export async function requireSession(): Promise<Session> {
  const session = await liveSession();
  if (!session) throw new ApiError(401, "Unauthorized");
  return session;
}

// Resolves the session and asserts the given permission. proxy.ts also gates
// read access by path prefix, but it runs on the Edge against the token alone
// and so can be stale: this is the check that actually decides, because it is
// the one reading live permissions.
export async function requirePermission(permission: string): Promise<Session> {
  const session = await requireSession();
  if (!hasPermission(session.user, permission)) {
    throw new ApiError(403, "Forbidden");
  }
  return session;
}

// Parses a route param that must be a positive integer id, throwing
// ApiError(400) otherwise. Callers await the Next.js params promise first.
export function parseId(value: string, label = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `Invalid ${label}`);
  }
  return id;
}

// Parses + validates a JSON body against a schema, throwing ApiError(400) on
// malformed JSON or validation failure.
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    throw new ApiError(400, path ? `${path}: ${first.message}` : first.message);
  }
  return result.data;
}

// Wraps a handler so thrown ApiErrors become JSON responses; anything else
// becomes a 500.
export async function handle(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
