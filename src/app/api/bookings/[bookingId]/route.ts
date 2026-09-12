import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, parseBody, requirePermission } from "@/lib/api";
import {
  bookingInclude,
  isDoubleBookingError,
  resolveEndsAt,
  toBookingDTO,
} from "@/lib/bookings";
import { assertReminderTemplate } from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { bookingUpdateSchema } from "@/schemas/booking";

async function getBookingId(params: Promise<{ bookingId: string }>) {
  const { bookingId } = await params;
  const id = Number(bookingId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid id");
  return id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handle(async () => {
    await requirePermission("bookings:read");
    const bookingId = await getBookingId(params);

    const booking = await prisma.booking.findUnique({
      where: { bookingId },
      include: bookingInclude,
    });
    if (!booking) throw new ApiError(404, "Booking not found");

    return NextResponse.json({ booking: toBookingDTO(booking) });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("bookings:write");
    const bookingId = await getBookingId(params);
    const data = await parseBody(request, bookingUpdateSchema);

    const existing = await prisma.booking.findUnique({ where: { bookingId } });
    if (!existing) throw new ApiError(404, "Booking not found");

    const updateData: Prisma.BookingUncheckedUpdateInput = {};
    if (data.staffId !== undefined) updateData.staffId = data.staffId;
    if (data.typeId !== undefined) updateData.typeId = data.typeId;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;
    // null puts the booking back on its type's default at send time.
    if (data.reminderTemplateId !== undefined) {
      if (data.reminderTemplateId !== null) {
        await assertReminderTemplate(data.reminderTemplateId);
      }
      updateData.reminderTemplateId = data.reminderTemplateId;
    }

    // Recompute the end time whenever any timing input changes.
    const timingChanged =
      data.startsAt !== undefined ||
      data.endsAt !== undefined ||
      data.typeId !== undefined;
    if (timingChanged) {
      const startsAt = data.startsAt ?? existing.startsAt;
      const typeId =
        data.typeId !== undefined
          ? data.typeId
          : (existing.typeId ?? undefined);
      updateData.startsAt = startsAt;
      updateData.endsAt = await resolveEndsAt(startsAt, data.endsAt, typeId);
    }

    try {
      const booking = await prisma.booking.update({
        where: { bookingId },
        data: updateData,
        include: bookingInclude,
      });
      await writeAudit(session, {
        action: "update",
        entity: "booking",
        entityId: bookingId,
        changes: data,
      });
      return NextResponse.json({ booking: toBookingDTO(booking) });
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
