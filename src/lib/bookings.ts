import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import type { BookingDTO, BookingTypeOption } from "@/types/entities";
import type { BookingStatus } from "@/types/enums";

// The booking types as the forms and the Templates tab see them, default
// reminder included. One place, so every select agrees on what a type offers.
export async function listBookingTypeOptions(): Promise<BookingTypeOption[]> {
  const types = await prisma.bookingType.findMany({
    orderBy: { name: "asc" },
    select: {
      typeId: true,
      name: true,
      durationMinutes: true,
      defaultTemplateId: true,
    },
  });
  return types.map((t) => ({
    typeId: t.typeId,
    name: t.name,
    durationMinutes: t.durationMinutes,
    defaultTemplateId: t.defaultTemplateId,
  }));
}

// What every booking read pulls alongside the row: the names the table shows.
// One definition, shared by the page and both API routes, so a refetch can
// never come back thinner than the server render.
export const bookingInclude = {
  patient: { select: { patientId: true, name: true } },
  client: { select: { clientId: true, firstName: true, lastName: true } },
  staff: { select: { userId: true, firstName: true, lastName: true } },
  bookingType: { select: { typeId: true, name: true } },
  reminderTemplate: { select: { templateId: true, name: true } },
} as const;

// Shape returned by the booking queries (using `bookingInclude`). Mapping to a
// flat DTO here keeps the API response and the server-rendered page identical,
// so the client table doesn't lose names when it refetches.
type BookingWithRelations = {
  bookingId: number;
  patientId: number;
  clientId: number;
  staffId: number | null;
  typeId: number | null;
  reminderTemplateId: number | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  notes: string | null;
  patient: { name: string };
  client: { firstName: string; lastName: string };
  staff: { firstName: string; lastName: string } | null;
  bookingType: { name: string } | null;
  reminderTemplate: { name: string } | null;
};

export function toBookingDTO(b: BookingWithRelations): BookingDTO {
  return {
    bookingId: b.bookingId,
    patientId: b.patientId,
    patientName: b.patient.name,
    clientId: b.clientId,
    clientName: `${b.client.firstName} ${b.client.lastName}`,
    staffId: b.staffId,
    staffName: b.staff ? `${b.staff.firstName} ${b.staff.lastName}` : null,
    typeId: b.typeId,
    typeName: b.bookingType?.name ?? null,
    reminderTemplateId: b.reminderTemplateId,
    reminderTemplateName: b.reminderTemplate?.name ?? null,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    status: b.status as BookingStatus,
    notes: b.notes,
  };
}

// Resolve the booking end time: explicit value wins; otherwise derive it from
// the selected booking type's duration. Enforces ends_at > starts_at (also a DB
// CHECK, mirrored here for a friendlier message).
export async function resolveEndsAt(
  startsAt: Date,
  endsAt: Date | undefined,
  typeId: number | undefined,
): Promise<Date> {
  let resolved = endsAt;

  if (!resolved) {
    if (!typeId) {
      throw new ApiError(400, "Provide an end time or a booking type");
    }
    const type = await prisma.bookingType.findUnique({ where: { typeId } });
    if (!type) throw new ApiError(400, "typeId: booking type not found");
    resolved = new Date(startsAt.getTime() + type.durationMinutes * 60_000);
  }

  if (resolved <= startsAt) {
    throw new ApiError(400, "End time must be after the start time");
  }
  return resolved;
}

// The DB's `no_double_booking` GiST exclusion constraint rejects overlapping
// bookings for the same staff member. Detect it so we can return a clean 409.
export function isDoubleBookingError(err: unknown): boolean {
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : "";
  return message.includes("no_double_booking");
}
