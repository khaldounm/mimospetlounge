"use client";

import { useState } from "react";
import Link from "@/components/ui/AppLink";
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { apiRequest } from "@/utils/api-client";
import { formatDate } from "@/utils/format";
import { useClientOffers } from "@/hooks/useClientOffers";
import { offerTerms } from "@/utils/offers";
import OfferPickerDialog from "./OfferPickerDialog";
import type { OfferGrantDTO } from "@/types/entities";

interface Props {
  clientId: number;
  clientName: string;
  /** invoices:write, the same permission that lets someone discount at the till. */
  canGrant: boolean;
  /** users:write, needed to invent a new offer rather than pick an existing one. */
  canManage: boolean;
}

// One spent offer, kept on screen rather than hidden. What staff ask at the
// counter is "didn't we already give them something", and an empty panel
// answers that wrongly.
function SpentGrant({ grant }: { grant: OfferGrantDTO }) {
  return (
    <Typography variant="caption" color="text.secondary" component="div">
      {grant.offerName} ({offerTerms(grant)}) used on{" "}
      {grant.redeemedInvoiceId != null ? (
        <Link href={`/invoices/${grant.redeemedInvoiceId}`}>
          {grant.redeemedInvoiceNumber}
        </Link>
      ) : (
        "an invoice"
      )}
      {grant.redeemedAt
        ? ` on ${formatDate(grant.redeemedAt.slice(0, 10))}`
        : ""}
    </Typography>
  );
}

// What this client has been given, and the way to give them something.
//
// Granting is all this does. The discount itself lands later, on a draft
// invoice, because that is the only place a discount means anything.
export default function ClientOffersPanel({
  clientId,
  clientName,
  canGrant,
  canManage,
}: Props) {
  const { grants, loading, error, reload } = useClientOffers(clientId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const live = grants.filter((g) => g.redeemedAt == null);
  const spent = grants.filter((g) => g.redeemedAt != null);

  async function revoke(grant: OfferGrantDTO) {
    setActionError(null);
    try {
      await apiRequest(`/api/offers/grants/${grant.grantId}`, {
        method: "DELETE",
      });
      setNote(`${grant.offerName} taken back.`);
      reload();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to take the offer back",
      );
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "center",
          mb: live.length > 0 || spent.length > 0 ? 1.5 : 0,
          gap: 1,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Offers
        </Typography>
        {canGrant && (
          <Button
            size="small"
            startIcon={<LocalOfferIcon />}
            onClick={() => setPickerOpen(true)}
          >
            Apply offer
          </Button>
        )}
      </Stack>

      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {(error || actionError) && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {actionError ?? error}
        </Alert>
      )}
      {note && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={() => setNote(null)}>
          {note}
        </Alert>
      )}

      {live.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
          {live.map((grant) => (
            <Tooltip
              key={grant.grantId}
              title={
                grant.expired
                  ? "Expired, so it can no longer be applied to an invoice"
                  : `Given ${formatDate(grant.grantedAt.slice(0, 10))}${
                      grant.grantedByName ? ` by ${grant.grantedByName}` : ""
                    }. Applies on the next draft invoice.`
              }
            >
              <Chip
                color={grant.expired ? "default" : "primary"}
                variant={grant.expired ? "outlined" : "filled"}
                label={`${grant.offerName}: ${offerTerms(grant)}${
                  grant.expired ? " (expired)" : ""
                }`}
                onDelete={canGrant ? () => void revoke(grant) : undefined}
              />
            </Tooltip>
          ))}
        </Stack>
      ) : (
        !loading && (
          <Typography variant="body2" color="text.secondary">
            Nothing waiting to be used.
          </Typography>
        )
      )}

      {spent.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          {spent.map((grant) => (
            <SpentGrant key={grant.grantId} grant={grant} />
          ))}
        </Stack>
      )}

      <OfferPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        clientIds={[clientId]}
        clientLabel={clientName}
        canManage={canManage}
        onGranted={(result) => {
          setNote(
            result.granted > 0
              ? `${result.offerName} applied. It comes off their next draft invoice.`
              : `${clientName} already has ${result.offerName}.`,
          );
          reload();
        }}
      />
    </Paper>
  );
}
