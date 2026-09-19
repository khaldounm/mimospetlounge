import { NextResponse } from "next/server";
import { handle, requirePermission } from "@/lib/api";
import { listUpcomingBirthdays } from "@/lib/birthdays";

// Pets with a birthday in the coming week, fetched when the list is opened and
// not before, each with the wishes it would be sent. It names owners and
// carries their phone, so it takes the same permission the client list does.
// `templateId` picks which birthday template the previews are rendered with.
export async function GET(request: Request) {
  return handle(async () => {
    await requirePermission("patients:read");
    const raw = new URL(request.url).searchParams.get("templateId")?.trim();
    const templateId = raw ? Number(raw) : undefined;
    return NextResponse.json(
      await listUpcomingBirthdays({
        templateId: Number.isInteger(templateId) ? templateId : undefined,
      }),
    );
  });
}
