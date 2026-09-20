import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, parseBody } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { consumeEnrollment, lookupEnrollment } from "@/lib/enrollment";
import {
  addPasskey,
  clearChallenge,
  PasskeyError,
  readChallenge,
} from "@/lib/passkeys";
import { enrollVerifySchema } from "@/schemas/enrollment";

// Second half of redeeming an enrollment link: the browser's registration
// response, checked against the challenge cookie, stored as the person's
// passkey while the link is burned, in one transaction. The page then signs
// them in with the passkey they just made.
export async function POST(request: Request) {
  return handle(async () => {
    const { token, response } = await parseBody(request, enrollVerifySchema);
    const holder = await lookupEnrollment(token);
    if (!holder) {
      throw new ApiError(410, "This link has expired or was already used");
    }

    const challenge = readChallenge(
      request.headers.get("cookie"),
      "register",
      holder.userId,
    );
    if (!challenge) {
      throw new ApiError(400, "That took too long. Please try again.");
    }

    let passkey;
    try {
      passkey = await prisma.$transaction(async (tx) => {
        const burned = await consumeEnrollment(tx, holder.userId, token);
        if (!burned) {
          throw new ApiError(410, "This link has expired or was already used");
        }
        return addPasskey(holder.userId, response, challenge, tx);
      });
    } catch (err) {
      if (err instanceof PasskeyError) throw new ApiError(400, err.message);
      throw err;
    }

    await writeAudit(
      { user: { userId: holder.userId } },
      {
        action: "enroll",
        entity: "user",
        entityId: holder.userId,
        changes: {
          redeemed: true,
          passkeyAdded: passkey.label,
          passkeyId: passkey.id,
        },
      },
    );

    const res = NextResponse.json({ passkey }, { status: 201 });
    clearChallenge(res);
    return res;
  });
}
