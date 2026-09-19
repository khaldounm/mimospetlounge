import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { clinicToday } from "@/lib/register";
import { toDateOnly } from "@/utils/format";
import { shiftLocalDate } from "@/utils/date-range";
import { BIRTHDAY_WINDOW_DAYS } from "@/constants/patient";
import type {
  ClinicalRecordDTO,
  PatientDTO,
  UpcomingBirthdayDTO,
  UpcomingBirthdays,
} from "@/types/entities";
import type { RecordType } from "@/types/enums";

// Relations to pull when a patient is rendered with its owner's name.
export const patientInclude = {
  client: { select: { firstName: true, lastName: true } },
} as const;

// Shape returned by the patient queries (using `patientInclude`). Mapping to a
// flat DTO here keeps the API response and the server-rendered page identical,
// so the client table doesn't lose the owner name when it refetches.
type PatientWithClient = {
  patientId: number;
  clientId: number;
  name: string;
  species: string | null;
  breed: string | null;
  dateOfBirth: Date | null;
  sex: string | null;
  isNeutered: boolean;
  microchipId: string | null;
  notes: string | null;
  needsReview: boolean;
  reviewNote: string | null;
  client: { firstName: string; lastName: string };
};

export function toPatientDTO(p: PatientWithClient): PatientDTO {
  return {
    patientId: p.patientId,
    clientId: p.clientId,
    name: p.name,
    species: p.species,
    breed: p.breed,
    dateOfBirth: toDateOnly(p.dateOfBirth),
    sex: p.sex,
    isNeutered: p.isNeutered,
    microchipId: p.microchipId,
    notes: p.notes,
    needsReview: p.needsReview,
    reviewNote: p.reviewNote,
    clientName: `${p.client.firstName} ${p.client.lastName}`,
  };
}

// ---- Clinical records ----

// Relations a clinical record needs to render: only who performed it.
export const clinicalRecordInclude = {
  performer: { select: { firstName: true, lastName: true } },
} as const;

type ClinicalRecordWithPerformer = {
  recordId: number;
  recordType: string;
  subcategory: string | null;
  title: string;
  notes: string | null;
  details: unknown;
  temperature: { toFixed(dp: number): string } | null;
  weight: { toFixed(dp: number): string } | null;
  performedAt: Date;
  nextDueDate: Date | null;
  performer: { firstName: string; lastName: string } | null;
};

/**
 * One clinical record as the screen and the printed history both read it.
 *
 * Mapped in one place because three callers need it (the patient page, the
 * refetch the timeline runs after an edit, and the medical-record PDF) and they
 * previously each built their own shape. The refetch was returning raw Prisma
 * rows, so a saved edit silently dropped the performer name and turned the
 * date-only `performedAt` into a full timestamp.
 */
export function toClinicalRecordDTO(
  r: ClinicalRecordWithPerformer,
): ClinicalRecordDTO {
  return {
    recordId: r.recordId,
    recordType: r.recordType as RecordType,
    subcategory: r.subcategory,
    title: r.title,
    notes: r.notes,
    details: (r.details as Record<string, unknown> | null) ?? null,
    // Decimals as strings, the DTO convention throughout. Fixed to the column's
    // own precision so a reading never prints more places than were recorded.
    temperature: r.temperature?.toFixed(1) ?? null,
    weight: r.weight?.toFixed(2) ?? null,
    performedAt: toDateOnly(r.performedAt) ?? "",
    nextDueDate: toDateOnly(r.nextDueDate),
    performerName: r.performer
      ? `${r.performer.firstName} ${r.performer.lastName}`
      : null,
  };
}

// ---- Patient list (paged) ----

/**
 * One page of the patient list, plus the letter buckets the jump bar needs.
 *
 * Raw SQL because the letter filter runs on upper(left(name,1)), which has its
 * own expression index, and because the bucket counts are wanted in the same
 * round trip as the page itself.
 */
export interface PatientListPage {
  patients: PatientDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** Every first letter present in the data, with how many pets sit under it. */
  letters: { letter: string; count: number }[];
  /**
   * How many pets are flagged in total, not just on this page. The filter chip
   * shows it, so it must stay the same whatever else is filtered.
   */
  reviewCount: number;
}

export interface PatientListQuery {
  q?: string;
  letter?: string;
  page?: number;
  pageSize?: number;
  /** Show only records the migration flagged for a human to confirm. */
  needsReview?: boolean;
}

export const PATIENT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

type PatientListRow = {
  patient_id: number;
  client_id: number;
  name: string;
  species: string | null;
  breed: string | null;
  date_of_birth: Date | null;
  sex: string | null;
  is_neutered: boolean;
  microchip_id: string | null;
  notes: string | null;
  needs_review: boolean;
  review_note: string | null;
  first_name: string;
  last_name: string;
  total_count: bigint;
};

export async function listPatients(
  query: PatientListQuery = {},
): Promise<PatientListPage> {
  const pageSize = Math.min(query.pageSize ?? PATIENT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  // A single letter only; anything else is ignored rather than rejected, so a
  // stale link cannot break the page.
  const letter =
    query.letter && /^[A-Za-z]$/.test(query.letter)
      ? query.letter.toUpperCase()
      : null;
  // Searching the owner's name matters as much as the pet's: staff are given
  // "Leo, Sarah's cat" and 36 pets here are called Leo.
  const search = query.q?.trim() ? `%${query.q.trim().toLowerCase()}%` : null;

  // Passed as a nullable boolean so one prepared statement serves both cases.
  const reviewOnly = query.needsReview ? true : null;

  const [rows, letters, reviewCount] = await Promise.all([
    prisma.$queryRaw<PatientListRow[]>`
      SELECT p.patient_id, p.client_id, p.name, p.species, p.breed,
             p.date_of_birth, p.sex, p.is_neutered, p.microchip_id, p.notes,
             p.needs_review, p.review_note,
             c.first_name, c.last_name,
             COUNT(*) OVER () AS total_count
      FROM patients p
      JOIN clients c ON c.client_id = p.client_id
      WHERE p.deleted_at IS NULL
        AND (${reviewOnly}::boolean IS NULL OR p.needs_review = TRUE)
        AND (${letter}::text IS NULL OR upper(left(p.name, 1)) = ${letter})
        AND (
          ${search}::text IS NULL
          OR lower(p.name) LIKE ${search}
          OR lower(c.first_name || ' ' || c.last_name) LIKE ${search}
          OR lower(coalesce(p.species, '')) LIKE ${search}
          OR lower(coalesce(p.breed, '')) LIKE ${search}
          OR lower(coalesce(c.phone, '')) LIKE ${search}
        )
      ORDER BY p.name ASC, p.patient_id ASC
      LIMIT ${pageSize} OFFSET ${offset}`,
    prisma.$queryRaw<{ letter: string; count: bigint }[]>`
      SELECT upper(left(name, 1)) AS letter, count(*) AS count
      FROM patients
      WHERE deleted_at IS NULL AND name ~ '^[A-Za-z]'
      GROUP BY 1
      ORDER BY 1`,
    prisma.patient.count({ where: { deletedAt: null, needsReview: true } }),
  ]);

  return {
    patients: rows.map((r) => ({
      patientId: r.patient_id,
      clientId: r.client_id,
      name: r.name,
      species: r.species,
      breed: r.breed,
      dateOfBirth: toDateOnly(r.date_of_birth),
      sex: r.sex,
      isNeutered: r.is_neutered,
      microchipId: r.microchip_id,
      notes: r.notes,
      needsReview: r.needs_review,
      reviewNote: r.review_note,
      clientName: `${r.first_name} ${r.last_name}`,
    })),
    total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
    page,
    pageSize,
    letters: letters.map((l) => ({ letter: l.letter, count: Number(l.count) })),
    reviewCount,
  };
}

// ---- Upcoming birthdays ----

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
};

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

/**
 * Every live pet with a birthday in the next BIRTHDAY_WINDOW_DAYS days, today
 * included, soonest first. Matched in SQL on the month and day of the date of
 * birth, so the whole catalogue is not read to find a handful of pets.
 *
 * "Seen" is judged against this year's window rather than cleared: a tick
 * counts if it was made within the week leading up to the birthday it was
 * made for, which is the only time the pet is on the list, so last year's
 * tick has expired by the time the pet is back.
 *
 * Today is the clinic's today, not the server's: Vercel is UTC and the day
 * turns three hours earlier there.
 */
export async function listUpcomingBirthdays(
  now: Date = new Date(),
): Promise<UpcomingBirthdays> {
  const from = clinicToday(now);
  const days = birthdayWindow(from);
  const to = days[days.length - 1]!.date;
  const keys = days.map((d) => d.key);

  const [rows, withBirthDate, total] = await Promise.all([
    prisma.$queryRaw<BirthdayRow[]>`
      SELECT p.patient_id, p.name, p.species, p.breed, p.date_of_birth,
             p.birthday_greeted_on,
             c.client_id, c.first_name, c.last_name, c.phone
      FROM patients p
      JOIN clients c ON c.client_id = p.client_id
      WHERE p.deleted_at IS NULL
        AND p.date_of_birth IS NOT NULL
        AND to_char(p.date_of_birth, 'MMDD') = ANY(${keys})`,
    prisma.patient.count({
      where: { deletedAt: null, dateOfBirth: { not: null } },
    }),
    prisma.patient.count({ where: { deletedAt: null } }),
  ]);

  const dateFor = new Map(days.map((d) => [d.key, d.date]));
  const patients: UpcomingBirthdayDTO[] = [];
  for (const r of rows) {
    const dateOfBirth = toDateOnly(r.date_of_birth)!;
    const birthday = dateFor.get(
      dateOfBirth.slice(5, 7) + dateOfBirth.slice(8, 10),
    );
    if (!birthday) continue;
    // Inside the week leading up to this birthday, which is the only time a
    // tick could have been made for it.
    const greetedOn = toDateOnly(r.birthday_greeted_on);
    const seen =
      greetedOn != null &&
      greetedOn >=
        shiftLocalDate(birthday, { days: -(BIRTHDAY_WINDOW_DAYS - 1) }) &&
      greetedOn <= birthday;
    patients.push({
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
      turns: Number(birthday.slice(0, 4)) - Number(dateOfBirth.slice(0, 4)),
      seen,
    });
  }
  patients.sort(
    (a, b) =>
      a.birthday.localeCompare(b.birthday) || a.name.localeCompare(b.name),
  );

  return { from, to, patients, withBirthDate, total };
}

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
      birthdayGreetedOn: seen
        ? new Date(`${clinicToday(now)}T00:00:00.000Z`)
        : null,
    },
  });
  return { patientId, seen };
}
