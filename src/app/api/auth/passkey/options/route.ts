import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import {
  authenticationOptions,
  newChallenge,
  setChallengeCookie,
} from "@/lib/passkeys";

// First half of a passkey sign-in: a fresh challenge for the browser to have
// signed, with the same challenge set on a short-lived signed cookie so the
// second half (the passkey Credentials provider in lib/auth.ts) can check it.
//
// Lives under /api/auth on purpose. proxy.ts waves that prefix through and
// leaves it out of its matcher, so this costs one function call and no
// middleware, and Next routes it here rather than to the [...nextauth]
// catch-all because a static segment wins.
//
// Nothing is looked up: no user, no database. A challenge is 32 random bytes
// and a signature, so hammering this endpoint buys nothing.
export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => {
    const challenge = newChallenge();
    const options = await authenticationOptions(challenge);
    const res = NextResponse.json(options);
    setChallengeCookie(res, "authenticate", null, challenge);
    return res;
  });
}
