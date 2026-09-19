"use client";

import { useState } from "react";
import Link from "@/components/ui/AppLink";
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Fade,
  IconButton,
  List,
  ListItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { useUpcomingBirthdays } from "@/hooks/useUpcomingBirthdays";
import { formatWeekdayDate } from "@/utils/format";
import { daysBetweenLocal, formatRangeLabel } from "@/utils/date-range";
import { normalizePhone } from "@/utils/phone";
import { BIRTHDAY_WINDOW_DAYS } from "@/constants/patient";
import type { UpcomingBirthdayDTO } from "@/types/entities";

interface Props {
  open: boolean;
  /** patients:write. Without it the list is read-only: no ticking off. */
  canWrite: boolean;
  onClose: () => void;
}

// What the dialog reserves for the list while it loads, so it opens at a
// steady size and the rows unroll into it rather than jumping it open. Let go
// once the list is in, with a transition, so one pet does not sit above a
// blank band and twenty do not snap the dialog taller.
const LOADING_STAGE_HEIGHT = 240;

// Pets with a birthday in the coming week, fetched when opened and not before.
// Remounted per open so a stale list is never shown: the window moves every
// day and a tick made on another screen has to show up here.
export default function BirthdaysDialog({ open, canWrite, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && <BirthdaysList canWrite={canWrite} onClose={onClose} />}
    </Dialog>
  );
}

// "Today", "Tomorrow", then the weekday and date. The list is read at the
// counter against a calendar, and the first two are what it actually says.
function dayLabel(from: string, birthday: string): string {
  const days = daysBetweenLocal(from, birthday);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return formatWeekdayDate(birthday);
}

function turnsLabel(turns: number): string {
  return turns > 0 ? `turns ${turns}` : "born this week";
}

function BirthdaysList({ canWrite, onClose }: Omit<Props, "open">) {
  const { data, loading, error, setSeen } = useUpcomingBirthdays();
  const [tickError, setTickError] = useState<string | null>(null);

  const patients = data?.patients ?? [];
  const seenCount = patients.filter((p) => p.seen).length;

  async function toggle(p: UpcomingBirthdayDTO) {
    setTickError(null);
    try {
      await setSeen(p.patientId, !p.seen);
    } catch (err) {
      setTickError(err instanceof Error ? err.message : "Could not save");
    }
  }

  return (
    <>
      <DialogTitle sx={{ pr: 6 }}>
        Birthdays this week
        {data && (
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ ml: 1 }}
          >
            {formatRangeLabel({ from: data.from, to: data.to })}
          </Typography>
        )}
        <IconButton
          aria-label="Close"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        {tickError && (
          <Alert
            severity="error"
            sx={{ mb: 1 }}
            onClose={() => setTickError(null)}
          >
            {tickError}
          </Alert>
        )}

        <Box
          sx={{
            position: "relative",
            minHeight: loading ? LOADING_STAGE_HEIGHT : 0,
            transition: "min-height 350ms ease",
          }}
        >
          <Fade in={loading} unmountOnExit timeout={{ enter: 0, exit: 200 }}>
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress size={36} />
            </Box>
          </Fade>

          <Collapse in={!loading && data !== null} timeout={350}>
            {data && patients.length === 0 ? (
              <Box sx={{ py: 4, textAlign: "center" }}>
                <Typography color="text.secondary">
                  No birthdays in the next {BIRTHDAY_WINDOW_DAYS} days.
                </Typography>
                {/* Most of an imported catalogue has no date of birth, and
                    an empty list reads very differently when that is why. */}
                {data.withBirthDate < data.total && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 1 }}
                  >
                    {data.withBirthDate} of {data.total} pets have a date of
                    birth on file. Adding one puts the pet on this list.
                  </Typography>
                )}
              </Box>
            ) : (
              <>
                {data && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1 }}
                  >
                    {patients.length} {patients.length === 1 ? "pet" : "pets"}
                    {seenCount > 0 ? `, ${seenCount} seen` : ""}.
                    {canWrite ? " Tick a pet once its wishes are sent." : ""}
                  </Typography>
                )}
                <List disablePadding>
                  {patients.map((p) => {
                    const wa = normalizePhone(p.clientPhone);
                    return (
                      <ListItem
                        key={p.patientId}
                        divider
                        disableGutters
                        sx={{
                          alignItems: "flex-start",
                          gap: 1.5,
                          // Ticked rows fall back so the eye lands on what is
                          // still to do, without leaving the list.
                          opacity: p.seen ? 0.55 : 1,
                          transition: "opacity 200ms",
                        }}
                        secondaryAction={
                          canWrite ? (
                            <Tooltip
                              title={p.seen ? "Put back" : "Mark as seen"}
                            >
                              <Checkbox
                                edge="end"
                                checked={p.seen}
                                onChange={() => void toggle(p)}
                                slotProps={{
                                  input: {
                                    "aria-label": p.seen
                                      ? `Put ${p.name} back`
                                      : `Mark ${p.name} as seen`,
                                  },
                                }}
                              />
                            </Tooltip>
                          ) : p.seen ? (
                            <Chip size="small" label="Seen" />
                          ) : null
                        }
                      >
                        <Box sx={{ width: 118, flexShrink: 0, pt: 0.25 }}>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 600, whiteSpace: "nowrap" }}
                          >
                            {data ? dayLabel(data.from, p.birthday) : ""}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            {turnsLabel(p.turns)}
                          </Typography>
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1, pr: 6 }}>
                          <Typography variant="body1" noWrap>
                            <Link href={`/patients/${p.patientId}`}>
                              {p.name}
                            </Link>
                            {(p.species || p.breed) && (
                              <Typography
                                component="span"
                                variant="body2"
                                color="text.secondary"
                              >
                                {` ${[p.species, p.breed].filter(Boolean).join(", ")}`}
                              </Typography>
                            )}
                          </Typography>
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ alignItems: "center", flexWrap: "wrap" }}
                          >
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                            >
                              <Link href={`/clients/${p.clientId}`}>
                                {p.clientName}
                              </Link>
                              {p.clientPhone ? ` · ${p.clientPhone}` : ""}
                            </Typography>
                            {wa && (
                              <Tooltip title="Open a WhatsApp chat">
                                <IconButton
                                  size="small"
                                  color="success"
                                  component="a"
                                  href={`https://wa.me/${wa.replace(/^\+/, "")}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`WhatsApp ${p.clientName}`}
                                >
                                  <WhatsAppIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Stack>
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}
          </Collapse>
        </Box>
      </DialogContent>
    </>
  );
}
