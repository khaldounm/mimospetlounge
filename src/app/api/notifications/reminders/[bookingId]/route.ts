import { NextResponse } from "next/server";
import { handle, parseBody, parseId, requirePermission } from "@/lib/api";
import { attachReminderTemplate } from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { reminderAttachSchema } from "@/schemas/notification";

// Attaches a reminder kind to one booking from the Upcoming row. Gated on the
// reminders permission rather than bookings:write: choosing which reminder a
// booking gets is part of running the reminders, and this touches nothing
// else on the booking. Returns the row re-rendered.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("notifications:write");
    const bookingId = parseId((await params).bookingId, "booking id");
    const data = await parseBody(request, reminderAttachSchema);

    const booking = await attachReminderTemplate(bookingId, data.templateId);

    await writeAudit(session, {
      action: "update",
      entity: "booking",
      entityId: bookingId,
      changes: { reminderTemplateId: data.templateId },
    });

    return NextResponse.json({ booking });
  });
}
