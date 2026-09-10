"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/AppLink";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { apiRequest } from "@/utils/api-client";
import { formatDate } from "@/utils/format";
import type {
  ClinicalRecordDTO,
  MedicalRecordDTO,
  PatientDTO,
  ServicePickerOption,
} from "@/types/entities";
import PatientFormDialog from "./PatientFormDialog";
import AddRecordDialog from "./AddRecordDialog";
import ClinicalTimeline from "./ClinicalTimeline";
import VitalsChart from "./VitalsChart";

interface Props {
  patient: PatientDTO;
  clientName: string;
  initialRecords: ClinicalRecordDTO[];
  services: ServicePickerOption[];
  canWritePatient: boolean;
  canReadClinical: boolean;
  canWriteClinical: boolean;
  /** Whether this user may send the record to the owner over WhatsApp. */
  canSendRecord: boolean;
  clientPhone: string | null;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body1">{value || "-"}</Typography>
    </Box>
  );
}

export default function PatientDetail({
  patient,
  clientName,
  initialRecords,
  services,
  canWritePatient,
  canReadClinical,
  canWriteClinical,
  canSendRecord,
  clientPhone,
}: Props) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [editOpen, setEditOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  async function reloadRecords() {
    const data = await apiRequest<{ records: ClinicalRecordDTO[] }>(
      `/api/patients/${patient.patientId}/records`,
    );
    setRecords(data.records);
  }

  // The document the owner receives is built server-side so the download and
  // the WhatsApp attachment are byte-for-byte the same file. The PDF renderer
  // is loaded on demand so it stays out of the initial page bundle.
  async function downloadPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      const [{ pdf }, { default: MedicalRecordPdfDocument }, data] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("./MedicalRecordPdfDocument"),
          apiRequest<{ record: MedicalRecordDTO }>(
            `/api/patients/${patient.patientId}/medical-record`,
          ),
        ]);
      const blob = await pdf(
        <MedicalRecordPdfDocument record={data.record} />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medical-record-${patient.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setPdfBusy(false);
    }
  }

  async function sendWhatsApp() {
    setError(null);
    setSuccess(null);
    setWaBusy(true);
    try {
      await apiRequest(
        `/api/patients/${patient.patientId}/medical-record/whatsapp`,
        { method: "POST" },
      );
      setConfirmSend(false);
      setSuccess(`Medical record sent to ${clientName} via WhatsApp.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send via WhatsApp",
      );
    } finally {
      setWaBusy(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiRequest(`/api/patients/${patient.patientId}`, {
        method: "DELETE",
      });
      router.push("/patients");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  const upcoming = records
    .filter((r) => {
      const today = new Date().toISOString().slice(0, 10);
      return r.nextDueDate && r.nextDueDate >= today;
    })
    .sort((a, b) => (a.nextDueDate ?? "").localeCompare(b.nextDueDate ?? ""));

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Box>
          <Typography variant="h4">{patient.name}</Typography>
          <Typography color="text.secondary">
            Owner:{" "}
            <Link href={`/clients/${patient.clientId}`}>{clientName}</Link>
          </Typography>
        </Box>
        {canWritePatient && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setConfirmOpen(true)}
            >
              Delete
            </Button>
          </Stack>
        )}
      </Stack>

      {error && !confirmSend && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setSuccess(null)}
        >
          {success}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Species" value={patient.species} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Breed" value={patient.breed} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field
              label="Date of birth"
              value={formatDate(patient.dateOfBirth)}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Sex" value={patient.sex} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field
              label="Neutered / spayed"
              value={patient.isNeutered ? "Yes" : "No"}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Field label="Microchip ID" value={patient.microchipId} />
          </Grid>
          {patient.notes && (
            <Grid size={12}>
              <Field label="Notes" value={patient.notes} />
            </Grid>
          )}
        </Grid>
      </Paper>

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h5">Clinical history</Typography>
        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{ flexWrap: "wrap" }}
        >
          {canReadClinical && (
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => void downloadPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? "Preparing..." : "Download record"}
            </Button>
          )}
          {canReadClinical && canSendRecord && (
            <Button
              variant="outlined"
              color="success"
              startIcon={<WhatsAppIcon />}
              onClick={() => setConfirmSend(true)}
              disabled={waBusy}
            >
              {waBusy ? "Sending..." : "Send to client"}
            </Button>
          )}
          {canWriteClinical && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setRecordOpen(true)}
            >
              Add record
            </Button>
          )}
        </Stack>
      </Stack>

      {!canReadClinical ? (
        <Alert severity="info">
          You do not have permission to view clinical records.
        </Alert>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: "wrap", alignItems: "center" }}
              >
                <span>Upcoming:</span>
                {upcoming.map((r) => (
                  <Chip
                    key={r.recordId}
                    size="small"
                    label={`${r.title} (${formatDate(r.nextDueDate)})`}
                  />
                ))}
              </Stack>
            </Alert>
          )}
          {/* Above the history, not inside it: the trend is the question a
              vet asks before reading any single visit. Renders itself away
              until there are two readings to draw a line between. */}
          <VitalsChart records={records} />
          <ClinicalTimeline
            records={records}
            patientId={patient.patientId}
            services={services}
            canWrite={canWriteClinical}
            onChanged={() => void reloadRecords()}
          />
        </>
      )}

      <PatientFormDialog
        open={editOpen}
        patient={patient}
        onClose={() => setEditOpen(false)}
        onSaved={() => router.refresh()}
      />
      <AddRecordDialog
        open={recordOpen}
        patientId={patient.patientId}
        services={services}
        onClose={() => setRecordOpen(false)}
        onSaved={() => void reloadRecords()}
      />

      {/* Sending clinical history off the premises is worth one deliberate
          step, and the confirmation is where the owner's number is checked. */}
      <Dialog open={confirmSend} onClose={() => setConfirmSend(false)}>
        <DialogTitle>Send medical record?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {patient.name}&apos;s full clinical history ({records.length}{" "}
            {records.length === 1 ? "entry" : "entries"}) will be sent to{" "}
            {clientName}
            {clientPhone ? ` on ${clientPhone}` : ""} as a PDF over WhatsApp.
          </DialogContentText>
          {!clientPhone && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This client has no phone number on file.
            </Alert>
          )}
          {/* Kept inside the dialog: an alert behind the backdrop is one the
              person who just pressed Send cannot read. */}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSend(false)} disabled={waBusy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => void sendWhatsApp()}
            disabled={waBusy || !clientPhone}
          >
            {waBusy ? "Sending..." : "Send"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete patient?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This soft-deletes {patient.name}. The record is retained and can be
            restored by an administrator.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ mt: 4 }} />
    </Box>
  );
}
