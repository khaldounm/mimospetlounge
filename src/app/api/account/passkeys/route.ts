import { NextResponse } from "next/server";
import { ApiError, handle, parseBody, requireSession } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import {
  addPasskey,
  clearChallenge,
  PasskeyError,
  readChallenge,
} from "@/lib/passkeys";
import { passkeyRegistrationBody } from "@/schemas/passkey";

// Second half of adding a passkey: the browser's registration response,
// checked against the challenge cookie and stored. Own account only: the user
// comes from the session and the challenge was bound to that same id.
export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireSession();
    const userId = session.user.userId;
    const { response } = await parseBody(request, passkeyRegistrationBody);

    const challenge = readChallenge(
      request.headers.get("cookie"),
      "register",
      userId,
    );
    if (!challenge) {
      throw new ApiError(400, "That took too long. Please try again.");
    }

    let passkey;
    try {
      passkey = await addPasskey(userId, response, challenge);
    } catch (err) {
      if (err instanceof PasskeyError) throw new ApiError(400, err.message);
      throw err;
    }

    // The label says which provider holds it; the id is what an admin would
    // need to match this row against the table. Nothing secret in either.
    await writeAudit(session, {
      action: "update",
      entity: "user",
      entityId: userId,
      changes: { passkeyAdded: passkey.label, passkeyId: passkey.id },
    });

    const res = NextResponse.json({ passkey }, { status: 201 });
    clearChallenge(res);
    return res;
  });
}
