import { NextResponse } from "next/server";
import { handle, parseBody, parseId, requirePermission } from "@/lib/api";
import { setBirthdaySeen } from "@/lib/patients";
import { writeAudit } from "@/lib/audit";
import { birthdaySeenSchema } from "@/schemas/patient";

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
