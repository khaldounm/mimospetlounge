import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  handle,
  parseBody,
  requirePasswordsEnabled,
  requireSession,
} from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { hashPassword, verifyPassword } from "@/lib/users";
import { passwordChangeSchema } from "@/schemas/user";

// Changing your OWN password. Deliberately separate from the admin reset at
// /api/users/[userId]/password: that one is gated on users:write and takes no
// current password, because an admin resetting a forgotten password does not
// have one. This one is open to anyone signed in, works only on their own row,
// and proves identity with the existing password first.
export async function PATCH(request: Request) {
  return handle(async () => {
    requirePasswordsEnabled();
    const session = await requireSession();
    // The id comes from the session, never from the request, so there is no
    // shape of body that changes somebody else's password.
    const userId = session.user.userId;
    const data = await parseBody(request, passwordChangeSchema);

    const user = await prisma.user.findUnique({
      where: { userId },
      select: { passwordHash: true, isActive: true },
    });
    // A token outlives the row it describes: someone deactivated mid-session
    // still holds a valid cookie until it expires.
    if (!user || !user.isActive) throw new ApiError(403, "Forbidden");
    if (!user.passwordHash) {
      throw new ApiError(400, "This account has no password set");
    }

    if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
      throw new ApiError(400, "Current password is not correct");
    }
    if (data.currentPassword === data.newPassword) {
      throw new ApiError(400, "The new password must be different");
    }

    await prisma.user.update({
      where: { userId },
      data: {
        passwordHash: await hashPassword(data.newPassword),
        updatedAt: new Date(),
      },
    });

    // Same shape the admin reset writes, plus who did it to whom. Neither the
    // old nor the new password goes anywhere near the log.
    await writeAudit(session, {
      action: "update",
      entity: "user",
      entityId: userId,
      changes: { passwordChanged: true, byOwner: true },
    });

    return NextResponse.json({ ok: true });
  });
}
