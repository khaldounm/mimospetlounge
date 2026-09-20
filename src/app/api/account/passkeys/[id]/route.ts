import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, requireSession } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { PASSKEY_ONLY } from "@/constants/passkeys";

// Removes one of your own passkeys. The row is looked up by id AND the
// session's user, so a body cannot name somebody else's key.
//
// Nobody is allowed to lock themselves out: once an account has no password
// (a passkey-only account), its last passkey stays until another exists. The
// admin's reset-access link is the way out of a lost phone, not this.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const session = await requireSession();
    const userId = session.user.userId;
    const { id } = await params;

    const passkey = await prisma.userPasskey.findFirst({
      where: { id, userId },
      select: { id: true, label: true },
    });
    if (!passkey) throw new ApiError(404, "Passkey not found");

    const [remaining, user] = await Promise.all([
      prisma.userPasskey.count({ where: { userId, id: { not: id } } }),
      prisma.user.findUnique({
        where: { userId },
        select: { passwordHash: true },
      }),
    ]);
    // A stored hash is only a way in while passwords are on.
    const hasPassword = !PASSKEY_ONLY && Boolean(user?.passwordHash);
    if (remaining === 0 && !hasPassword) {
      throw new ApiError(
        400,
        "This is your only way to sign in. Add another passkey first.",
      );
    }

    await prisma.userPasskey.delete({ where: { id } });

    await writeAudit(session, {
      action: "update",
      entity: "user",
      entityId: userId,
      changes: { passkeyRemoved: passkey.label, passkeyId: passkey.id },
    });

    return NextResponse.json({ ok: true });
  });
}
