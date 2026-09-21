import { z } from "zod";
import { CATEGORY_GROUPS, SUPPLIER_ITEM_ORDERS } from "@/constants/analytics";

// The analytics sections that can be re-queried for a custom date range. The
// snapshot section (inventory) is not time-boxed and so is not here.
export const ANALYTICS_SECTIONS = [
  "revenue",
  "profit",
  "purchases",
  "bookings",
  "categories",
  "items",
  "clients",
] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// The sections that are a position rather than a period. They take no range,
// and since every section is now fetched when it is opened rather than computed
// at first paint, they need a route of their own to arrive through.
export const ANALYTICS_SNAPSHOTS = ["inventory"] as const;
export type AnalyticsSnapshot = (typeof ANALYTICS_SNAPSHOTS)[number];

export type AnalyticsPanel = AnalyticsSection | AnalyticsSnapshot;

// Validates the /api/analytics query. A boxable section must carry an inclusive,
// correctly-ordered range; a snapshot must not be given one, which is what
// keeps "the inventory section for last March" from looking like a real request.
export const analyticsPanelQuerySchema = z.union([
  z
    .object({
      section: z.enum(ANALYTICS_SECTIONS),
      from: dateString,
      to: dateString,
    })
    .refine((d) => d.from <= d.to, {
      message: "from must be on or before to",
      path: ["from"],
    }),
  z.object({ section: z.enum(ANALYTICS_SNAPSHOTS) }),
]);

export type AnalyticsPanelQuery = z.infer<typeof analyticsPanelQuerySchema>;

// Validates the per-item performance lookup: which item, over which range. The
// range is the same shape the sections use, so the detail view and the
// leaderboard above it always speak about the same window.
export const itemPerformanceQuerySchema = z
  .object({
    itemId: z.coerce.number().int().positive(),
    from: dateString,
    to: dateString,
  })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type ItemPerformanceQuery = z.infer<typeof itemPerformanceQuerySchema>;

// Validates the "top lines in this category" lookup. The group and the label
// are exactly what the category table shows, and the comparison mode is the
// one the table was set to, so the dialog is the row it was opened from.
export const categoryTopQuerySchema = z
  .object({
    group: z.enum(CATEGORY_GROUPS.map((g) => g.key) as [string, ...string[]]),
    category: z.string().trim().min(1).max(100),
    mode: z.enum(["mom", "yoy"]),
    from: dateString,
    to: dateString,
  })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type CategoryTopQuery = z.infer<typeof categoryTopQuerySchema>;

// Validates the "this supplier's best or slowest sellers" lookup. The range is
// the purchases section's own, so the list describes the same window as the
// figures it was opened from.
export const supplierItemsQuerySchema = z
  .object({
    supplierId: z.coerce.number().int().positive(),
    order: z.enum(SUPPLIER_ITEM_ORDERS),
    from: dateString,
    to: dateString,
  })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type SupplierItemsQuery = z.infer<typeof supplierItemsQuerySchema>;

// Validates the predictive item search. An empty query is allowed and returns a
// starting page, so opening the picker shows something rather than a blank box.
export const itemSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export type ItemSearchQuery = z.infer<typeof itemSearchQuerySchema>;

// The two client lists the clients section builds, and which of them a download
// is asking for. They are the same question from either end: who traded in this
// window, and who did not.
export const CLIENT_LISTS = ["top", "lapsed"] as const;
export type ClientListKind = (typeof CLIENT_LISTS)[number];

// Validates a client-list download. It carries the range the section was set to
// when the icon was clicked, so the file and the table on screen always describe
// the same window.
export const clientListExportQuerySchema = z
  .object({
    list: z.enum(CLIENT_LISTS),
    from: dateString,
    to: dateString,
  })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type ClientListExportQuery = z.infer<typeof clientListExportQuerySchema>;
