import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  handle,
  parseBody,
  parseId,
  requirePermission,
} from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { issueEnrollment } from "@/lib/enrollment";
import { sendTextViaWhatsApp } from "@/lib/notifications";
import { normalizePhone } from "@/utils/phone";
import { enrollmentWhatsAppMessage } from "@/utils/whatsapp";
import { ENROLLMENT_LINK_TTL_MINUTES } from "@/constants/passkeys";
import { enrollIssueSchema } from "@/schemas/enrollment";

// "Reset access" on the staff row, and step two of "New user". Issues a
// one-time link for this person to set up a passkey, and delivers it by
// WhatsApp or hands it back to copy. Issuing wipes their passkeys and ends
// their sessions (see lib/enrollment.ts), so on a stolen phone this button
// is the whole response.
//
// Allowed on yourself: the admin whose phone was stolen still needs it, and
// there may be no other admin. It ends the caller's own session too, which
// the dialog says out loud.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("users:write");
    const { userId } = await params;
    const id = parseId(userId);
    const { channel } = await parseBody(request, enrollIssueSchema);

    const user = await prisma.user.findUnique({
      where: { userId: id },
      select: { firstName: true, phone: true, isActive: true },
    });
    if (!user) throw new ApiError(404, "User not found");
    if (!user.isActive) {
      throw new ApiError(400, "Activate the account before sending a link");
    }

    // Resolved before anything is wiped: a missing number should fail the
    // request, not leave the person with no passkeys and no link.
    const recipient =
      channel === "whatsapp" ? normalizePhone(user.phone) : null;
    if (channel === "whatsapp" && !recipient) {
      throw new ApiError(400, "This person has no valid phone number on file");
    }

    const issued = await issueEnrollment(id);

    let sentTo: string | null = null;
    if (recipient) {
      try {
        await sendTextViaWhatsApp(
          recipient,
          enrollmentWhatsAppMessage(
            user.firstName,
            issued.url,
            ENROLLMENT_LINK_TTL_MINUTES,
          ),
        );
        sentTo = recipient;
      } catch (err) {
        // The link exists and is shown to the admin either way; only the
        // delivery failed, and they can copy it instead.
        console.error("Enrollment link WhatsApp send failed", err);
      }
    }

    await writeAudit(session, {
      action: "enroll",
      entity: "user",
      entityId: id,
      changes: {
        issued: true,
        channel,
        sent: sentTo !== null,
        expiresAt: issued.expiresAt.toISOString(),
        passkeysRemoved: issued.passkeysRemoved,
        sessionsEnded: true,
      },
    });

    return NextResponse.json({
      url: issued.url,
      expiresAt: issued.expiresAt.toISOString(),
      sentTo,
      passkeysRemoved: issued.passkeysRemoved,
    });
  });
}
