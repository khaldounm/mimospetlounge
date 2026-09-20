import { NextResponse } from "next/server";
import { ApiError, handle, parseBody } from "@/lib/api";
import { lookupEnrollment } from "@/lib/enrollment";
import {
  newChallenge,
  registrationOptions,
  setChallengeCookie,
} from "@/lib/passkeys";
import { enrollOptionsSchema } from "@/schemas/enrollment";

// First half of redeeming an enrollment link: registration options for the
// person the token belongs to, plus the challenge cookie bound to them. No
// session; the token is the credential, and proxy.ts leaves /api/enroll
// alone for that reason.
export async function POST(request: Request) {
  return handle(async () => {
    const { token } = await parseBody(request, enrollOptionsSchema);
    const holder = await lookupEnrollment(token);
    if (!holder) {
      throw new ApiError(410, "This link has expired or was already used");
    }

    const challenge = newChallenge();
    const options = await registrationOptions(
      holder,
      challenge,
      request.headers.get("user-agent"),
    );
    const res = NextResponse.json(options);
    setChallengeCookie(res, "register", holder.userId, challenge);
    return res;
  });
}
