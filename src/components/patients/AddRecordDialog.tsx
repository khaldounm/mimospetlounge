"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { RECORD_TYPES, type RecordType } from "@/types/enums";
import type {
  PatientPickerOption,
  ServicePickerOption,
} from "@/types/entities";
import {
  CUSTOM_SUBCATEGORY,
  RECORD_DETAIL_LABELS,
  RECORD_DETAIL_ROWS,
} from "@/constants/clinical";
import { useRecordSitting, type SavedRecord } from "@/hooks/useRecordSitting";
import {
  isCustomEntry,
  memoryMatches,
  petChipLabels,
} from "@/utils/clinical-record";
import { formatDateTime, formatTime, todayForDateInput } from "@/utils/format";
import { formatLocalDate } from "@/utils/date-range";
import ServiceAutocomplete from "@/components/ui/ServiceAutocomplete";
import DueDatePresets from "@/components/ui/DueDatePresets";
import VitalsFields from "./VitalsFields";

interface Props {
  open: boolean;
  clientId: number;
  /** The pet whose page this is. */
  patientId: number;
  /** Every live pet of the owner, this one included. */
  pets: PatientPickerOption[];
  services: ServicePickerOption[];
  onClose: () => void;
  /** A record landed for this pet; the page refreshes its own timeline. */
  onSaved: (patientId: number) => void;
}

// One sitting, not one record: the dialog stays open across the records of a
// visit and across the owner's pets, and its state outlives a close (see
// useRecordSitting). The form is mounted only while open, so it reads the
// stored sitting fresh each time it is shown.
export default function AddRecordDialog({ open, onClose, ...rest }: Props) {
  // Written by the form, read by the backdrop handler: a click outside must
  // not close a form that has unsaved content. Escape still does, and the
  // content survives that too, but a mis-click is the common accident.
  const dirty = useRef(false);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <>
      <Dialog
        open={open}
        fullWidth
        maxWidth="sm"
        onClose={(_e, reason) => {
          if (reason === "backdropClick" && dirty.current) return;
          onClose();
        }}
      >
        {open && (
          <SittingForm
            key={rest.clientId}
            onClose={onClose}
            onToast={setToast}
            dirtyRef={dirty}
            {...rest}
          />
        )}
      </Dialog>
      {/* Outside the dialog so a "draft kept" notice outlives the close, and
          above it: the snackbar layer sits over the modal one. */}
      <Snackbar
        open={toast !== null}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}

interface FormProps extends Omit<Props, "open"> {
  onToast: (message: string) => void;
  dirtyRef: React.RefObject<boolean>;
}

function SittingForm({
  clientId,
  patientId,
  pets,
  services,
  onClose,
  onSaved,
  onToast,
  dirtyRef,
}: FormProps) {
  const sitting = useRecordSitting({ clientId, patientId, services });
  const { draft } = sitting;
  const serviceInput = useRef<HTMLInputElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    dirtyRef.current = sitting.dirty;
    return () => {
      dirtyRef.current = false;
    };
  }, [sitting.dirty, dirtyRef]);

  const labels = useMemo(() => petChipLabels(pets), [pets]);
  const petName = labels[draft.patientId] ?? "";
  const custom = isCustomEntry(draft);
  const showNotes = notesOpen || draft.notes !== "";

  const restoredLabel = useMemo(() => {
    if (sitting.restoredAt === null) return null;
    const at = new Date(sitting.restoredAt);
    const iso = at.toISOString();
    return formatLocalDate(at) === todayForDateInput()
      ? formatTime(iso)
      : formatDateTime(iso);
  }, [sitting.restoredAt]);

  function announce(saved: SavedRecord) {
    onToast(`Saved ${saved.title} for ${labels[saved.patientId] ?? "the pet"}`);
    onSaved(saved.patientId);
  }

  async function saveAndContinue() {
    if (sitting.saving) return;
    const saved = await sitting.save();
    if (!saved) return;
    announce(saved);
    setNotesOpen(false);
    // The next record starts with its service.
    serviceInput.current?.focus();
  }

  async function saveAndClose() {
    if (sitting.saving) return;
    const saved = await sitting.save();
    if (!saved) return;
    announce(saved);
    // Nothing is unsaved after a save, so the sitting ends here.
    sitting.discard();
    onClose();
  }

  function close() {
    const { kept } = sitting.finish();
    if (kept) {
      onToast(`Draft kept for ${petName}. Open Add record to pick it up.`);
    }
    onClose();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void saveAndContinue();
      }}
      onKeyDown={(e) => {
        // Enter already submits from a single-line field; this is for the
        // notes textarea, where a bare Enter is a new line.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void saveAndContinue();
        }
      }}
    >
      <DialogTitle>Add record for {petName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {restoredLabel && (
            <Alert
              severity="info"
              action={
                <Button color="inherit" size="small" onClick={sitting.reset}>
                  Start fresh
                </Button>
              }
            >
              Picked up where you left off ({restoredLabel}
              {sitting.totalSaved > 0
                ? `, ${sitting.totalSaved} saved this sitting`
                : ""}
              ).
            </Alert>
          )}
          {sitting.error && <Alert severity="error">{sitting.error}</Alert>}

          {pets.length > 1 && (
            <ChipRow label="Pet">
              {pets.map((p) => {
                const n = sitting.savedCount(p.patientId);
                const active = p.patientId === draft.patientId;
                return (
                  <Chip
                    key={p.patientId}
                    label={
                      n > 0
                        ? `${labels[p.patientId]} · ${n}`
                        : labels[p.patientId]
                    }
                    color={active ? "primary" : "default"}
                    variant={active ? "filled" : "outlined"}
                    onClick={() => sitting.switchPet(p.patientId)}
                  />
                );
              })}
            </ChipRow>
          )}

          <Stack direction="row" spacing={2}>
            <Box sx={{ flex: 2, minWidth: 0 }}>
              <ServiceAutocomplete
                services={services}
                value={draft.subcategory}
                onChange={sitting.pickService}
                autoFocus
                inputRef={serviceInput}
              />
            </Box>
            <TextField
              select
              label="Record type"
              value={draft.recordType}
              onChange={(e) => sitting.setType(e.target.value as RecordType)}
              sx={{ flex: 1 }}
            >
              {RECORD_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {sitting.recent.length > 0 && (
            <ChipRow label="This sitting">
              {sitting.recent.map((memory) => {
                const active = memoryMatches(memory, draft);
                return (
                  <Chip
                    key={`${memory.subcategory ?? ""}:${memory.title}`}
                    label={memory.title}
                    size="small"
                    color={active ? "primary" : "default"}
                    variant={active ? "filled" : "outlined"}
                    onClick={() => sitting.recallService(memory)}
                  />
                );
              })}
            </ChipRow>
          )}

          {custom && (
            <TextField
              label="Title"
              value={draft.title}
              onChange={(e) => sitting.patch({ title: e.target.value })}
              required
              fullWidth
              // Picking "Other / custom" is a request to type a title; an
              // empty service on open is not, and the service keeps focus.
              autoFocus={draft.subcategory === CUSTOM_SUBCATEGORY}
            />
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              label="Performed at"
              type="date"
              value={draft.performedAt}
              onChange={(e) => sitting.patch({ performedAt: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Next due date"
              type="date"
              value={draft.nextDueDate}
              onChange={(e) => sitting.patch({ nextDueDate: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>
          <DueDatePresets
            performedAt={draft.performedAt}
            value={draft.nextDueDate}
            onChange={(nextDueDate) => sitting.patch({ nextDueDate })}
            hint={
              draft.nextDueDate ? `Raises a ${draft.recordType} recall` : ""
            }
          />

          <VitalsFields
            temperature={draft.temperature}
            weight={draft.weight}
            onTemperatureChange={(temperature) =>
              sitting.patch({ temperature })
            }
            onWeightChange={(weight) => sitting.patch({ weight })}
          />

          {RECORD_DETAIL_ROWS[draft.recordType].map((row) => (
            <Stack key={row.join("+")} direction="row" spacing={2}>
              {row.map((key) => (
                <TextField
                  key={key}
                  label={RECORD_DETAIL_LABELS[key] ?? key}
                  value={draft.details[key] ?? ""}
                  onChange={(e) => sitting.setDetail(key, e.target.value)}
                  fullWidth
                />
              ))}
            </Stack>
          ))}

          {showNotes ? (
            <TextField
              label="Notes"
              value={draft.notes}
              onChange={(e) => sitting.patch({ notes: e.target.value })}
              multiline
              minRows={2}
              fullWidth
              autoFocus={draft.notes === ""}
            />
          ) : (
            <Box>
              <Button size="small" onClick={() => setNotesOpen(true)}>
                Add notes
              </Button>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: "wrap", gap: 1 }}>
        {sitting.totalSaved > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {sitting.totalSaved} saved this sitting
          </Typography>
        )}
        <Button onClick={close} disabled={sitting.saving}>
          Close
        </Button>
        <Button
          variant="outlined"
          onClick={() => void saveAndClose()}
          disabled={sitting.saving}
        >
          Save & close
        </Button>
        <Button type="submit" variant="contained" disabled={sitting.saving}>
          {sitting.saving ? "Saving..." : "Save & add another"}
        </Button>
      </DialogActions>
    </form>
  );
}

function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Stack>
  );
}
