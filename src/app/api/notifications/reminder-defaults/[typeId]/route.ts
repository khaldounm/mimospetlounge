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
import { assertReminderTemplate } from "@/lib/notifications";
import { reminderDefaultSchema } from "@/schemas/notification";
import type { BookingTypeOption } from "@/types/entities";

// Sets the reminder template a booking type hands to its new bookings. Lives
// under /api/notifications because it is reminder configuration, set from the
// Templates tab: someone who runs the reminders does not need bookings:write
// to decide what a grooming reminder says.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ typeId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("notifications:write");
    const typeId = parseId((await params).typeId, "type id");
    const data = await parseBody(request, reminderDefaultSchema);

    const type = await prisma.bookingType.findUnique({ where: { typeId } });
    if (!type) throw new ApiError(404, "Booking type not found");

    if (data.templateId !== null) await assertReminderTemplate(data.templateId);

    const updated = await prisma.bookingType.update({
      where: { typeId },
      data: { defaultTemplateId: data.templateId },
      select: {
        typeId: true,
        name: true,
        durationMinutes: true,
        defaultTemplateId: true,
      },
    });

    await writeAudit(session, {
      action: "update",
      entity: "booking_type",
      entityId: typeId,
      changes: { defaultTemplateId: data.templateId },
    });

    const option: BookingTypeOption = updated;
    return NextResponse.json({ type: option });
  });
}
