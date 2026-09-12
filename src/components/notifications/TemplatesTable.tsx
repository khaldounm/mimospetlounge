"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
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
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import BlockIcon from "@mui/icons-material/Block";
import { apiRequest } from "@/utils/api-client";
import {
  BOOKING_REMINDER_TRIGGER,
  templateTriggerLabel,
} from "@/constants/notification";
import type {
  BookingTypeOption,
  NotificationTemplateDTO,
} from "@/types/entities";
import TemplateFormDialog from "./TemplateFormDialog";
import ReminderDefaultsCard from "./ReminderDefaultsCard";

interface Props {
  initialTemplates: NotificationTemplateDTO[];
  bookingTypes: BookingTypeOption[];
  canWrite: boolean;
}

export default function TemplatesTable({
  initialTemplates,
  bookingTypes,
  canWrite,
}: Props) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationTemplateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  function upsert(t: NotificationTemplateDTO) {
    setTemplates((prev) =>
      prev.some((x) => x.templateId === t.templateId)
        ? prev.map((x) => (x.templateId === t.templateId ? t : x))
        : [...prev, t].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async function deactivate(templateId: number) {
    setError(null);
    try {
      await apiRequest(`/api/notifications/templates/${templateId}`, {
        method: "DELETE",
      });
      setTemplates((prev) =>
        prev.map((t) =>
          t.templateId === templateId ? { ...t, isActive: false } : t,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate");
    }
  }

  // The reminder kinds, straight from the list on screen: a template saved a
  // moment ago is pickable as a default without a reload.
  const reminderOptions = templates
    .filter((t) => t.isActive && t.triggerEvent === BOOKING_REMINDER_TRIGGER)
    .map((t) => ({ templateId: t.templateId, name: t.name }));

  return (
    <Box>
      <ReminderDefaultsCard
        bookingTypes={bookingTypes}
        reminderOptions={reminderOptions}
        canWrite={canWrite}
      />

      <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 2 }}>
        {canWrite && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New template
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Channel</TableCell>
              <TableCell>Trigger</TableCell>
              <TableCell>Active</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 5 : 4} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No templates yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <TableRow key={t.templateId} hover>
                  <TableCell>{t.name}</TableCell>
                  <TableCell>{t.channel ?? "-"}</TableCell>
                  <TableCell>{templateTriggerLabel(t.triggerEvent)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={t.isActive ? "success" : "default"}
                      label={t.isActive ? "Active" : "Inactive"}
                    />
                  </TableCell>
                  {canWrite && (
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditing(t);
                            setFormOpen(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {t.isActive && (
                        <Tooltip title="Deactivate">
                          <IconButton
                            size="small"
                            onClick={() => void deactivate(t.templateId)}
                          >
                            <BlockIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TemplateFormDialog
        open={formOpen}
        template={editing}
        onClose={() => setFormOpen(false)}
        onSaved={upsert}
      />
    </Box>
  );
}
