import type { RecordType } from "./enums";

// The add-record form, as strings throughout like the inputs that hold them:
// an empty string is "not entered", which the API turns into null or leaves
// out. Typing the vitals as numbers here would make a cleared field the same
// as a zero.
export interface RecordDraft {
  patientId: number;
  recordType: RecordType;
  /** A service name, CUSTOM_SUBCATEGORY, or "" while nothing is picked. */
  subcategory: string;
  title: string;
  /** "YYYY-MM-DD". */
  performedAt: string;
  /** "YYYY-MM-DD" or "". */
  nextDueDate: string;
  temperature: string;
  weight: string;
  details: Record<string, string>;
  notes: string;
}

// How one service was last filed in this sitting, so the second cat's Rabies
// starts with the first cat's lot number and the same due interval. The due
// date is kept as a distance from the performed date rather than an absolute
// day, so it survives a sitting that runs past midnight.
export interface ServiceMemory {
  /** Null for a free-typed title (CUSTOM_SUBCATEGORY or no service). */
  subcategory: string | null;
  title: string;
  recordType: RecordType;
  dueInDays: number | null;
  details: Record<string, string>;
}

// One owner's pets being written up in one go. Persisted in the browser under
// the owner, so closing the dialog, a failed save or a reload loses nothing.
export interface RecordSitting {
  v: 1;
  clientId: number;
  /** Epoch ms of the last edit or save; the TTL counts from here. */
  updatedAt: number;
  draft: RecordDraft;
  /**
   * The form as it stood after the last save or reset: what "nothing unsaved"
   * looks like. Anything the draft differs from this by is work worth keeping.
   */
  baseline: RecordDraft;
  recent: ServiceMemory[];
  /** Records saved this sitting, per pet, keyed by patient id. */
  savedByPatient: Record<string, number>;
}
