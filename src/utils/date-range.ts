// Date-range helpers shared by the analytics section builders (server) and the
// DateRangeControl (client). Pure and timezone-local: native date inputs and
// the app's other date handling all work in local time, so we match that.

import type { AnalyticsRange } from "@/types/entities";

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD" -> local midnight Date. (new Date("YYYY-MM-DD") would parse as
// UTC, which can shift the day, so we build it from parts instead.)
export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// An inclusive range as a half-open [from, toExclusive) pair for date queries
// (so the whole of the `to` day is included).
export function rangeBounds(range: AnalyticsRange): {
  from: Date;
  toExclusive: Date;
} {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  const toExclusive = new Date(
    to.getFullYear(),
    to.getMonth(),
    to.getDate() + 1,
  );
  return { from, toExclusive };
}

// The same range for a date-only column (Prisma `@db.Date`), as UTC midnights.
//
// rangeBounds above is right for timestamp columns, where local midnight is the
// real instant a day starts. It is wrong for a date-only column: Postgres holds
// no time there, and the driver reduces the bound to a calendar date in UTC. In
// a timezone ahead of UTC, local midnight is the previous day once converted, so
// both ends of the window silently slide a day earlier and a row dated today
// falls outside a range that ends today.
//
// Building the bounds at UTC midnight makes the comparison land on the calendar
// dates actually asked for, in any timezone.
export function dateOnlyBounds(range: AnalyticsRange): {
  from: Date;
  toExclusive: Date;
} {
  const to = parseLocalDate(range.to);
  const next = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  return {
    from: new Date(`${range.from}T00:00:00.000Z`),
    toExclusive: new Date(`${formatLocalDate(next)}T00:00:00.000Z`),
  };
}

// ---- bucketing ----

export type Granularity = "day" | "month";

export interface Bucket {
  key: string;
  label: string;
}

// Short ranges read best as daily bars; longer ones as monthly. The cutoff keeps
// the bar count sane (a quarter of daily bars at most before switching).
export function pickGranularity(from: Date, toExclusive: Date): Granularity {
  const days = Math.round((toExclusive.getTime() - from.getTime()) / DAY_MS);
  return days <= 92 ? "day" : "month";
}

// The bucket key a date falls into, matching buildBuckets' keys.
export function bucketKeyOf(d: Date, granularity: Granularity): string {
  return granularity === "day"
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Ordered buckets spanning [from, toExclusive), oldest first.
export function buildBuckets(
  from: Date,
  toExclusive: Date,
  granularity: Granularity,
): Bucket[] {
  const out: Bucket[] = [];
  const cursor =
    granularity === "day"
      ? new Date(from.getFullYear(), from.getMonth(), from.getDate())
      : new Date(from.getFullYear(), from.getMonth(), 1);

  while (cursor < toExclusive) {
    out.push({
      key: bucketKeyOf(cursor, granularity),
      label:
        granularity === "day"
          ? cursor.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : cursor.toLocaleDateString("en-US", {
              month: "short",
              year: "2-digit",
            }),
    });
    if (granularity === "day") cursor.setDate(cursor.getDate() + 1);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

// ---- presets ----

export interface DatePreset {
  id: string;
  label: string;
}

// Lazy shortcuts shown next to the calendar, shortest first.
export const DATE_PRESETS: DatePreset[] = [
  { id: "today", label: "Today" },
  { id: "last-7-days", label: "Last 7 days" },
  { id: "last-30-days", label: "Last 30 days" },
  { id: "this-month", label: "This month" },
  { id: "this-year", label: "This year" },
  { id: "last-12-months", label: "Last 12 months" },
];

export const DEFAULT_PRESET_ID = "this-month";

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

// Resolve a preset id to a concrete range relative to `now`, or null if unknown.
export function resolvePreset(
  id: string,
  now: Date = new Date(),
): AnalyticsRange | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = formatLocalDate(today);
  switch (id) {
    case "today":
      return { from: to, to };
    case "last-7-days":
      return { from: formatLocalDate(addDays(today, -6)), to };
    case "last-30-days":
      return { from: formatLocalDate(addDays(today, -29)), to };
    case "this-month":
      return {
        from: formatLocalDate(
          new Date(today.getFullYear(), today.getMonth(), 1),
        ),
        to,
      };
    case "this-year":
      return { from: formatLocalDate(new Date(today.getFullYear(), 0, 1)), to };
    case "last-12-months":
      return {
        from: formatLocalDate(
          new Date(today.getFullYear(), today.getMonth() - 11, 1),
        ),
        to,
      };
    default:
      return null;
  }
}

// The default range the page seeds boxable sections with.
export function defaultRange(now: Date = new Date()): AnalyticsRange {
  return resolvePreset(DEFAULT_PRESET_ID, now)!;
}

// The preset id whose resolved range equals `range`, or null for a custom range.
// Lets the control highlight the active shortcut.
export function matchPreset(
  range: AnalyticsRange,
  now: Date = new Date(),
): string | null {
  for (const p of DATE_PRESETS) {
    const r = resolvePreset(p.id, now);
    if (r && r.from === range.from && r.to === range.to) return p.id;
  }
  return null;
}

// Human label for a range, e.g. "Jul 1 - Jul 24, 2026" (or a single day).
export function formatRangeLabel(range: AnalyticsRange): string {
  const from = parseLocalDate(range.from);
  const to = parseLocalDate(range.to);
  const full: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (range.from === range.to) return to.toLocaleDateString("en-US", full);
  // The year is said once when both ends share it. A range that crosses a
  // year end says it on both, or "Sep 21 - Sep 21, 2026" reads as one day.
  const fromStr = from.toLocaleDateString(
    "en-US",
    from.getFullYear() === to.getFullYear()
      ? { month: "short", day: "numeric" }
      : full,
  );
  return `${fromStr} - ${to.toLocaleDateString("en-US", full)}`;
}

// ---- URL round-tripping ----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolve a from/to pair off a URL into a range, or null when either is absent
// or malformed so the caller can fall back to its default. Keeping the range in
// the URL is what lets a chosen period survive a reload and follow a link
// between screens, instead of silently resetting and showing a different period
// under the same heading.
export function rangeFromParams(
  from: string | undefined,
  to: string | undefined,
): AnalyticsRange | null {
  if (!from || !to) return null;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return null;
  if (from > to) return null; // ISO dates sort lexicographically
  return { from, to };
}

// The query string carrying a range, for links and history entries.
export function rangeQuery(range: AnalyticsRange): string {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

// Label for the figures that are a position rather than a flow. A balance is a
// point in time, so it is stated as at the range's last day. Ranges ending today
// are the common case and read better as "today" than as a date the reader has
// to match against a calendar.
export function rangeEndLabel(
  range: AnalyticsRange,
  now: Date = new Date(),
): string {
  if (range.to === formatLocalDate(now)) return "today";
  return parseLocalDate(range.to).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// A short summary for a section header: the matching preset's label when there
// is one, otherwise the explicit date range.
export function rangeSummary(
  range: AnalyticsRange,
  now: Date = new Date(),
): string {
  const id = matchPreset(range, now);
  const preset = id ? DATE_PRESETS.find((p) => p.id === id) : null;
  return preset ? preset.label : formatRangeLabel(range);
}

// ---- period-over-period ----

export type ComparisonMode = "mom" | "yoy";

// The equivalent window one month (MoM) or one year (YoY) earlier. Shifting by
// calendar month rather than by a fixed day count is what makes a part-finished
// month compare like for like: Aug 1-25 reads against Jul 1-25, not against a
// 25-day window that happens to start mid-July.
export function priorRange(
  range: AnalyticsRange,
  mode: ComparisonMode,
): AnalyticsRange {
  const months = mode === "mom" ? -1 : -12;
  return {
    from: shiftLocalDate(range.from, { months }),
    to: shiftLocalDate(range.to, { months }),
  };
}

// ---- Date-only arithmetic ----

// Whether a string is the "YYYY-MM-DD" an <input type="date"> holds. A date
// input reports "" while it is being typed, and a shift from "" is nonsense.
export function isDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// "YYYY-MM-DD" moved by whole months and/or days, in local time like the rest
// of this file. Month steps keep the day number and clamp to the end of the
// target month: Mar 31 back a month is Feb 28, not Mar 3, and a booster given
// on 31 Jan is due 28 Feb. Days are applied after months so "+1 month" and
// "+21 days" each mean exactly what they say. Shared by the period-over-period
// comparison above and the recall presets on a clinical record.
export function shiftLocalDate(
  date: string,
  by: { days?: number; months?: number },
): string {
  const d = parseLocalDate(date);
  if (by.months) {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + by.months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  if (by.days) d.setDate(d.getDate() + by.days);
  return formatLocalDate(d);
}

// Whole days from one "YYYY-MM-DD" to another, negative when `to` is earlier.
// Rounded because a DST change makes one of the days 23 or 25 hours long.
export function daysBetweenLocal(from: string, to: string): number {
  return Math.round(
    (parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / DAY_MS,
  );
}
