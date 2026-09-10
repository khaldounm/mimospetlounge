"use client";

import { useMemo } from "react";
import Link from "@/components/ui/AppLink";
import { usePathname } from "next/navigation";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { MONTH_LABELS_SHORT } from "@/constants/running-cost";
import { formatMoneyCompact } from "@/utils/format";
import {
  currentPeriod,
  monthSlug,
  periodFromPath,
  periodPath,
  type CostPeriod,
} from "@/utils/running-cost";
import type { CostMonthDTO } from "@/types/entities";

interface Props {
  months: CostMonthDTO[];
}

/**
 * Year row + month row above the list.
 *
 * Lives in the layout and reads the active period out of the pathname rather
 * than out of props, so moving between months re-renders only the list below
 * it: the rail itself is fetched once per visit and then never asks the server
 * anything again. Every chip is a prefetched Link, so the month it points at is
 * already in flight before the click lands.
 *
 * Changing period keeps the category tab you were on, so comparing one category
 * across months is a row of single clicks rather than a re-pick each time.
 */
export default function RunningCostPeriodNav({ months }: Props) {
  const pathname = usePathname();
  const here = periodFromPath(pathname);
  const active = here?.period ?? currentPeriod();
  // Pulled out as scalars: the memo below keys off the year, and depending on a
  // plain value keeps it memoizable where depending on the object would not.
  const activeYear = active.year;
  const activeMonth = active.month;
  const category = here?.category;

  // Totals keyed for lookup, derived from the data alone so the pass runs once
  // per fetch rather than once per click on the rail.
  const { monthTotals, yearTotals } = useMemo(() => {
    const byMonth = new Map<string, CostMonthDTO>();
    const byYear = new Map<number, number>();
    for (const m of months) {
      byMonth.set(`${m.year}-${m.month}`, m);
      byYear.set(m.year, (byYear.get(m.year) ?? 0) + Number(m.total));
    }
    return { monthTotals: byMonth, yearTotals: byYear };
  }, [months]);

  // Years that have costs, plus the year being viewed and the current one, so
  // the rail can always show where you are and never traps you in the past.
  // A handful of numbers, cheap enough to rebuild on render.
  const years = [
    ...new Set([...yearTotals.keys(), activeYear, currentPeriod().year]),
  ].sort((a, b) => b - a);

  // Landing on another year keeps the month where it is, so switching year is a
  // like-for-like comparison rather than a jump to an arbitrary month.
  const yearPath = (year: number) =>
    periodPath({ year, month: activeMonth }, category);

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
        {years.map((year) => (
          <YearChip
            key={year}
            href={yearPath(year)}
            year={year}
            total={yearTotals.get(year) ?? 0}
            selected={year === activeYear}
          />
        ))}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 1,
          gridTemplateColumns: {
            xs: "repeat(4, minmax(0, 1fr))",
            sm: "repeat(6, minmax(0, 1fr))",
            md: "repeat(12, minmax(0, 1fr))",
          },
        }}
      >
        {MONTH_LABELS_SHORT.map((label, month) => {
          const found = monthTotals.get(`${activeYear}-${month}`);
          return (
            <MonthChip
              key={label}
              href={periodPath({ year: activeYear, month }, category)}
              label={label}
              total={found ? formatMoneyCompact(found.total) : null}
              selected={month === activeMonth}
              period={{ year: activeYear, month }}
            />
          );
        })}
      </Box>
    </Box>
  );
}

// Built from the same Paper + Typography pair as the month tiles below, so both
// rows of the rail paint through one code path and every piece of text sits in
// an element that states its own color.
function YearChip({
  href,
  year,
  total,
  selected,
}: {
  href: string;
  year: number;
  total: number;
  selected: boolean;
}) {
  const ink = selected ? "primary.contrastText" : "text.primary";
  return (
    <Paper
      component={Link}
      href={href}
      variant="outlined"
      aria-current={selected ? "page" : undefined}
      // Spelled out rather than left to the text content, which would otherwise
      // be announced as one run-together string ("2026$2K").
      aria-label={`${year}${total > 0 ? `, ${formatMoneyCompact(total)}` : ", nothing logged"}`}
      sx={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 0.75,
        px: 2,
        py: 0.75,
        borderRadius: 5,
        textDecoration: "none",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "primary.main" : "transparent",
      }}
    >
      <Typography
        variant="subtitle2"
        component="span"
        sx={{ fontWeight: 700, color: ink }}
      >
        {year}
      </Typography>
      {total > 0 && (
        <Typography
          variant="caption"
          sx={{ color: ink, opacity: selected ? 0.75 : 0.65 }}
        >
          {formatMoneyCompact(total)}
        </Typography>
      )}
    </Paper>
  );
}

function MonthChip({
  href,
  label,
  total,
  selected,
  period,
}: {
  href: string;
  label: string;
  total: string | null;
  selected: boolean;
  period: CostPeriod;
}) {
  return (
    <Paper
      component={Link}
      href={href}
      variant="outlined"
      aria-current={selected ? "page" : undefined}
      aria-label={`${monthSlug(period.month)} ${period.year}${
        total ? `, ${total}` : ", nothing logged"
      }`}
      sx={{
        display: "block",
        px: 1,
        py: 0.75,
        textAlign: "center",
        textDecoration: "none",
        borderColor: selected ? "primary.main" : "divider",
        borderWidth: selected ? 2 : 1,
        bgcolor: selected ? "action.selected" : "transparent",
        // A month with nothing in it stays reachable but recedes, so the months
        // that actually cost something are what the eye lands on.
        opacity: total || selected ? 1 : 0.45,
      }}
    >
      <Typography
        variant="body2"
        sx={{ fontWeight: selected ? 700 : 500, lineHeight: 1.3 }}
      >
        {label}
      </Typography>
      <Typography
        variant="caption"
        color={selected ? "text.primary" : "text.secondary"}
        noWrap
        sx={{ display: "block", lineHeight: 1.3 }}
      >
        {total ?? "-"}
      </Typography>
    </Paper>
  );
}
