"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/ui/AppLink";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { apiRequest } from "@/utils/api-client";
import { formatMoney } from "@/utils/format";
import { RECORD_TYPES } from "@/types/enums";
import type { ServiceDTO } from "@/types/entities";
import ServiceFormDialog from "./ServiceFormDialog";

// Every category renders its own <Table>, and an auto layout sizes each one from
// its own contents: Grooming's long names push its Price column right, and no
// two groups line up down the page. Fixed percentages, shared by all of them,
// make the sections read as one table rather than a stack of unrelated ones.
//
// Only the visible columns are allocated, so hiding Cost or Partner widens the
// name instead of leaving a gap where the column used to be.
//
// Percentages of a phone-width table leave every column too narrow for what
// goes in it, and a fixed layout does not grow to fit: it lets the contents
// spill, which put the Edit buttons outside the card and clipped the status
// chips to their first letter. Below this width the table keeps these
// proportions and the page scrolls to it instead.
//
// 700 rather than a rounder 640: Status is 13% of it, and once cell padding is
// taken off, anything narrower leaves the "Active" chip about two pixels short
// and it renders as "Acti...".
const SERVICES_MIN_WIDTH = 700;

function serviceColumnWidths(opts: {
  cost: boolean;
  partner: boolean;
  edit: boolean;
}) {
  const price = 13;
  const cost = opts.cost ? 13 : 0;
  const partner = opts.partner ? 18 : 0;
  const status = 13;
  const edit = opts.edit ? 8 : 0;
  return {
    name: `${100 - price - cost - partner - status - edit}%`,
    price: `${price}%`,
    cost: `${cost}%`,
    partner: `${partner}%`,
    status: `${status}%`,
    edit: `${edit}%`,
  };
}

// A service whose recipe names stock that carries no last cost. Its cost is
// understated, and where a partner performs it their cut is overstated by the
// same amount, so it is flagged in the list rather than only inside the form.
// A component row can never have a zero quantity (the DB CHECK forbids it), so
// a zero line cost on an item row means the item itself prices at nothing.
// Uncategorised has no name to key on, so it gets a reserved one. Shared by the
// accordion key and the open-sections state so the two cannot drift apart.
function groupKey(category: string | null): string {
  return category ?? "__none__";
}

function hasNoCostItem(s: ServiceDTO): boolean {
  return (s.costComponents ?? []).some(
    (c) => c.itemId != null && Number(c.lineCost) === 0,
  );
}

// Group the catalogue for display, showing EVERY category it actually has.
//
// This used to walk a fixed list of the four clinical record types, which
// silently dropped any service categorised as anything else. On this clinic's
// live data that hid 44 of 60 services, including every Diagnostics, Surgery,
// Dental and Veterinary one, from the page whose whole job is to list them:
// they could not be seen, searched or edited, and nothing said they existed.
//
// The record types still lead, since they are the categories the clinic thinks
// in, and anything else follows alphabetically. Uncategorised sorts last.
function groupByCategory(services: ServiceDTO[]) {
  const map = new Map<string | null, ServiceDTO[]>();
  for (const s of services) {
    const key = s.category ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  for (const arr of map.values())
    arr.sort((a, b) => a.name.localeCompare(b.name));

  const known: (string | null)[] = RECORD_TYPES.filter((c) => map.has(c));
  const rest = [...map.keys()]
    .filter(
      (c): c is string =>
        c !== null && !(RECORD_TYPES as readonly string[]).includes(c),
    )
    .sort((a, b) => a.localeCompare(b));

  return [...known, ...rest, ...(map.has(null) ? [null] : [])].map((c) => ({
    category: c,
    services: map.get(c)!,
  }));
}

interface Props {
  initialServices: ServiceDTO[];
  canWrite: boolean;
  // Reading a deal and setting one are separate grants. Both are Admin today.
  canSeeDeal: boolean;
  canEditDeal: boolean;
  canSeeCost: boolean;
  canEditCost: boolean;
}

export default function ServicesTable({
  initialServices,
  canWrite,
  canSeeDeal,
  canEditDeal,
  canSeeCost,
  canEditCost,
}: Props) {
  const [services, setServices] = useState(initialServices);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const firstRender = useRef(true);

  async function load(q: string, active: boolean) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (active) params.set("activeOnly", "true");
    const qs = params.toString();
    const data = await apiRequest<{ services: ServiceDTO[] }>(
      `/api/services${qs ? `?${qs}` : ""}`,
    );
    setServices(data.services);
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => void load(query, activeOnly), 300);
    return () => clearTimeout(t);
  }, [query, activeOnly]);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(s: ServiceDTO) {
    setEditing(s);
    setDialogOpen(true);
  }

  // Category choices for the form, so a service can be filed under the words the
  // clinic actually uses instead of the four clinical record types. Built from
  // initialServices (the unfiltered server load) unioned with whatever is on
  // screen, because `services` shrinks as the user searches and the choices
  // must not shrink with it.
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const s of [...initialServices, ...services]) {
      if (s.category) seen.add(s.category);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [initialServices, services]);

  const groups = groupByCategory(services);

  // Which sections are open, held here rather than left to each Accordion's own
  // defaultExpanded. Two reasons:
  //
  //   1. defaultExpanded is read once, at mount. Deriving it from the filtered
  //      groups meant it changed as soon as somebody typed in the search box,
  //      which React cannot act on and MUI warns about.
  //   2. A search whose only match sits in a collapsed section looks like no
  //      match at all. Searching therefore opens everything, so a hit is
  //      visible wherever it lands.
  //
  // Reconciled during render rather than in an effect, which is the documented
  // way to adjust state when an input changes: no second paint, and no flash of
  // the previous set.
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(groups[0] ? [groupKey(groups[0].category)] : []),
  );
  // Keyed on the GROUPS, not on the query. The search box updates `query`
  // immediately but the results arrive 300ms later, so reconciling on the query
  // expanded the sections of the list being replaced and left the incoming
  // matches shut. Reacting to the group set means this runs when the answer
  // actually changes.
  const groupSig = groups.map((g) => groupKey(g.category)).join("|");
  const [lastSig, setLastSig] = useState(groupSig);
  if (lastSig !== groupSig) {
    setLastSig(groupSig);
    setOpenKeys(
      new Set(
        query.trim()
          ? groups.map((g) => groupKey(g.category))
          : groups[0]
            ? [groupKey(groups[0].category)]
            : [],
      ),
    );
  }

  const cols = serviceColumnWidths({
    cost: canSeeCost,
    partner: canSeeDeal,
    edit: canWrite,
  });

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h4">Services</Typography>
        <Stack direction="row" spacing={1}>
          <Button component={Link} href="/invoices" variant="outlined">
            Invoices
          </Button>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openNew}
            >
              New service
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 2 }}>
        <TextField
          placeholder="Search by name or category"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          fullWidth
          size="small"
        />
        <FormControlLabel
          control={
            <Switch
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
          }
          label="Active only"
          sx={{ whiteSpace: "nowrap" }}
        />
      </Stack>

      {services.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No services found.
        </Typography>
      ) : (
        // One scroller around every category, not one per table. The shared
        // column percentages exist so the sections read as a single table down
        // the page, and per-section scrollers would let them drift out of
        // alignment the moment one was scrolled.
        <Box sx={{ overflowX: "auto" }}>
          {groups.map(({ category, services: group }) => {
            const key = groupKey(category);
            return (
              <Accordion
                key={key}
                expanded={openKeys.has(key)}
                onChange={(_e, isOpen) =>
                  setOpenKeys((prev) => {
                    const next = new Set(prev);
                    if (isOpen) next.add(key);
                    else next.delete(key);
                    return next;
                  })
                }
                disableGutters
                elevation={0}
                // Same as the analytics sections: eight of these nine categories
                // are closed on load, and their tables were being built anyway.
                slotProps={{ transition: { unmountOnExit: true } }}
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  "&:not(:last-child)": { borderBottom: 0 },
                  "&::before": { display: "none" },
                  // The card grows with the table it holds. Without this it
                  // stayed at the viewport width while the table inside it ran
                  // to 700, so the right-hand columns sat outside their own
                  // border with nothing framing them.
                  minWidth: SERVICES_MIN_WIDTH,
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  {/* Pinned to the left edge of the scroller, so scrolling out
                      to the Status and Edit columns on a phone does not take
                      the name of the category you are looking at with it. */}
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      position: "sticky",
                      left: 0,
                    }}
                  >
                    <Typography
                      sx={{
                        fontWeight: 600,
                        textTransform: "uppercase",
                        fontSize: "0.8rem",
                        letterSpacing: 0.5,
                      }}
                    >
                      {category ?? "Uncategorized"}
                    </Typography>
                    <Chip
                      label={group.length}
                      size="small"
                      sx={{ height: 18, fontSize: "0.7rem" }}
                    />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <Table
                    size="small"
                    sx={{ tableLayout: "fixed", minWidth: SERVICES_MIN_WIDTH }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: cols.name }}>Name</TableCell>
                        <TableCell align="right" sx={{ width: cols.price }}>
                          Price
                        </TableCell>
                        {canSeeCost && (
                          <TableCell align="right" sx={{ width: cols.cost }}>
                            Cost
                          </TableCell>
                        )}
                        {canSeeDeal && (
                          <TableCell sx={{ width: cols.partner }}>
                            Partner
                          </TableCell>
                        )}
                        <TableCell sx={{ width: cols.status }}>
                          Status
                        </TableCell>
                        {canWrite && (
                          <TableCell align="right" sx={{ width: cols.edit }}>
                            Edit
                          </TableCell>
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.map((s) => (
                        <TableRow key={s.serviceId} hover>
                          <TableCell>{s.name}</TableCell>
                          <TableCell align="right">
                            {formatMoney(s.price)}
                          </TableCell>
                          {canSeeCost && (
                            <TableCell align="right">
                              {hasNoCostItem(s) ? (
                                <Tooltip title="This service uses stock with no last cost, so it prices at $0.00 and any partner's cut is overstated. Set a cost on the item in Inventory.">
                                  <Stack
                                    direction="row"
                                    spacing={0.5}
                                    sx={{
                                      alignItems: "center",
                                      justifyContent: "flex-end",
                                    }}
                                  >
                                    <WarningAmberIcon
                                      fontSize="small"
                                      color="error"
                                    />
                                    <Typography
                                      variant="body2"
                                      color="error.main"
                                      sx={{ fontWeight: 700 }}
                                    >
                                      {formatMoney(s.costTotal)}
                                    </Typography>
                                  </Stack>
                                </Tooltip>
                              ) : s.costTotal && Number(s.costTotal) > 0 ? (
                                formatMoney(s.costTotal)
                              ) : (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  &mdash;
                                </Typography>
                              )}
                            </TableCell>
                          )}
                          {canSeeDeal && (
                            <TableCell>
                              {s.partnerName ?? (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  Clinic
                                </Typography>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            {s.isActive ? (
                              <Chip
                                size="small"
                                color="success"
                                label="Active"
                              />
                            ) : (
                              <Chip size="small" label="Inactive" />
                            )}
                          </TableCell>
                          {canWrite && (
                            <TableCell align="right">
                              <IconButton
                                size="small"
                                aria-label="Edit service"
                                onClick={() => openEdit(s)}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Box>
      )}

      <ServiceFormDialog
        open={dialogOpen}
        service={editing}
        categoryOptions={categoryOptions}
        canEditDeal={canEditDeal}
        canEditCost={canEditCost}
        onClose={() => setDialogOpen(false)}
        onSaved={() => void load(query, activeOnly)}
      />
    </Box>
  );
}
