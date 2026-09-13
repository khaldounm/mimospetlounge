"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/utils/api-client";
import { todayForDateInput } from "@/utils/format";
import {
  applyMemory,
  applyService,
  clearSitting,
  draftAfterSave,
  freshSitting,
  isDirty,
  readSitting,
  recordRequestBody,
  rememberService,
  retargetSitting,
  retypeDetails,
  writeSitting,
} from "@/utils/clinical-record";
import type { ServicePickerOption } from "@/types/entities";
import type {
  RecordDraft,
  RecordSitting,
  ServiceMemory,
} from "@/types/clinical-record";
import type { RecordType } from "@/types/enums";

interface Options {
  clientId: number;
  /** The pet whose page the dialog opened on: where every open starts. */
  patientId: number;
  services: ServicePickerOption[];
}

export interface SavedRecord {
  patientId: number;
  title: string;
}

export interface RecordSittingApi {
  draft: RecordDraft;
  recent: ServiceMemory[];
  /** Something typed since the last save: closing must not lose it. */
  dirty: boolean;
  /** When the sitting was restored from the browser store, its last activity. */
  restoredAt: number | null;
  saving: boolean;
  error: string | null;
  totalSaved: number;
  savedCount: (patientId: number) => number;
  patch: (fields: Partial<RecordDraft>) => void;
  setDetail: (key: string, value: string) => void;
  pickService: (value: string) => void;
  recallService: (memory: ServiceMemory) => void;
  setType: (type: RecordType) => void;
  switchPet: (patientId: number) => void;
  /** Posts the draft. Resolves null on failure, with `error` set and the draft untouched. */
  save: () => Promise<SavedRecord | null>;
  /** Closing: keeps the sitting when there is unsaved work, ends it otherwise. */
  finish: () => { kept: boolean };
  /** Ends the sitting whatever its state. For after a save, when nothing is unsaved. */
  discard: () => void;
  /** Start fresh: a blank form for the page's pet, memory and tallies gone. */
  reset: () => void;
}

interface State {
  sitting: RecordSitting;
  restoredAt: number | null;
}

function initialState(options: Options): State {
  const today = todayForDateInput();
  const stored = readSitting(options.clientId);
  if (stored) {
    return {
      sitting: retargetSitting(stored, options.patientId, today),
      restoredAt: stored.updatedAt,
    };
  }
  return {
    sitting: freshSitting(options.clientId, options.patientId, today),
    restoredAt: null,
  };
}

/**
 * One sitting of the add-record dialog: an owner's pets written up in one go.
 *
 * The form used to be one record per open. Eight cats with two jabs each meant
 * sixteen opens, sixteen type switches and sixteen lot numbers typed from the
 * same box. Here the dialog stays open, a save keeps whatever repeats (see
 * draftAfterSave), the pets are a click apart, and every service filed this
 * sitting is a chip that brings back how it was filed.
 *
 * Every change is mirrored to localStorage under the owner, so a backdrop
 * click, a failed request or a reload leaves the form exactly as it was, on
 * the page's pet (see retargetSitting). The
 * mirror is dropped when the sitting ends clean (Close with nothing unsaved,
 * or Start fresh) and expires on its own after RECORD_SITTING_TTL_MS.
 */
export function useRecordSitting(options: Options): RecordSittingApi {
  const { clientId, patientId, services } = options;
  const [state, setState] = useState<State>(() => initialState(options));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the sitting has been ended on purpose, so the mirror effect below
  // cannot write it straight back from the last state before the dialog
  // unmounts.
  const ended = useRef(false);

  useEffect(() => {
    if (!ended.current) writeSitting(state.sitting);
  }, [state.sitting]);

  function update(fn: (sitting: RecordSitting) => RecordSitting) {
    setState((prev) => ({
      ...prev,
      sitting: { ...fn(prev.sitting), updatedAt: Date.now() },
    }));
  }

  function patchDraft(fn: (draft: RecordDraft) => RecordDraft) {
    update((s) => ({ ...s, draft: fn(s.draft) }));
  }

  const { sitting } = state;

  return {
    draft: sitting.draft,
    recent: sitting.recent,
    dirty: isDirty(sitting),
    restoredAt: state.restoredAt,
    saving,
    error,
    totalSaved: Object.values(sitting.savedByPatient).reduce(
      (sum, n) => sum + n,
      0,
    ),
    savedCount: (id) => sitting.savedByPatient[String(id)] ?? 0,

    patch: (fields) => patchDraft((d) => ({ ...d, ...fields })),

    setDetail: (key, value) =>
      patchDraft((d) => ({ ...d, details: { ...d.details, [key]: value } })),

    pickService: (value) =>
      update((s) => ({
        ...s,
        draft: applyService(s.draft, value, services, s.recent),
      })),

    recallService: (memory) => patchDraft((d) => applyMemory(d, memory)),

    // The service list is not filtered by type any more, so a type change is
    // only a filing decision: the service and title stay, the detail fields
    // swap to the new type's set.
    setType: (type) =>
      patchDraft((d) => ({
        ...d,
        recordType: type,
        details: retypeDetails(d.details, type),
      })),

    // Retargeting a clean form is not an edit, so the baseline moves with it;
    // a dirty one keeps its content and simply belongs to the other pet now,
    // which is what "oops, that was Luna, not Mimi" needs.
    switchPet: (id) =>
      update((s) => {
        const draft = { ...s.draft, patientId: id };
        const baseline = isDirty(s) ? s.baseline : draft;
        return { ...s, draft, baseline };
      }),

    save: async () => {
      // What was on screen at the click is what is posted and what the sticky
      // state is built from, whatever gets typed while the request is out.
      const submitted = sitting.draft;
      setSaving(true);
      setError(null);
      try {
        await apiRequest(`/api/patients/${submitted.patientId}/records`, {
          method: "POST",
          body: recordRequestBody(submitted),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
        setSaving(false);
        return null;
      }
      setSaving(false);
      const after = draftAfterSave(submitted);
      const key = String(submitted.patientId);
      setState((prev) => ({
        restoredAt: null,
        sitting: {
          ...prev.sitting,
          updatedAt: Date.now(),
          draft: after,
          baseline: after,
          recent: rememberService(prev.sitting.recent, submitted),
          savedByPatient: {
            ...prev.sitting.savedByPatient,
            [key]: (prev.sitting.savedByPatient[key] ?? 0) + 1,
          },
        },
      }));
      return { patientId: submitted.patientId, title: submitted.title };
    },

    finish: () => {
      if (isDirty(sitting)) return { kept: true };
      ended.current = true;
      clearSitting(clientId);
      return { kept: false };
    },

    discard: () => {
      ended.current = true;
      clearSitting(clientId);
    },

    reset: () => {
      ended.current = false;
      clearSitting(clientId);
      setError(null);
      setState({
        sitting: freshSitting(clientId, patientId, todayForDateInput()),
        restoredAt: null,
      });
    },
  };
}
