import { NextResponse } from "next/server";
import { handle, parseBody, parseId, requirePermission } from "@/lib/api";
import { sendBirthdayWishes, setBirthdaySeen } from "@/lib/birthdays";
import { writeAudit } from "@/lib/audit";
import { birthdaySeenSchema, birthdayWishesSchema } from "@/schemas/patient";

// Ticks a pet off the upcoming-birthdays list, or undoes that. A write to the
// patient row, so it takes patients:write like every other edit to it.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("patients:write");
    const patientId = parseId((await params).patientId, "patient id");
    const { seen } = await parseBody(request, birthdaySeenSchema);

    const result = await setBirthdaySeen(patientId, seen);
    await writeAudit(session, {
      action: "update",
      entity: "patient",
      entityId: patientId,
      changes: { birthdaySeen: seen },
    });
    return NextResponse.json(result);
  });
}

// Sends a pet its birthday wishes from the list, optionally with an edited
// text for this pet only. A message going out to a client, so it takes the
// permission every other send does; the tick it leaves behind rides on it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ patientId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("notifications:write");
    const patientId = parseId((await params).patientId, "patient id");
    const data = await parseBody(request, birthdayWishesSchema);

    const notification = await sendBirthdayWishes(patientId, data);
    await writeAudit(session, {
      action: "send",
      entity: "notification",
      entityId: notification.notificationId,
      changes: {
        patientId,
        birthday: true,
        status: notification.status,
        ...(data.body !== undefined ? { edited: true } : {}),
      },
    });
    return NextResponse.json({ notification });
  });
}
