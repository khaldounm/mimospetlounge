// Grouping for the category comparison section. Invoice lines carry either an
// inventory item or a service, and each of those already has a free-text
// category, so nothing new is stored: this file only decides how those
// categories roll up on the report.

// The one Service.category the clinic reads as a separate business line rather
// than as veterinary work. Every other service category rolls up under vet.
export const GROOMING_SERVICE_CATEGORY = "Grooming";

// Service categories that are not a business line at all. Adjustment holds the
// counter's Discount line and the legacy import's "Unknown legacy product",
// both of which carry a negative or unattributable amount: folding them into
// vet work would understate what the vets actually billed. They are reported
// under Other so the group totals still add up to billed revenue.
export const NON_TRADE_SERVICE_CATEGORIES = new Set(["Adjustment"]);

// Shown for a line whose item or service has no category set. Named rather than
// dropped, so the group totals still add up to billed revenue.
export const UNCATEGORISED_LABEL = "Uncategorised";

// The label for a free-text invoice line: no item, no service, so there is no
// category to take. Common on legacy data.
export const AD_HOC_LABEL = "Ad-hoc lines";

// Display order on the report, biggest business line first.
export const CATEGORY_GROUPS = [
  { key: "products", label: "Products" },
  { key: "vet", label: "Vet services" },
  { key: "grooming", label: "Grooming services" },
  { key: "other", label: "Other" },
] as const;

export type CategoryGroupKey = (typeof CATEGORY_GROUPS)[number]["key"];

// How many lines the "what is behind this category" dialog shows. Fetched only
// when a category is opened, so the section itself stays as light as it was.
export const CATEGORY_TOP_LIMIT = 15;

// ---- Services ----

// How many bars the "Top services by revenue" chart shows. The chart is the
// shape of the money, not the list: the full set of services performed, with
// how often, is the table beside it.
export const TOP_SERVICES_LIMIT = 8;

// ---- By-item performance ----

// How many items the leaderboard shows when the section is opened. Ten is what
// the counter asked for: enough to see the movers, short enough to read without
// scrolling.
export const TOP_ITEMS_LIMIT = 10;

// Cap on the predictive item search. The picker is a keyboard search, not a
// browse: past a couple of dozen hits the answer is "type more", not "scroll".
export const ITEM_SEARCH_LIMIT = 20;

// ---- Client lists ----

// How many rows the top-clients and lapsed-clients tables show on screen. The
// download carries the whole list, so the table is a preview of it rather than
// the report itself.
export const CLIENT_LIST_LIMIT = 10;

// The clients section opens on a year, where every other section opens on the
// current month. A month of "who has not been in" is very nearly the whole
// client book; a year is the question a recall list is actually asking.
export const CLIENTS_DEFAULT_PRESET_ID = "last-12-months";

// The old system's counter account, imported as a client like any other. It is
// where every anonymous cash sale was booked, so it carries thousands of
// invoices and would sit permanently at the top of the client lists, pushing a
// real client off them. This app books a walk-in against no client at all, so
// nothing new lands here. Keyed on the legacy id because that is what the import
// set and what will not change; drop this to have it counted like anyone else.
export const COUNTER_SALE_LEGACY_CLIENT_ID = 1;

// ---- Trend charts ----

// The pictures a trend chart can draw, switched on its card. "bars" is one
// bar per bucket (side by side when there are several series); "stacked" is
// the series piled into one area so the top edge is their total; "lines" is
// the line chart every trend opened with.
export const CHART_VIEWS = [
  { key: "bars", label: "Bars" },
  { key: "stacked", label: "Stacked" },
  { key: "lines", label: "Lines" },
] as const;

export type ChartView = (typeof CHART_VIEWS)[number]["key"];

export const DEFAULT_CHART_VIEW: ChartView = "stacked";

// Colours for the stacked areas, by series order. A translucent wash that
// fades to nothing under a 2px line in the same colour, so the bands read as
// glass rather than paint; the exact opacities are in StackedAreaChart.
//
// Two selections of the same hues: deeper on the cream page, where a pastel
// line would fade into the paper, pastel on the near-black one, where the
// deep step would sink. Adjacent pairs were checked with the dataviz palette
// validator against this app's surfaces: every pair clears the normal-vision
// floor and 3:1 contrast in both modes; the warm slot beside green sits in
// the colour-blind 6-8 band, which is allowed here because every band also
// has its own line, its legend entry and its tooltip row. The dark steps are
// brighter than the validator's lightness band on purpose: that is what
// pastel on dark is.
export const AREA_COLORS = {
  light: ["#0d9488", "#7c3aed", "#db2777", "#16a34a"],
  dark: ["#2dd4bf", "#a78bfa", "#f472b6", "#4ade80"],
} as const;
