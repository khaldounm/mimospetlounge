import { RECORD_TYPES, type RecordType } from "@/types/enums";

// Two vocabularies meet here, and they are not the same list.
//
//   RECORD_TYPES        the four clinical-record kinds. Fixed, CHECK-constrained
//                       on clinical_records.record_type AND reminders.record_type,
//                       and they are what the Notifications recall tabs read.
//   Service.category    free text (VARCHAR 100). The catalogue uses the clinic's
//                       own words: Diagnostics, Surgery, Dental, Veterinary,
//                       Grooming, Vaccination.
//
// The record dialogs used to join them with `service.category === recordType`,
// which only ever matched Grooming by coincidence of naming and left most of the
// catalogue unpickable on a clinical record.
//
// This map is the join. It runs category -> record type, many to one, and it
// deliberately lands only on the existing four: no new record types means no
// CHECK migration, no new recall tabs, and no reinterpreting historical records.
//
// Because a recall's type IS the record's type, this map is also what routes a
// reminder. File a dental service and the record becomes a Treatment, so the
// recall lands in the Treatments tab on the Treatment lead window. Reminders
// need no knowledge of service categories at all.
const CATEGORY_TO_RECORD_TYPE: Record<string, RecordType> = {
  vaccination: "Vaccination",
  grooming: "Grooming",
  dental: "Treatment",
  diagnostics: "Treatment",
  surgery: "Treatment",
  veterinary: "Treatment",
  // A record type used verbatim as a category maps to itself. The service form
  // still offers only the four record-type names, so anything added there would
  // otherwise land unmapped. No catalogue service is a Consultation today, which
  // is why that group reads empty; the entry costs nothing and is correct the
  // day one exists.
  consultation: "Consultation",
  treatment: "Treatment",
};

// Categories arrive as free text typed by staff, so match on a lenient key
// rather than the exact string: case and a trailing plural should not decide
// whether a recall is raised. "Vaccinations", "vaccination" and "Vaccination"
// are one category.
export function normalizeCategory(category: string): string {
  const key = category.trim().toLowerCase();
  return key.endsWith("s") ? key.slice(0, -1) : key;
}

const NORMALIZED: Record<string, RecordType> = Object.fromEntries(
  Object.entries(CATEGORY_TO_RECORD_TYPE).map(([k, v]) => [
    normalizeCategory(k),
    v,
  ]),
);

// The record type a service of this category belongs to, or null when the map
// has never heard of it. Null is a normal answer, not an error: a category added
// after this map was written stays fully usable, it just cannot pick the record
// type on the vet's behalf.
export function recordTypeForCategory(
  category: string | null | undefined,
): RecordType | null {
  if (!category) return null;
  return NORMALIZED[normalizeCategory(category)] ?? null;
}

// Reverse view, for ranking the service picker on a record of a given type.
export function categoriesForRecordType(recordType: RecordType): string[] {
  return Object.entries(CATEGORY_TO_RECORD_TYPE)
    .filter(([, type]) => type === recordType)
    .map(([category]) => category);
}

// Every category the map accounts for, used to spot drift against the live
// catalogue. Anything outside this set is new and currently unmapped.
export const MAPPED_CATEGORIES: ReadonlySet<string> = new Set(
  RECORD_TYPES.flatMap(categoriesForRecordType).map(normalizeCategory),
);
