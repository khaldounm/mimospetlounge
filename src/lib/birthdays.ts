import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { clinicToday } from "@/lib/register";
import {
  dispatchNotification,
  notificationInclude,
  renderBody,
  resolveRecipient,
  toNotificationDTO,
} from "@/lib/notifications";
import { toDateOnly } from "@/utils/format";
import { shiftLocalDate } from "@/utils/date-range";
import { BIRTHDAY_WINDOW_DAYS } from "@/constants/patient";
import { BIRTHDAY_TRIGGER } from "@/constants/notification";
import type {
  BirthdayWishesDTO,
  NotificationDTO,
  UpcomingBirthdayDTO,
  UpcomingBirthdays,
} from "@/types/entities";
import type { NotificationChannel, NotificationStatus } from "@/types/enums";

// The upcoming-birthdays list: who is on it, the wishes each pet gets, sending
// them, and ticking a pet off. Everything is judged on the clinic's calendar
// day, not the server's: Vercel is UTC and the day turns three hours earlier
// there.

const DAY_MS = 24 * 60 * 60 * 1000;

type TemplateRow = Prisma.NotificationTemplateGetPayload<true>;

type BirthdayRow = {
  patient_id: number;
  name: string;
  species: string | null;
  breed: string | null;
  date_of_birth: Date;
  birthday_greeted_on: Date | null;
  client_id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
};

// ---- The window ----

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// The calendar days of the window, today first, each with the month-day key a
// date of birth is matched on. A pet born on 29 February is greeted on the
// 28th in a year that has no 29th, rather than skipped for three years out of
// four.
function birthdayWindow(from: string): { key: string; date: string }[] {
  const days: { key: string; date: string }[] = [];
  for (let i = 0; i < BIRTHDAY_WINDOW_DAYS; i++) {
    const date = shiftLocalDate(from, { days: i });
    const key = date.slice(5, 7) + date.slice(8, 10);
    days.push({ key, date });
    if (key === "0228" && !isLeapYear(Number(date.slice(0, 4)))) {
      days.push({ key: "0229", date });
    }
  }
  return days;
}

function monthDayKey(dateOfBirth: string): string {
  return dateOfBirth.slice(5, 7) + dateOfBirth.slice(8, 10);
}

// The first day a pet is on the list for this birthday. The week leading up
// to it is the only time a tick or a message could have been made for it, so
// anything stamped earlier belongs to a previous year.
function windowStart(birthday: string): string {
  return shiftLocalDate(birthday, { days: -(BIRTHDAY_WINDOW_DAYS - 1) });
}

function turnsOn(birthday: string, dateOfBirth: string): number {
  return Number(birthday.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
}

// A clinic calendar day as the DATE column stores it.
function dateOnlyValue(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

// ---- Birthday templates ----

interface BirthdayKinds {
  /** Active birthday templates, lowest id first. */
  active: TemplateRow[];
  // Every template that ever carried the trigger, active or not. Wishes sent
  // last week from a template deactivated since are still wishes sent, so
  // the "already sent" rule reads this list and not the live one.
  allIds: number[];
}

async function loadBirthdayKinds(): Promise<BirthdayKinds> {
  const templates = await prisma.notificationTemplate.findMany({
    where: { triggerEvent: BIRTHDAY_TRIGGER },
    orderBy: { templateId: "asc" },
  });
  return {
    active: templates.filter((t) => t.isActive),
    allIds: templates.map((t) => t.templateId),
  };
}

// ---- Wishes already sent ----

// The latest wishes for each pet inside its own window, from any birthday
// template there has ever been. One query over the last window's worth of
// days, then judged per pet by the clinic's date, the same way a tick is.
async function loadWishes(
  pets: { patientId: number; birthday: string }[],
  allIds: number[],
  now: Date,
): Promise<Map<number, BirthdayWishesDTO>> {
  const latest = new Map<number, BirthdayWishesDTO>();
  if (pets.length === 0 || allIds.length === 0) return latest;

  const rows = await prisma.notification.findMany({
    where: {
      patientId: { in: pets.map((p) => p.patientId) },
      templateId: { in: allIds },
      createdAt: {
        gte: new Date(now.getTime() - (BIRTHDAY_WINDOW_DAYS + 1) * DAY_MS),
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      notificationId: true,
      patientId: true,
      status: true,
      sentAt: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  const startFor = new Map(
    pets.map((p) => [p.patientId, windowStart(p.birthday)]),
  );
  for (const r of rows) {
    if (r.patientId === null || latest.has(r.patientId)) continue;
    const start = startFor.get(r.patientId);
    if (start === undefined || clinicToday(r.createdAt) < start) continue;
    latest.set(r.patientId, {
      notificationId: r.notificationId,
      status: r.status as NotificationStatus,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
      errorMessage: r.errorMessage,
    });
  }
  return latest;
}

// ---- The list ----

export interface BirthdaysQuery {
  // The template to render the previews with. Anything but a live birthday
  // template falls back to the first one, and the answer says which was used.
  templateId?: number;
}

/**
 * Every live pet with a birthday in the next BIRTHDAY_WINDOW_DAYS days, today
 * included, soonest first, each with the wishes it would be sent and whether
 * they went out already. Matched in SQL on the month and day of the date of
 * birth, so the whole catalogue is not read to find a handful of pets.
 *
 * "Seen" is judged against this year's window rather than cleared: a tick
 * counts if it was made within the week leading up to the birthday it was
 * made for, which is the only time the pet is on the list, so last year's
 * tick has expired by the time the pet is back.
 */
export async function listUpcomingBirthdays(
  query: BirthdaysQuery = {},
  now: Date = new Date(),
): Promise<UpcomingBirthdays> {
  const from = clinicToday(now);
  const days = birthdayWindow(from);
  const to = days[days.length - 1]!.date;
  const keys = days.map((d) => d.key);

  const [rows, withBirthDate, total, kinds] = await Promise.all([
    prisma.$queryRaw<BirthdayRow[]>`
      SELECT p.patient_id, p.name, p.species, p.breed, p.date_of_birth,
             p.birthday_greeted_on,
             c.client_id, c.first_name, c.last_name, c.phone, c.email
      FROM patients p
      JOIN clients c ON c.client_id = p.client_id
      WHERE p.deleted_at IS NULL
        AND p.date_of_birth IS NOT NULL
        AND to_char(p.date_of_birth, 'MMDD') = ANY(${keys})`,
    prisma.patient.count({
      where: { deletedAt: null, dateOfBirth: { not: null } },
    }),
    prisma.patient.count({ where: { deletedAt: null } }),
    loadBirthdayKinds(),
  ]);

  const template =
    kinds.active.find((t) => t.templateId === query.templateId) ??
    kinds.active[0] ??
    null;
  const channel = (template?.channel ?? "WhatsApp") as NotificationChannel;

  const dateFor = new Map(days.map((d) => [d.key, d.date]));
  const found: { row: BirthdayRow; dateOfBirth: string; birthday: string }[] =
    [];
  for (const row of rows) {
    const dateOfBirth = toDateOnly(row.date_of_birth)!;
    const birthday = dateFor.get(monthDayKey(dateOfBirth));
    if (birthday) found.push({ row, dateOfBirth, birthday });
  }

  const wishes = await loadWishes(
    found.map((f) => ({ patientId: f.row.patient_id, birthday: f.birthday })),
    kinds.allIds,
    now,
  );

  const patients: UpcomingBirthdayDTO[] = found.map(
    ({ row: r, dateOfBirth, birthday }) => {
      const turns = turnsOn(birthday, dateOfBirth);
      const greetedOn = toDateOnly(r.birthday_greeted_on);
      const seen =
        greetedOn != null &&
        greetedOn >= windowStart(birthday) &&
        greetedOn <= birthday;

      // No usable number: the row says so and Send will refuse.
      let recipient: string | null = null;
      if (template) {
        try {
          recipient = resolveRecipient(channel, {
            phone: r.phone,
            email: r.email,
          });
        } catch {
          recipient = null;
        }
      }

      return {
        patientId: r.patient_id,
        name: r.name,
        species: r.species,
        breed: r.breed,
        clientId: r.client_id,
        clientName: `${r.first_name} ${r.last_name}`,
        // As stored. The dialog normalises it for the WhatsApp link, the same
        // way the phone field does, and shows it as the counter typed it.
        clientPhone: r.phone,
        dateOfBirth,
        birthday,
        turns,
        seen,
        // The text the Send button will dispatch, so nobody sends blind.
        preview: template
          ? renderBody(template.body, {
              clientFirstName: r.first_name,
              clientLastName: r.last_name,
              patientName: r.name,
              petAge: turns,
            })
          : null,
        recipient,
        wishes: wishes.get(r.patient_id) ?? null,
      };
    },
  );
  patients.sort(
    (a, b) =>
      a.birthday.localeCompare(b.birthday) || a.name.localeCompare(b.name),
  );

  return {
    from,
    to,
    patients,
    withBirthDate,
    total,
    templates: kinds.active.map((t) => ({
      templateId: t.templateId,
      name: t.name,
    })),
    templateId: template?.templateId ?? null,
  };
}

// ---- Ticking off ----

// Ticks a pet off the list, or puts it back. Stamped with the clinic's today
// so the window check above reads it the same way it was written.
export async function setBirthdaySeen(
  patientId: number,
  seen: boolean,
  now: Date = new Date(),
): Promise<{ patientId: number; seen: boolean }> {
  const existing = await prisma.patient.findFirst({
    where: { patientId, deletedAt: null },
    select: { patientId: true },
  });
  if (!existing) throw new ApiError(404, "Patient not found");
  await prisma.patient.update({
    where: { patientId },
    data: {
      birthdayGreetedOn: seen ? dateOnlyValue(clinicToday(now)) : null,
    },
  });
  return { patientId, seen };
}

// ---- Sending wishes ----

export interface SendWishesInput {
  /** A live birthday template; the first one when absent. */
  templateId?: number;
  /** An edited text for this pet only; the template stays as it was. */
  body?: string;
}

// Creates and sends the birthday wishes for one pet on the list. One message
// per birthday: wishes already composed inside the pet's window are returned
// as they are rather than sent again, unless they failed, so a second click
// or a bulk run over a row done by hand sends nothing. A send that goes
// through ticks the pet off the list, which is what the tick was for.
//
// Only a pet whose birthday is inside the window can be wished: the endpoint
// is the list's Send button, not a way to message any owner about any pet.
export async function sendBirthdayWishes(
  patientId: number,
  input: SendWishesInput = {},
  now: Date = new Date(),
): Promise<NotificationDTO> {
  const patient = await prisma.patient.findFirst({
    where: { patientId, deletedAt: null },
    include: { client: true },
  });
  if (!patient) throw new ApiError(404, "Patient not found");
  if (patient.client.deletedAt) {
    throw new ApiError(400, "The pet's owner has been archived");
  }
  const dateOfBirth = toDateOnly(patient.dateOfBirth);
  if (!dateOfBirth) {
    throw new ApiError(400, `${patient.name} has no date of birth on file`);
  }

  const from = clinicToday(now);
  const birthday = birthdayWindow(from).find(
    (d) => d.key === monthDayKey(dateOfBirth),
  )?.date;
  if (!birthday) {
    throw new ApiError(
      400,
      `${patient.name}'s birthday is not in the next ${BIRTHDAY_WINDOW_DAYS} days`,
    );
  }

  const kinds = await loadBirthdayKinds();
  let template: TemplateRow | null = kinds.active[0] ?? null;
  if (input.templateId !== undefined) {
    // A stale pick (deactivated since the list was opened) is refused rather
    // than quietly swapped for another text than the one previewed.
    template =
      kinds.active.find((t) => t.templateId === input.templateId) ?? null;
    if (!template) throw new ApiError(400, "Pick an active birthday template");
  }
  if (!template) {
    throw new ApiError(
      400,
      "No active birthday template. Create one on the Templates tab.",
    );
  }

  // Idempotency: reuse this birthday's wishes unless they failed.
  const existing = await prisma.notification.findFirst({
    where: {
      patientId,
      templateId: { in: kinds.allIds },
      status: { not: "Failed" },
      createdAt: {
        gte: new Date(now.getTime() - (BIRTHDAY_WINDOW_DAYS + 1) * DAY_MS),
      },
    },
    orderBy: { createdAt: "desc" },
    include: notificationInclude,
  });
  if (existing && clinicToday(existing.createdAt) >= windowStart(birthday)) {
    return toNotificationDTO(existing);
  }

  const channel = (template.channel ?? "WhatsApp") as NotificationChannel;
  // An edited text still goes through the placeholders, so a name typed as
  // {{patient_name}} in the preview box comes out as the pet's name.
  const body = renderBody(input.body ?? template.body, {
    clientFirstName: patient.client.firstName,
    clientLastName: patient.client.lastName,
    patientName: patient.name,
    petAge: turnsOn(birthday, dateOfBirth),
  });
  const recipient = resolveRecipient(channel, patient.client);

  const created = await prisma.notification.create({
    data: {
      clientId: patient.clientId,
      patientId,
      templateId: template.templateId,
      channel,
      recipient,
      body,
      status: "Pending",
    },
  });

  // Send at once: the daily sweep would otherwise hold it until the morning.
  const result = await dispatchNotification(created.notificationId);
  if (result.status === "Sent" || result.status === "Delivered") {
    await prisma.patient.update({
      where: { patientId },
      data: { birthdayGreetedOn: dateOnlyValue(from) },
    });
  }
  return result;
}
