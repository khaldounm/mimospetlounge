import { NextResponse } from "next/server";
import { handle, requireSession } from "@/lib/api";
import {
  newChallenge,
  registrationOptions,
  setChallengeCookie,
} from "@/lib/passkeys";

// First half of adding a passkey to your own account: registration options
// for the signed-in user plus the challenge cookie the verification will
// demand. The challenge is bound to this user, so it cannot be redeemed to
// register a key against anyone else.
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireSession();
    const user = session.user;

    const challenge = newChallenge();
    const options = await registrationOptions(
      {
        userId: user.userId,
        email: user.email ?? "",
        firstName: user.firstName,
        lastName: user.lastName,
      },
      challenge,
      request.headers.get("user-agent"),
    );
    const res = NextResponse.json(options);
    setChallengeCookie(res, "register", user.userId, challenge);
    return res;
  });
}
