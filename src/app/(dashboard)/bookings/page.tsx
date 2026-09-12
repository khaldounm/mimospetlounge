import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  bookingInclude,
  listBookingTypeOptions,
  toBookingDTO,
} from "@/lib/bookings";
import {
  listReminderTemplates,
  toReminderTemplateOption,
} from "@/lib/notifications";
import { toDateOnly } from "@/utils/format";
import type { StaffOption } from "@/types/entities";
import BookingsTable from "@/components/bookings/BookingsTable";

export default async function BookingsPage() {
  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "bookings:write");

  // The diary opens on today onwards rather than on every booking ever taken.
  // Sorted ascending, an unscoped list put the clinic's oldest appointment at
  // the top and grew by a page a month; looking further back is what the From
  // field is for.
  //
  // Passed to the table as well so its From box agrees with what is on screen,
  // and so its first refetch asks for the same window rather than widening it.
  const from = toDateOnly(new Date())!;

  const [bookings, staff, typeOptions, reminderTemplates] = await Promise.all([
    prisma.booking.findMany({
      where: { startsAt: { gte: new Date(from) } },
      orderBy: { startsAt: "asc" },
      include: bookingInclude,
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { userId: true, firstName: true, lastName: true },
    }),
    listBookingTypeOptions(),
    listReminderTemplates(),
  ]);
  const reminderOptions = reminderTemplates.map(toReminderTemplateOption);

  const initialBookings = bookings.map(toBookingDTO);

  const staffOptions: StaffOption[] = staff.map((s) => ({
    userId: s.userId,
    label: `${s.firstName} ${s.lastName}`,
  }));

  return (
    <BookingsTable
      initialBookings={initialBookings}
      initialFrom={from}
      staffOptions={staffOptions}
      typeOptions={typeOptions}
      reminderOptions={reminderOptions}
      canWrite={canWrite}
    />
  );
}
