import { NextResponse } from "next/server";
import { handle, requirePermission } from "@/lib/api";
import { listUpcomingBirthdays } from "@/lib/patients";

// Pets with a birthday in the coming week, fetched when the list is opened and
// not before. It names owners and carries their phone, so it takes the same
// permission the client list does.
export async function GET() {
  return handle(async () => {
    await requirePermission("patients:read");
    return NextResponse.json(await listUpcomingBirthdays());
  });
}
