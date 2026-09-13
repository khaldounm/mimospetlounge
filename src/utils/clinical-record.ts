import {
  CUSTOM_SUBCATEGORY,
  RECORD_DETAIL_ROWS,
  RECORD_SITTING_RECENT_LIMIT,
  RECORD_SITTING_TTL_MS,
  recordTypeForCategory,
} from "@/constants/clinical";
import { RECORD_TYPES, type RecordType } from "@/types/enums";
import type {
  PatientPickerOption,
  ServicePickerOption,
} from "@/types/entities";
import type {
  RecordDraft,
  RecordSitting,
  ServiceMemory,
} from "@/types/clinical-record";
import { daysBetweenLocal, isDateInput, shiftLocalDate } from "./date-range";

// The pure half of the add-record sitting: how a draft changes when a service
// is picked, what survives a save, what a restored sitting should point at,
// and the wire shapes on both sides (the API body, the browser store). The
// hook in @/hooks/useRecordSitting holds the state and calls these.

export function blankDetails(type: RecordType): Record<string, string> {
  return Object.fromEntries(
    RECORD_DETAIL_ROWS[type].flat().map((k) => [k, ""]),
  );
}

// Carry what the two types share, drop the rest. Nothing is shared today, but
// the rule is what keeps a typed field from vanishing the day something is.
export function retypeDetails(
  details: Record<string, string>,
  type: RecordType,
): Record<string, string> {
  const next = blankDetails(type);
  for (const key of Object.keys(next)) {
    if (details[key]) next[key] = details[key];
  }
  return next;
}

export function blankDraft(
  patientId: number,
  performedAt: string,
): RecordDraft {
  return {
    patientId,
    recordType: "Consultation",
    subcategory: "",
    title: "",
    performedAt,
    nextDueDate: "",
    temperature: "",
    weight: "",
    details: blankDetails("Consultation"),
    notes: "",
  };
}

const SCALAR_KEYS = [
  "patientId",
  "recordType",
  "subcategory",
  "title",
  "performedAt",
  "nextDueDate",
  "temperature",
  "weight",
  "notes",
] as const;

export function draftEquals(a: RecordDraft, b: RecordDraft): boolean {
  if (SCALAR_KEYS.some((key) => a[key] !== b[key])) return false;
  const keys = new Set([...Object.keys(a.details), ...Object.keys(b.details)]);
  for (const key of keys) {
    if ((a.details[key] ?? "") !== (b.details[key] ?? "")) return false;
  }
  return true;
}

/** A free-typed title rather than a catalogue service. */
export function isCustomEntry(draft: RecordDraft): boolean {
  return draft.subcategory === "" || draft.subcategory === CUSTOM_SUBCATEGORY;
}

// What the form shows once a record is saved. Everything that repeats across a
// sitting stays: the date, the service and how it files, its lot and maker,
// the next due. Only what belongs to the animal on the table is cleared. The
// vitals go because they are already on the record just saved, and a second
// copy on the next one would plot the same visit twice.
export function draftAfterSave(draft: RecordDraft): RecordDraft {
  return { ...draft, temperature: "", weight: "", notes: "" };
}

// Picking a service decides three things at once: the title (its name), how
// the record files (its category's record type, when the map knows it) and,
// when the same service was already filed in this sitting, the details and due
// interval it was filed with. A service new to the sitting starts with blank
// details: a different vaccine is a different vial.
export function applyService(
  draft: RecordDraft,
  value: string,
  services: ServicePickerOption[],
  recent: ServiceMemory[],
): RecordDraft {
  if (value === "") return { ...draft, subcategory: "", title: "" };
  if (value === CUSTOM_SUBCATEGORY) {
    // A custom entry is not the previous service, so it does not inherit the
    // filing that service brought with it: the type falls back to the form's
    // default when a catalogue service had set it, and stays when the vet set
    // it by hand on a form with no service picked.
    const inherited = !isCustomEntry(draft);
    const type: RecordType = inherited ? "Consultation" : draft.recordType;
    return {
      ...draft,
      subcategory: value,
      title: "",
      recordType: type,
      details: inherited ? blankDetails(type) : draft.details,
    };
  }
  const remembered = recent.find((m) => m.subcategory === value);
  if (remembered) return applyMemory(draft, remembered);

  const picked = services.find((s) => s.name === value);
  const type = recordTypeForCategory(picked?.category) ?? draft.recordType;
  return {
    ...draft,
    subcategory: value,
    title: value,
    recordType: type,
    details: blankDetails(type),
  };
}

export function applyMemory(
  draft: RecordDraft,
  memory: ServiceMemory,
): RecordDraft {
  const canShift = memory.dueInDays != null && isDateInput(draft.performedAt);
  return {
    ...draft,
    subcategory: memory.subcategory ?? CUSTOM_SUBCATEGORY,
    title: memory.title,
    recordType: memory.recordType,
    nextDueDate: canShift
      ? shiftLocalDate(draft.performedAt, { days: memory.dueInDays ?? 0 })
      : "",
    details: { ...memory.details },
  };
}

export function memoryMatches(
  memory: ServiceMemory,
  draft: RecordDraft,
): boolean {
  return memory.subcategory
    ? memory.subcategory === draft.subcategory
    : isCustomEntry(draft) && memory.title === draft.title;
}

// The sitting's memory after a save: the record just filed goes first and
// replaces any older entry for the same service, capped so the chip row stays
// a row.
export function rememberService(
  recent: ServiceMemory[],
  saved: RecordDraft,
): ServiceMemory[] {
  const datesValid =
    isDateInput(saved.performedAt) && isDateInput(saved.nextDueDate);
  const entry: ServiceMemory = {
    subcategory: isCustomEntry(saved) ? null : saved.subcategory,
    title: saved.title,
    recordType: saved.recordType,
    dueInDays: datesValid
      ? daysBetweenLocal(saved.performedAt, saved.nextDueDate)
      : null,
    details: { ...saved.details },
  };
  const rest = recent.filter((m) => !memoryMatches(m, saved));
  return [entry, ...rest].slice(0, RECORD_SITTING_RECENT_LIMIT);
}

// The body POST /api/patients/:id/records validates. The custom sentinel is
// never sent: it becomes "no subcategory" and the typed title stands alone.
export function recordRequestBody(draft: RecordDraft) {
  return {
    recordType: draft.recordType,
    subcategory: isCustomEntry(draft) ? undefined : draft.subcategory,
    title: draft.title,
    notes: draft.notes,
    performedAt: draft.performedAt,
    nextDueDate: draft.nextDueDate,
    temperature: draft.temperature,
    weight: draft.weight,
    details: draft.details,
  };
}

// Chip labels for the owner's pets. A name is enough until two of them share
// it, and then the breed (or species) tells them apart.
export function petChipLabels(
  pets: PatientPickerOption[],
): Record<number, string> {
  const shared = new Map<string, number>();
  for (const p of pets) shared.set(p.name, (shared.get(p.name) ?? 0) + 1);
  return Object.fromEntries(
    pets.map((p) => [
      p.patientId,
      (shared.get(p.name) ?? 0) > 1
        ? `${p.name} (${p.breed ?? p.species ?? `#${p.patientId}`})`
        : p.name,
    ]),
  );
}

// ---- The sitting itself ----

export function freshSitting(
  clientId: number,
  patientId: number,
  today: string,
): RecordSitting {
  const draft = blankDraft(patientId, today);
  return {
    v: 1,
    clientId,
    updatedAt: Date.now(),
    draft,
    baseline: draft,
    recent: [],
    savedByPatient: {},
  };
}

export function isDirty(sitting: RecordSitting): boolean {
  return !draftEquals(sitting.draft, sitting.baseline);
}

// Nothing typed, nothing saved, nothing remembered: not worth a byte of
// storage, and not worth a "picked up where you left off" banner either.
export function isSittingEmpty(sitting: RecordSitting): boolean {
  return (
    !isDirty(sitting) &&
    sitting.recent.length === 0 &&
    Object.keys(sitting.savedByPatient).length === 0
  );
}

// Where a restored sitting points: the page's pet, always. The chips switch
// pets inside an open dialog; a reopened one starts from the page it was
// opened on, whatever was clicked last. Unsaved content keeps its dates
// verbatim: a save that failed yesterday is still yesterday's record. A clean
// carry-over whose date was "today" when the sitting was left becomes today
// again, with the next due moved along by the same number of days so the
// interval the vet chose is what they still see.
export function retargetSitting(
  sitting: RecordSitting,
  pagePatientId: number,
  today: string,
): RecordSitting {
  const dirty = isDirty(sitting);
  let draft: RecordDraft = { ...sitting.draft, patientId: pagePatientId };
  if (!dirty && isDateInput(draft.performedAt) && draft.performedAt < today) {
    const delta = daysBetweenLocal(draft.performedAt, today);
    draft = {
      ...draft,
      performedAt: today,
      nextDueDate: isDateInput(draft.nextDueDate)
        ? shiftLocalDate(draft.nextDueDate, { days: delta })
        : "",
    };
  }
  // The baseline moves to the same pet, so the form reads as dirty for typed
  // content only, never for a pet that changed under it.
  const baseline = dirty
    ? { ...sitting.baseline, patientId: pagePatientId }
    : draft;
  return { ...sitting, draft, baseline };
}

// ---- Browser store ----
//
// localStorage rather than sessionStorage on purpose: the counter PC's browser
// gets closed and reopened, and a draft that dies with the tab is exactly the
// draft the vet wanted back. Keyed by owner, so two owners' sittings never mix
// and a stale one cannot leak into another family's records.

function storageKey(clientId: number): string {
  return `record-sitting:${clientId}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStringMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === "string");

function isDraft(v: unknown): v is RecordDraft {
  if (!isRecord(v)) return false;
  return (
    typeof v.patientId === "number" &&
    (RECORD_TYPES as readonly string[]).includes(String(v.recordType)) &&
    SCALAR_KEYS.filter((k) => k !== "patientId" && k !== "recordType").every(
      (k) => typeof v[k] === "string",
    ) &&
    isStringMap(v.details)
  );
}

function isMemory(v: unknown): v is ServiceMemory {
  if (!isRecord(v)) return false;
  return (
    (v.subcategory === null || typeof v.subcategory === "string") &&
    typeof v.title === "string" &&
    (RECORD_TYPES as readonly string[]).includes(String(v.recordType)) &&
    (v.dueInDays === null || typeof v.dueInDays === "number") &&
    isStringMap(v.details)
  );
}

// Anything that fails the shape check or the TTL reads as "no sitting" rather
// than throwing: a stale format after a deploy must cost nothing but a blank
// form.
export function parseSitting(
  raw: string | null,
  clientId: number,
  now: number,
): RecordSitting | null {
  if (!raw) return null;
  try {
    const s: unknown = JSON.parse(raw);
    if (!isRecord(s) || s.v !== 1 || s.clientId !== clientId) return null;
    if (typeof s.updatedAt !== "number") return null;
    if (now - s.updatedAt > RECORD_SITTING_TTL_MS) return null;
    if (!isDraft(s.draft) || !isDraft(s.baseline)) return null;
    return {
      v: 1,
      clientId,
      updatedAt: s.updatedAt,
      draft: s.draft,
      baseline: s.baseline,
      recent: Array.isArray(s.recent) ? s.recent.filter(isMemory) : [],
      savedByPatient: isRecord(s.savedByPatient)
        ? Object.fromEntries(
            Object.entries(s.savedByPatient).filter(
              (e): e is [string, number] => typeof e[1] === "number",
            ),
          )
        : {},
    };
  } catch {
    return null;
  }
}

export function readSitting(clientId: number): RecordSitting | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSitting(
      window.localStorage.getItem(storageKey(clientId)),
      clientId,
      Date.now(),
    );
  } catch {
    return null;
  }
}

// Storage that refuses (private mode, a full quota) degrades to an in-memory
// sitting: the form still works, it just will not outlive the page.
export function writeSitting(sitting: RecordSitting): void {
  if (typeof window === "undefined") return;
  try {
    const key = storageKey(sitting.clientId);
    if (isSittingEmpty(sitting)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(sitting));
  } catch {
    // Nothing to do: see above.
  }
}

export function clearSitting(clientId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(clientId));
  } catch {
    // Nothing to do: see above.
  }
}
