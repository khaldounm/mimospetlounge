import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  handle,
  parseBody,
  parseId,
  requirePasswordsEnabled,
  requirePermission,
} from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/users";
import { passwordSetSchema } from "@/schemas/user";

// An admin setting someone's password. Only at a clinic that keeps passwords
// on (CLINIC.passkeyOnly false); everywhere else this route is a 404. The
// new password is hashed and never logged.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return handle(async () => {
    requirePasswordsEnabled();
    const session = await requirePermission("users:write");
    const { userId } = await params;
    const id = parseId(userId);
    const { password } = await parseBody(request, passwordSetSchema);

    const existing = await prisma.user.findUnique({
      where: { userId: id },
      select: { userId: true },
    });
    if (!existing) throw new ApiError(404, "User not found");

    // Ends every session this person has open, in the same write as the new
    // hash. The usual reason to set someone else's password is that the old
    // one is no longer trusted, and leaving their existing sessions alive
    // would hand the new password to the admin while whoever already had the
    // account open carried on regardless.
    await prisma.user.update({
      where: { userId: id },
      data: {
        passwordHash: await hashPassword(password),
        sessionsValidFrom: new Date(),
        updatedAt: new Date(),
      },
    });

    await writeAudit(session, {
      action: "update",
      entity: "user",
      entityId: id,
      changes: { passwordChanged: true, sessionsEnded: true },
    });

    return NextResponse.json({ ok: true });
  });
}
