"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SnoozeIcon from "@mui/icons-material/Snooze";
import DoneIcon from "@mui/icons-material/Done";
import CloseIcon from "@mui/icons-material/Close";
import { apiRequest } from "@/utils/api-client";
import { formatDate } from "@/utils/format";
import { RECALL_SNOOZE_DAYS } from "@/constants/notification";
import type { DueRecordDTO } from "@/types/entities";

type ReminderAction = "dismiss" | "done" | "snooze";

// YYYY-MM-DD, `days` from today. Used to snooze a recall forward.
function dateInDays(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
import ComposeNotificationDialog from "./ComposeNotificationDialog";
import type {
  BookingOption,
  ClientOption,
  PatientOption,
  TemplateOption,
} from "./ComposeNotificationDialog";

interface Props {
  initialRecords: DueRecordDTO[];
  // Noun used in column headers / empty state, e.g. "vaccination" / "groom".
  noun: string;
  // Lead window this tab queries, in days. Printed in the blurb so the sentence
  // always matches what the list actually contains.
  leadDays: number;
  clientOptions: ClientOption[];
  patientOptions: PatientOption[];
  bookingOptions: BookingOption[];
  templateOptions: TemplateOption[];
  canWrite: boolean;
}

export default function DueRecordsTable({
  initialRecords,
  noun,
  leadDays,
  clientOptions,
  patientOptions,
  bookingOptions,
  templateOptions,
  canWrite,
}: Props) {
  const [records, setRecords] = useState(initialRecords);
  const [followUp, setFollowUp] = useState<DueRecordDTO | null>(null);
  const [sentIds, setSentIds] = useState<Set<number>>(
    () =>
      new Set(
        initialRecords.filter((r) => r.followUpSentAt).map((r) => r.reminderId),
      ),
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Apply a lifecycle action, then drop the row: dismissed / done recalls leave
  // the list, and a snoozed recall is hidden until its snooze date passes.
  async function act(reminderId: number, action: ReminderAction) {
    setError(null);
    setBusyId(reminderId);
    try {
      await apiRequest(`/api/reminders/${reminderId}`, {
        method: "PATCH",
        body:
          action === "snooze"
            ? { action, snoozedUntil: dateInDays(RECALL_SNOOZE_DAYS) }
            : { action },
      });
      setRecords((prev) => prev.filter((r) => r.reminderId !== reminderId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update recall");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Patients whose next {noun} is due within {leadDays} days or already
        overdue. Follow up with a recall message, snooze for later, or dismiss.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Due</TableCell>
              <TableCell>Patient</TableCell>
              <TableCell>Client</TableCell>
              <TableCell>Record</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 5 : 4} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No {noun} recalls due.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.reminderId} hover>
                  <TableCell>
                    {formatDate(r.nextDueDate)}
                    {r.isOverdue && (
                      <Chip
                        size="small"
                        color="error"
                        label="Overdue"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{r.patientName}</TableCell>
                  <TableCell>{r.clientName}</TableCell>
                  <TableCell>{r.title}</TableCell>
                  {canWrite && (
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: "flex-end" }}
                      >
                        <Tooltip
                          title={
                            sentIds.has(r.reminderId)
                              ? "Message sent"
                              : `Send a ${noun} recall message`
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              startIcon={<SendIcon fontSize="small" />}
                              disabled={
                                busyId === r.reminderId ||
                                sentIds.has(r.reminderId)
                              }
                              color={
                                sentIds.has(r.reminderId)
                                  ? "success"
                                  : "primary"
                              }
                              onClick={() => setFollowUp(r)}
                            >
                              {sentIds.has(r.reminderId) ? "Sent" : "Follow up"}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={`Hide for ${RECALL_SNOOZE_DAYS} days`}>
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<SnoozeIcon fontSize="small" />}
                            disabled={busyId === r.reminderId}
                            onClick={() => void act(r.reminderId, "snooze")}
                          >
                            Snooze
                          </Button>
                        </Tooltip>
                        <Tooltip title={`Mark this ${noun} recall handled`}>
                          <Button
                            size="small"
                            color="success"
                            startIcon={<DoneIcon fontSize="small" />}
                            disabled={busyId === r.reminderId}
                            onClick={() => void act(r.reminderId, "done")}
                          >
                            Done
                          </Button>
                        </Tooltip>
                        <Tooltip title="Dismiss this recall">
                          <Button
                            size="small"
                            color="error"
                            startIcon={<CloseIcon fontSize="small" />}
                            disabled={busyId === r.reminderId}
                            onClick={() => void act(r.reminderId, "dismiss")}
                          >
                            Dismiss
                          </Button>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <ComposeNotificationDialog
        open={followUp !== null}
        clientOptions={clientOptions}
        patientOptions={patientOptions}
        bookingOptions={bookingOptions}
        templateOptions={templateOptions}
        prefill={
          followUp
            ? {
                clientId: followUp.clientId,
                patientId: followUp.patientId,
                dueDate: followUp.nextDueDate,
                serviceName: followUp.title,
              }
            : undefined
        }
        onClose={() => setFollowUp(null)}
        onSaved={() => {
          if (followUp) {
            void apiRequest(`/api/reminders/${followUp.reminderId}`, {
              method: "PATCH",
              body: { action: "followup" },
            });
            setSentIds((prev) => new Set(prev).add(followUp.reminderId));
          }
          setFollowUp(null);
        }}
      />
    </Box>
  );
}
