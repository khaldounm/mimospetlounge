"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";
import { apiRequest } from "@/utils/api-client";
import type { ClinicalRecordDTO, ServicePickerOption } from "@/types/entities";
import { recordTypeForCategory } from "@/constants/clinical";
import ServiceSubcategorySelect, {
  CUSTOM_SUBCATEGORY,
} from "@/components/ui/ServiceSubcategorySelect";
import VitalsFields from "./VitalsFields";
import type { RecordType } from "@/types/enums";

interface Props {
  open: boolean;
  record: ClinicalRecordDTO;
  patientId: number;
  services: ServicePickerOption[];
  onClose: () => void;
  onSaved: () => void;
}

const DETAIL_LABELS: Record<string, string> = {
  chiefComplaint: "Chief complaint",
  assessment: "Assessment / diagnosis",
  plan: "Treatment plan",
  medication: "Medication",
  lotNumber: "Lot number",
  manufacturer: "Manufacturer",
  coatCondition: "Coat condition",
  procedure: "Procedure",
  findings: "Findings",
  result: "Result / outcome",
};

const SUBCATEGORY_LABEL: Record<RecordType, string> = {
  Consultation: "Service type",
  Vaccination: "Vaccine",
  Grooming: "Service",
  Treatment: "Service type",
};

export default function EditRecordDialog({ open, onClose, ...rest }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && (
        <EditRecordForm
          key={rest.record.recordId}
          onClose={onClose}
          {...rest}
        />
      )}
    </Dialog>
  );
}

type FormProps = Omit<Props, "open">;

function EditRecordForm({
  record,
  patientId,
  services,
  onClose,
  onSaved,
}: FormProps) {
  const [subcategory, setSubcategory] = useState(record.subcategory ?? "");
  const [title, setTitle] = useState(record.title);
  const [notes, setNotes] = useState(record.notes ?? "");
  const [performedAt, setPerformedAt] = useState(record.performedAt);
  const [nextDueDate, setNextDueDate] = useState(record.nextDueDate ?? "");
  // Blank when nothing was taken at the visit, and clearing a value blanks
  // the column rather than leaving the old reading on the chart.
  const [temperature, setTemperature] = useState(record.temperature ?? "");
  const [weight, setWeight] = useState(record.weight ?? "");
  const [details, setDetails] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(record.details ?? {}).map(([k, v]) => [
        k,
        String(v ?? ""),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recordType = record.recordType;

  function changeSubcategory(value: string) {
    setSubcategory(value);
    if (value === CUSTOM_SUBCATEGORY) setTitle("");
    else setTitle(value);
  }

  // A record's type is immutable once saved (see clinicalRecordUpdateSchema), so
  // unlike the add form this cannot refile the record behind the vet's back.
  // Picking a service from another type's group is allowed, it just says so, and
  // the existing recall stays on the type it was raised under.
  const pickedCategory = services.find((s) => s.name === subcategory)?.category;
  const mappedType = recordTypeForCategory(pickedCategory);
  const filingHint =
    mappedType && mappedType !== recordType
      ? `${pickedCategory} normally files as ${mappedType}. This record stays a ${recordType}, and so does its recall.`
      : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiRequest(
        `/api/patients/${patientId}/records/${record.recordId}`,
        {
          method: "PATCH",
          body: {
            subcategory:
              subcategory && subcategory !== CUSTOM_SUBCATEGORY
                ? subcategory
                : undefined,
            title,
            notes,
            performedAt,
            nextDueDate,
            temperature,
            weight,
            details,
          },
        },
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogTitle>Edit {recordType.toLowerCase()} record</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <ServiceSubcategorySelect
            label={SUBCATEGORY_LABEL[recordType]}
            value={subcategory}
            recordType={recordType}
            services={services}
            onChange={changeSubcategory}
            helperText={filingHint}
          />

          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Performed at"
              type="date"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
            <TextField
              label="Next due date"
              type="date"
              value={nextDueDate}
              onChange={(e) => setNextDueDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
            />
          </Stack>

          <VitalsFields
            temperature={temperature}
            weight={weight}
            onTemperatureChange={setTemperature}
            onWeightChange={setWeight}
          />

          {Object.keys(details).map((key) => (
            <TextField
              key={key}
              label={DETAIL_LABELS[key] ?? key}
              value={details[key]}
              onChange={(e) =>
                setDetails((d) => ({ ...d, [key]: e.target.value }))
              }
              fullWidth
            />
          ))}

          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}
