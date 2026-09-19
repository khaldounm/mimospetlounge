import { prisma } from "@/lib/prisma";
import { toDateOnly } from "@/utils/format";
import type { ClinicalRecordDTO, PatientDTO } from "@/types/entities";
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
