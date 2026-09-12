import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, parseBody, requirePermission } from "@/lib/api";
import {
  bookingInclude,
  isDoubleBookingError,
  resolveEndsAt,
  toBookingDTO,
} from "@/lib/bookings";
import {
  assertReminderTemplate,
  defaultReminderTemplateId,
} from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { bookingCreateSchema } from "@/schemas/booking";

export async function GET(request: Request) {
  return handle(async () => {
    await requirePermission("bookings:read");

    const sp = new URL(request.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const staffId = sp.get("staffId");
    const status = sp.get("status");

    const bookings = await prisma.booking.findMany({
      where: {
        ...(from || to
          ? {
              startsAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
        ...(staffId ? { staffId: Number(staffId) } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { startsAt: "asc" },
      include: bookingInclude,
    });

    return NextResponse.json({ bookings: bookings.map(toBookingDTO) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requirePermission("bookings:write");
    const data = await parseBody(request, bookingCreateSchema);

    const patient = await prisma.patient.findFirst({
      where: { patientId: data.patientId, deletedAt: null },
    });
    if (!patient) throw new ApiError(400, "patientId: patient not found");

    const endsAt = await resolveEndsAt(data.startsAt, data.endsAt, data.typeId);

    // The reminder the booking will carry: what was picked, else the type's
    // default, copied on here so the booking keeps saying what it was taken
    // with even if the type's default changes later.
    let reminderTemplateId: number | null;
    if (data.reminderTemplateId != null) {
      await assertReminderTemplate(data.reminderTemplateId);
      reminderTemplateId = data.reminderTemplateId;
    } else {
      reminderTemplateId = await defaultReminderTemplateId(data.typeId);
    }

    try {
      const booking = await prisma.booking.create({
        data: {
          patientId: patient.patientId,
          clientId: patient.clientId,
          staffId: data.staffId,
          typeId: data.typeId,
          reminderTemplateId,
          startsAt: data.startsAt,
          endsAt,
          status: data.status ?? "Scheduled",
          notes: data.notes,
        },
        include: bookingInclude,
      });
      await writeAudit(session, {
        action: "create",
        entity: "booking",
        entityId: booking.bookingId,
        changes: {
          patientId: booking.patientId,
          staffId: data.staffId,
          typeId: data.typeId,
          reminderTemplateId,
          startsAt: data.startsAt,
          endsAt,
          status: booking.status,
        },
      });
      return NextResponse.json(
        { booking: toBookingDTO(booking) },
        { status: 201 },
      );
    } catch (err) {
      if (isDoubleBookingError(err)) {
        throw new ApiError(
          409,
          "That staff member already has a booking in this time range.",
        );
      }
      throw err;
    }
  });
}
