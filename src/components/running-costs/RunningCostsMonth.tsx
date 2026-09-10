"use client";

import { useMemo, useState } from "react";
import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import {
  Box,
  IconButton,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import StatCard from "@/components/ui/StatCard";
import { apiRequest } from "@/utils/api-client";
import { formatDate, formatMoney } from "@/utils/format";
import {
  ALL_CATEGORIES_SLUG,
  RUNNING_COST_CATEGORIES,
} from "@/constants/running-cost";
import {
  categoryTabSlug,
  periodLabel,
  periodPath,
  type CostPeriod,
} from "@/utils/running-cost";
import { useCostSaved } from "@/hooks/useCostSaved";
import RunningCostFormDialog from "./RunningCostFormDialog";
import type { RunningCostDTO } from "@/types/entities";

interface Props {
  /** Every cost in the month, newest first. */
  costs: RunningCostDTO[];
  period: CostPeriod;
  /** Category tab from the URL, or ALL_CATEGORIES_SLUG. */
  activeCategory: string;
  canWrite: boolean;
}

interface CategoryTab {
  slug: string;
  label: string;
  total: number;
  count: number;
}

// Suggested categories sort in the order they are declared and anything typed
// by hand sorts after them, so the strip does not reshuffle as new categories
// appear in a month.
const RANK = new Map<string, number>(
  RUNNING_COST_CATEGORIES.map((c, i) => [c, i]),
);
const rankOf = (category: string) => RANK.get(category) ?? RANK.size;

export default function RunningCostsMonth({
  costs,
  period,
  activeCategory,
  canWrite,
}: Props) {
  const router = useRouter();
  const onSaved = useCostSaved();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<RunningCostDTO | null>(null);

  // The tab is owned by the URL, but held here too so a click repaints from the
  // rows already in memory instead of waiting for the navigation to come back.
  // Both land on the same value, so the switch is instant and still deep-links.
  const [tab, setTab] = useState(activeCategory);
  const [urlTab, setUrlTab] = useState(activeCategory);
  if (activeCategory !== urlTab) {
    setUrlTab(activeCategory);
    setTab(activeCategory);
  }

  // One pass over the month builds the tab strip, its totals and the month
  // total. Nothing here goes back to the server: the month is already loaded,
  // so filtering and searching it is local work.
  const { tabs, monthTotal } = useMemo(() => {
    const byCategory = new Map<string, CategoryTab>();
    let total = 0;

    // Every known category gets a tab whether or not this month used it, so the
    // strip reads as the full set of places a cost can go rather than as a
    // list of what happened to be spent. A month with one category otherwise
    // renders a single tab beside "All categories" showing the same figure
    // twice, which looks like a bug. Empty ones sit at zero and stay clickable.
    for (const category of RUNNING_COST_CATEGORIES) {
      byCategory.set(categoryTabSlug(category), {
        slug: categoryTabSlug(category),
        label: category,
        total: 0,
        count: 0,
      });
    }

    for (const c of costs) {
      const amount = Number(c.amount) || 0;
      total += amount;
      const slug = categoryTabSlug(c.category);
      const found = byCategory.get(slug);
      if (found) {
        found.total += amount;
        found.count += 1;
      } else {
        byCategory.set(slug, {
          slug,
          label: c.category,
          total: amount,
          count: 1,
        });
      }
    }

    const rest = [...byCategory.values()].sort(
      (a, b) =>
        rankOf(a.label) - rankOf(b.label) || a.label.localeCompare(b.label),
    );

    // A category filtered on but absent this month keeps its tab, so moving
    // between months never drops the tab under the reader's feet. Only reachable
    // for a category typed in by hand: the standard ones are all seeded above.
    if (tab !== ALL_CATEGORIES_SLUG && !byCategory.has(tab)) {
      rest.push({
        slug: tab,
        label: tabLabelFromSlug(tab),
        total: 0,
        count: 0,
      });
    }

    return {
      tabs: [
        {
          slug: ALL_CATEGORIES_SLUG,
          label: "All categories",
          total,
          count: costs.length,
        },
        ...rest,
      ],
      monthTotal: total,
    };
  }, [costs, tab]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return costs.filter((c) => {
      if (tab !== ALL_CATEGORIES_SLUG && categoryTabSlug(c.category) !== tab) {
        return false;
      }
      if (!needle) return true;
      return (
        c.description.toLowerCase().includes(needle) ||
        c.category.toLowerCase().includes(needle) ||
        (c.notes?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [costs, tab, query]);

  const shownTotal = useMemo(
    () => rows.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
    [rows],
  );

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.slug === tab),
  );
  const label = periodLabel(period);

  async function handleDelete(cost: RunningCostDTO) {
    if (
      !window.confirm(
        `Delete the ${formatMoney(cost.amount)} ${cost.description} cost?`,
      )
    ) {
      return;
    }
    await apiRequest(`/api/running-costs/${cost.costId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Box>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          mb: 2,
          gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(2, 220px)" },
        }}
      >
        <StatCard
          label={label}
          value={formatMoney(monthTotal)}
          hint={`${costs.length} ${costs.length === 1 ? "cost" : "costs"}`}
        />
        <StatCard
          label="Shown below"
          value={formatMoney(shownTotal)}
          hint={`${rows.length} of ${costs.length}`}
        />
      </Box>

      <Tabs
        value={activeIndex}
        variant="scrollable"
        scrollButtons={false}
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        {tabs.map((t) => (
          <Tab
            key={t.slug}
            component={Link}
            href={periodPath(period, t.slug)}
            scroll={false}
            // Repaint from what is already loaded; the navigation behind it only
            // has to catch the address bar up.
            onClick={() => setTab(t.slug)}
            sx={{ alignItems: "flex-start", textTransform: "none", py: 1 }}
            label={
              <Stack sx={{ alignItems: "flex-start" }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatMoney(t.total)} · {t.count}
                </Typography>
              </Stack>
            }
          />
        ))}
      </Tabs>

      <TextField
        placeholder={`Search in ${label}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        fullWidth
        size="small"
        sx={{ mb: 2 }}
      />

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Item</TableCell>
              <TableCell>Category</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Added by</TableCell>
              {canWrite && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 6 : 5} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    {costs.length === 0
                      ? `Nothing logged in ${label}.`
                      : "Nothing here matches."}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.costId} hover>
                  <TableCell>{formatDate(c.incurredOn)}</TableCell>
                  <TableCell>
                    {c.description}
                    {c.notes && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {c.notes}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{c.category}</TableCell>
                  <TableCell align="right">{formatMoney(c.amount)}</TableCell>
                  <TableCell>{c.createdByName ?? "-"}</TableCell>
                  {canWrite && (
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => setEditing(c)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => void handleDelete(c)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <RunningCostFormDialog
        open={editing !== null}
        cost={editing}
        onClose={() => setEditing(null)}
        onSaved={onSaved}
      />
    </Box>
  );
}

// Best-effort name for a tab kept alive from the URL with no rows behind it to
// read the real spelling off. Only ever shown for the month you are already on.
function tabLabelFromSlug(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
