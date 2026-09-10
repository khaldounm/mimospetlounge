"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/AppLink";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PaymentsIcon from "@mui/icons-material/Payments";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import type { ClientDTO, PatientDTO } from "@/types/entities";
import ClientOffersPanel from "@/components/offers/ClientOffersPanel";
import AccountPaymentDialog from "./AccountPaymentDialog";
import ClientFormDialog from "./ClientFormDialog";
import PatientFormDialog from "@/components/patients/PatientFormDialog";

interface Props {
  client: ClientDTO;
  patients: PatientDTO[];
  canWrite: boolean;
  // Taking money is gated separately from editing the client.
  canPay: boolean;
  // Giving an offer is the same decision as discounting at the till, so it
  // follows invoices:write rather than the permission to edit the client.
  canGrantOffer: boolean;
  // Inventing a new offer rather than picking an existing one. Admin.
  canManageOffers: boolean;
  // LBP per 1 USD, from the clinic settings.
  fxRate: number;
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

export default function ClientDetail({
  client,
  patients,
  canWrite,
  canPay,
  canGrantOffer,
  canManageOffers,
  fxRate,
}: Props) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [patientOpen, setPatientOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiRequest(`/api/clients/${client.clientId}`, { method: "DELETE" });
      router.push("/clients");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  const owed = Number(client.accountBalance ?? 0);
  // Only offered when there is something to settle. A client in credit has
  // nothing to pay, and the server refuses that case regardless.
  const canRecordAccountPayment = canPay && owed > 0;

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">
          {client.firstName} {client.lastName}
        </Typography>
        <Stack direction="row" spacing={1}>
          {/* Always offered, not just when money is owed: a client asking what
              they were charged for is as common as one asking what they owe. */}
          <Button
            component={Link}
            href={`/clients/${client.clientId}/statement`}
            variant="outlined"
            startIcon={<ReceiptLongIcon />}
          >
            Statement
          </Button>
          {canRecordAccountPayment && (
            <Button
              variant="contained"
              color="success"
              startIcon={<PaymentsIcon />}
              onClick={() => setPayOpen(true)}
            >
              Record payment
            </Button>
          )}
          {canWrite && (
            <>
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
            </>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 6 }}>
            <Field label="Phone" value={client.phone} />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Field label="Email" value={client.email} />
          </Grid>
          {client.accountBalance !== undefined && (
            <Grid size={{ xs: 6 }}>
              <Field
                label="Account balance"
                value={formatMoney(client.accountBalance)}
              />
            </Grid>
          )}
          {/* Shown next to the balance rather than tucked away: it is the part
              of the figure the client did not run up here and the one they are
              most likely to query. Already inside the balance, never added to
              it. The source is recorded against the row for audit; staff do not
              need it on screen. */}
          {client.openingBalance && (
            <Grid size={{ xs: 6 }}>
              <Field
                label="Opening balance"
                value={formatMoney(client.openingBalance.amount)}
              />
              <Typography variant="caption" color="text.secondary">
                As at {formatDate(client.openingBalance.asOfDate)}, included in
                the account balance
              </Typography>
            </Grid>
          )}
          {client.notes && (
            <Grid size={12}>
              <Field label="Notes" value={client.notes} />
            </Grid>
          )}
        </Grid>
      </Paper>

      <ClientOffersPanel
        clientId={client.clientId}
        clientName={`${client.firstName} ${client.lastName}`.trim()}
        canGrant={canGrantOffer}
        canManage={canManageOffers}
      />

      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h5">Patients</Typography>
        {canWrite && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setPatientOpen(true)}
          >
            Add patient
          </Button>
        )}
      </Stack>

      <Paper variant="outlined">
        {patients.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            No patients for this client yet.
          </Typography>
        ) : (
          <List disablePadding>
            {patients.map((p) => (
              <ListItem key={p.patientId} disablePadding>
                <ListItemButton
                  component={Link}
                  href={`/patients/${p.patientId}`}
                >
                  <ListItemText
                    primary={p.name}
                    secondary={[p.species, p.breed].filter(Boolean).join(" • ")}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <AccountPaymentDialog
        open={payOpen}
        clientId={client.clientId}
        clientName={`${client.firstName} ${client.lastName}`}
        balance={String(owed)}
        fxRate={fxRate}
        onClose={() => setPayOpen(false)}
        onSaved={() => router.refresh()}
      />
      <ClientFormDialog
        open={editOpen}
        client={client}
        onClose={() => setEditOpen(false)}
        onSaved={() => router.refresh()}
      />
      <PatientFormDialog
        open={patientOpen}
        fixedClientId={client.clientId}
        onClose={() => setPatientOpen(false)}
        onSaved={() => router.refresh()}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete client?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This soft-deletes {client.firstName} {client.lastName}. Their
            patients are kept and can be reassigned later.
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
    </Box>
  );
}
