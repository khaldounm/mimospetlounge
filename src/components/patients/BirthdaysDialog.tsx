"use client";

import { useState } from "react";
import Link from "@/components/ui/AppLink";
import {
  Alert,
  Box,
  Button,
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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import CakeIcon from "@mui/icons-material/Cake";
import CakeOutlinedIcon from "@mui/icons-material/CakeOutlined";
import SendIcon from "@mui/icons-material/Send";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import PhoneDisabledIcon from "@mui/icons-material/PhoneDisabled";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { useUpcomingBirthdays } from "@/hooks/useUpcomingBirthdays";
import { formatTime, formatWeekdayDate } from "@/utils/format";
import { daysBetweenLocal, formatRangeLabel } from "@/utils/date-range";
import { normalizePhone } from "@/utils/phone";
import { BIRTHDAY_WINDOW_DAYS } from "@/constants/patient";
import type { UpcomingBirthdayDTO } from "@/types/entities";

interface Props {
  open: boolean;
  /** patients:write. Without it the list is read-only: no ticking off. */
  canWrite: boolean;
  /** notifications:write. Without it nothing sends; the chat link stays. */
  canSend: boolean;
  onClose: () => void;
}

// What the dialog reserves for the list while it loads, so it opens at a
// steady size and the rows unroll into it rather than jumping it open. Let go
// once the list is in, with a transition, so one pet does not sit above a
// blank band and twenty do not snap the dialog taller.
const LOADING_STAGE_HEIGHT = 240;

// The day column, wide enough for "Wed 24/09/2026" on one line.
const DAY_COLUMN_WIDTH = 118;

// Pets with a birthday in the coming week, fetched when opened and not before.
// Remounted per open so a stale list is never shown: the window moves every
// day and a tick made on another screen has to show up here.
export default function BirthdaysDialog({
  open,
  canWrite,
  canSend,
  onClose,
}: Props) {
  const theme = useTheme();
  // Edge to edge on a phone: the rows carry a preview and three controls,
  // and a floating card at that width leaves them no room.
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
    >
      {open && (
        <BirthdaysList
          canWrite={canWrite}
          canSend={canSend}
          onClose={onClose}
        />
      )}
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

// Wishes that went out. Send is closed off for these: one message per
// birthday, and the server refuses a second one anyway.
function wishesSent(p: UpcomingBirthdayDTO): boolean {
  return p.wishes?.status === "Sent" || p.wishes?.status === "Delivered";
}

// A row the Send button can act on: there is a text to send, a number to
// send it to, and nothing but a failed attempt before it.
function canSendRow(p: UpcomingBirthdayDTO): boolean {
  return (
    p.preview !== null &&
    p.recipient !== null &&
    !wishesSent(p) &&
    p.wishes?.status !== "Pending"
  );
}

function BirthdaysList({ canWrite, canSend, onClose }: Omit<Props, "open">) {
  const { data, loading, error, setSeen, setTemplate, send } =
    useUpcomingBirthdays();
  const [actionError, setActionError] = useState<string | null>(null);
  // Per row, so a slow provider on one row never stops the next click.
  const [sending, setSending] = useState<Record<number, true>>({});
  // One preview open at a time keeps the list readable; the row remembers
  // an edit until it is sent or closed.
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // The bulk button's tally while it runs.
  const [bulk, setBulk] = useState<{ done: number; of: number } | null>(null);

  const patients = data?.patients ?? [];
  const seenCount = patients.filter((p) => p.seen).length;
  const hasTemplate = data !== null && data.templateId !== null;
  const templateName =
    data?.templates.find((t) => t.templateId === data.templateId)?.name ?? "";
  // Today's pets still to wish. Rows ticked by hand are left alone: the tick
  // says the owner was greeted another way, and a message on top would be a
  // second greeting.
  const todayToSend = data
    ? patients.filter(
        (p) => p.birthday === data.from && !p.seen && canSendRow(p),
      )
    : [];

  async function toggle(p: UpcomingBirthdayDTO) {
    setActionError(null);
    try {
      await setSeen(p.patientId, !p.seen);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save");
    }
  }

  // The row answers from what the server said about this one send; nothing
  // else is refetched. A refusal (no number, stale template) surfaces as the
  // alert; a provider failure comes back on the row as a Failed chip.
  async function sendOne(p: UpcomingBirthdayDTO, body?: string) {
    setActionError(null);
    setSending((prev) => ({ ...prev, [p.patientId]: true }));
    try {
      await send(p.patientId, body);
      if (previewId === p.patientId) {
        setPreviewId(null);
        setDraft(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending((prev) => {
        const next = { ...prev };
        delete next[p.patientId];
        return next;
      });
    }
  }

  // Today's rows, one after the other. A handful at most, and the rows
  // report for themselves as each one lands.
  async function sendToday() {
    const rows = todayToSend;
    setBulk({ done: 0, of: rows.length });
    try {
      for (const [i, p] of rows.entries()) {
        await sendOne(p);
        setBulk({ done: i + 1, of: rows.length });
      }
    } finally {
      setBulk(null);
    }
  }

  function togglePreview(patientId: number) {
    setDraft(null);
    setPreviewId((current) => (current === patientId ? null : patientId));
  }

  return (
    <>
      <DialogTitle sx={{ pr: 6, display: "flex", alignItems: "center" }}>
        <CakeIcon sx={{ color: "secondary.main", mr: 1 }} />
        Birthdays this week
        {data && (
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ ml: 1.5 }}
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
        {actionError && (
          <Alert
            severity="error"
            sx={{ mb: 1 }}
            onClose={() => setActionError(null)}
          >
            {actionError}
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
                  <Stack
                    direction="row"
                    sx={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 1,
                      mb: 1,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      {patients.length} {patients.length === 1 ? "pet" : "pets"}
                      {seenCount > 0 ? `, ${seenCount} seen` : ""}.
                      {canSend && hasTemplate
                        ? " Wishes go out on WhatsApp from the row."
                        : canWrite
                          ? " Tick a pet once its wishes are sent."
                          : ""}
                    </Typography>
                    {canSend && (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center", ml: "auto" }}
                      >
                        {/* Which text goes out. One template is a fact, not
                            a choice, so the select only appears at two. */}
                        {data.templates.length > 1 && data.templateId && (
                          <TextField
                            select
                            size="small"
                            value={String(data.templateId)}
                            onChange={(e) =>
                              setTemplate(Number(e.target.value))
                            }
                            disabled={bulk !== null}
                            slotProps={{
                              htmlInput: { "aria-label": "Wishes template" },
                            }}
                            sx={{
                              minWidth: 180,
                              "& .MuiInputBase-input": { py: 0.75 },
                            }}
                          >
                            {data.templates.map((t) => (
                              <MenuItem
                                key={t.templateId}
                                value={String(t.templateId)}
                              >
                                {t.name}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}
                        {todayToSend.length > 0 && (
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<SendIcon fontSize="small" />}
                            onClick={() => void sendToday()}
                            disabled={bulk !== null}
                          >
                            {bulk
                              ? `Sending ${bulk.done} of ${bulk.of}…`
                              : `Send today's ${todayToSend.length}`}
                          </Button>
                        )}
                      </Stack>
                    )}
                  </Stack>
                )}

                {/* Nothing to send with yet. Said once, up here, rather than
                    as a dead button on every row. */}
                {canSend && data && !hasTemplate && (
                  <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
                    No birthday template yet. Create one on the{" "}
                    <Link href="/notifications/templates">Templates tab</Link>{" "}
                    with &ldquo;Birthday wishes&rdquo; as what it is used for,
                    and every row here gets a Send button.
                  </Alert>
                )}

                <List disablePadding>
                  {patients.map((p) => (
                    <BirthdayRow
                      key={p.patientId}
                      p={p}
                      from={data?.from ?? ""}
                      templateName={templateName}
                      canWrite={canWrite}
                      canSend={canSend}
                      sending={Boolean(sending[p.patientId])}
                      previewOpen={previewId === p.patientId}
                      draft={previewId === p.patientId ? draft : null}
                      onToggleSeen={() => void toggle(p)}
                      onTogglePreview={() => togglePreview(p.patientId)}
                      onDraft={setDraft}
                      onSend={(body) => void sendOne(p, body)}
                    />
                  ))}
                </List>
              </>
            )}
          </Collapse>
        </Box>
      </DialogContent>
    </>
  );
}

interface RowProps {
  p: UpcomingBirthdayDTO;
  from: string;
  templateName: string;
  canWrite: boolean;
  canSend: boolean;
  sending: boolean;
  previewOpen: boolean;
  draft: string | null;
  onToggleSeen: () => void;
  onTogglePreview: () => void;
  onDraft: (draft: string | null) => void;
  onSend: (body?: string) => void;
}

function BirthdayRow({
  p,
  from,
  templateName,
  canWrite,
  canSend,
  sending,
  previewOpen,
  draft,
  onToggleSeen,
  onTogglePreview,
  onDraft,
  onSend,
}: RowProps) {
  const wa = normalizePhone(p.clientPhone);
  const isToday = from !== "" && p.birthday === from;
  const sent = wishesSent(p);
  const sendable = canSend && !sending && canSendRow(p);
  const status = p.wishes?.status ?? null;

  const sendTooltip = sent
    ? `Wishes sent${p.wishes?.sentAt ? ` at ${formatTime(p.wishes.sentAt)}` : ""}`
    : p.preview === null
      ? "No birthday template"
      : p.recipient === null
        ? "No usable phone number"
        : status === "Pending"
          ? "Queued, the daily sweep will send it"
          : "Send the wishes";

  return (
    <ListItem
      disableGutters
      divider
      sx={{
        display: "block",
        py: 1.25,
        // Ticked rows fall back so the eye lands on what is still to do,
        // without leaving the list.
        opacity: p.seen ? 0.55 : 1,
        transition: "opacity 200ms",
      }}
    >
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5 }}>
        <Box sx={{ width: DAY_COLUMN_WIDTH, flexShrink: 0, pt: 0.25 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              // The day itself gets the accent: it is the one row the
              // counter is opening the list for.
              color: isToday ? "secondary.main" : "text.primary",
            }}
          >
            {isToday && <CakeOutlinedIcon sx={{ fontSize: 16 }} />}
            {from ? dayLabel(from, p.birthday) : ""}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            {turnsLabel(p.turns)}
          </Typography>
        </Box>

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body1" noWrap>
            <Link href={`/patients/${p.patientId}`}>{p.name}</Link>
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
            <Typography variant="body2" color="text.secondary" noWrap>
              <Link href={`/clients/${p.clientId}`}>{p.clientName}</Link>
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
                  sx={{ p: 0.5 }}
                >
                  <WhatsAppIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          {/* How the wishes fared, on the row where the button was. */}
          {(status || (p.preview !== null && p.recipient === null)) && (
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ mt: 0.5, flexWrap: "wrap" }}
            >
              {sent && (
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  icon={<CheckIcon />}
                  label={
                    p.wishes?.sentAt
                      ? `Wishes sent ${formatTime(p.wishes.sentAt)}`
                      : "Wishes sent"
                  }
                />
              )}
              {status === "Failed" && (
                <Tooltip title={p.wishes?.errorMessage ?? ""}>
                  <Chip
                    size="small"
                    color="error"
                    variant="outlined"
                    icon={<ErrorOutlineIcon />}
                    label="Send failed"
                  />
                </Tooltip>
              )}
              {status === "Pending" && (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label="Queued"
                />
              )}
              {p.preview !== null && p.recipient === null && (
                <Tooltip title="Add a valid phone number to the client">
                  <Chip
                    size="small"
                    color="error"
                    variant="outlined"
                    icon={<PhoneDisabledIcon />}
                    label="No usable number"
                  />
                </Tooltip>
              )}
            </Stack>
          )}
        </Box>

        <Stack
          direction="row"
          sx={{ alignItems: "center", flexShrink: 0, mt: -0.5, mr: -0.5 }}
        >
          {p.preview !== null && (
            <Tooltip title={previewOpen ? "Hide message" : "Show message"}>
              <IconButton
                size="small"
                onClick={onTogglePreview}
                aria-label={previewOpen ? "Hide message" : "Show message"}
              >
                {previewOpen ? (
                  <VisibilityOffOutlinedIcon fontSize="small" />
                ) : (
                  <VisibilityOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          )}
          {canSend && p.preview !== null && (
            <Tooltip title={sendTooltip}>
              <span>
                <Button
                  size="small"
                  startIcon={
                    sending ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <SendIcon fontSize="small" />
                    )
                  }
                  onClick={() => onSend()}
                  disabled={!sendable}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {sending
                    ? "Sending…"
                    : status === "Failed"
                      ? "Retry"
                      : sent
                        ? "Sent"
                        : "Send"}
                </Button>
              </span>
            </Tooltip>
          )}
          {canWrite ? (
            <Tooltip title={p.seen ? "Put back" : "Mark as seen"}>
              <Checkbox
                checked={p.seen}
                onChange={onToggleSeen}
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
            <Chip size="small" label="Seen" sx={{ ml: 1 }} />
          ) : null}
        </Stack>
      </Stack>

      {/* The message as it will land on the owner's phone, drawn as the
          bubble they will see. Editing here changes this one send only. */}
      <Collapse in={previewOpen && p.preview !== null} timeout={250}>
        <Box sx={{ pl: { xs: 0, sm: `${DAY_COLUMN_WIDTH + 12}px` }, pt: 1 }}>
          <Paper
            elevation={0}
            sx={(theme) => ({
              p: 1.5,
              borderRadius: 3,
              borderTopLeftRadius: 4,
              bgcolor: alpha(
                theme.palette.success.main,
                theme.palette.mode === "dark" ? 0.16 : 0.09,
              ),
              border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
            })}
          >
            <Stack
              direction="row"
              sx={{ justifyContent: "space-between", gap: 2, mb: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary" noWrap>
                To {p.clientName}
                {p.recipient ? ` · ${p.recipient}` : ""}
              </Typography>
              {templateName && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {templateName}
                </Typography>
              )}
            </Stack>
            {draft === null ? (
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {p.preview}
              </Typography>
            ) : (
              <TextField
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                multiline
                minRows={3}
                fullWidth
                size="small"
                helperText="Sent to this owner only; the template is unchanged"
                sx={{ bgcolor: "background.paper", borderRadius: 1 }}
              />
            )}
            {canSend && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SendIcon fontSize="small" />}
                  disabled={
                    !sendable || (draft !== null && draft.trim() === "")
                  }
                  onClick={() => onSend(draft ?? undefined)}
                >
                  {draft === null ? "Send this" : "Send edited"}
                </Button>
                {draft === null ? (
                  <Button
                    size="small"
                    startIcon={<EditOutlinedIcon fontSize="small" />}
                    disabled={!sendable}
                    onClick={() => onDraft(p.preview)}
                  >
                    Edit once
                  </Button>
                ) : (
                  <Button size="small" onClick={() => onDraft(null)}>
                    Discard edit
                  </Button>
                )}
              </Stack>
            )}
          </Paper>
        </Box>
      </Collapse>
    </ListItem>
  );
}
