import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { CLINIC } from "@/constants/clinic";
import {
  SUPPLIER_ITEM_ORDER_LABELS,
  type SupplierItemMeasure,
  type SupplierItemOrder,
  type SupplierItemView,
} from "@/constants/analytics";
import {
  formatClinicDateTime,
  formatMoney,
  formatShare,
  formatUnits,
} from "@/utils/format";
import { formatRangeLabel } from "@/utils/date-range";
import {
  categoryMax,
  categoryNote,
  flatLines,
  flatNote,
  measureOf,
  rankedLines,
  shareOf,
  soldSummary,
  sortedCategories,
  supplierItemsCaption,
  supplierNote,
  supplierTotals,
} from "@/utils/supplier-items";
import type {
  AnalyticsRange,
  SupplierItemLine,
  SupplierItemLines,
  SupplierOption,
} from "@/types/entities";

// One supplier's best or slowest sellers as pages to hand over: the clinic's
// letterhead, the supplier, the dates, then the list laid out the way the
// dialog was showing it: one section per category with its fifteen lines and
// what they add up to, and the supplier's line under them all; or the one
// flat fifteen across the supplier on a single page. Rendered in the browser
// from the figures the dialog already holds, so a download costs the server
// nothing and shows exactly what was on screen. The footer is flow content
// at the end, not pinned to every page: react-pdf mislays a pinned footer on
// longer documents, and six categories of fifteen run to three pages.

const COLORS = {
  text: "#1a1a1a",
  muted: "#666666",
  line: "#d0d0d0",
  rule: "#1a1a1a",
  band: "#f4f4f5",
  track: "#e8e8ea",
  fill: "#8fbc8f",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontSize: 9,
    color: COLORS.text,
    fontFamily: "Helvetica",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.rule,
    paddingBottom: 10,
    marginBottom: 14,
  },
  headerRight: { width: "45%", alignItems: "flex-end" },
  title: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  muted: { color: COLORS.muted },
  bold: { fontFamily: "Helvetica-Bold" },
  logo: { marginBottom: 6 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 1 },
  metaLabel: { color: COLORS.muted, marginRight: 6 },

  subject: { marginBottom: 12 },
  sectionLabel: {
    fontSize: 7.5,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 3,
  },
  supplierName: { fontSize: 13, fontFamily: "Helvetica-Bold" },

  headRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.rule,
    paddingVertical: 5,
    paddingHorizontal: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: COLORS.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.line,
    paddingVertical: 4,
    paddingHorizontal: 5,
  },
  // A category's own line above its products: what their bars and shares
  // are measured against.
  bandRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.band,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.line,
    paddingVertical: 5,
    paddingHorizontal: 5,
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
  },
  bandSummary: {
    fontFamily: "Helvetica",
    color: COLORS.muted,
    fontSize: 8,
  },
  emptyRow: {
    paddingVertical: 4,
    paddingHorizontal: 5,
    paddingLeft: 36,
    color: COLORS.muted,
  },
  categoryNote: {
    paddingHorizontal: 5,
    paddingTop: 3,
    fontSize: 7.5,
    color: COLORS.muted,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1.5,
    borderTopColor: COLORS.rule,
    paddingVertical: 6,
    paddingHorizontal: 5,
    marginTop: 8,
    fontFamily: "Helvetica-Bold",
  },

  colRank: { width: "6%", color: COLORS.muted },
  colName: { width: "50%", paddingRight: 6 },
  colUnits: { width: "10%", textAlign: "right" },
  colShare: { width: "20%", paddingLeft: 10, paddingRight: 4 },
  colBilled: { width: "14%", textAlign: "right" },

  // The share as a bar with its figure beside it, the same picture the dialog
  // draws: filled against the best of its group, labelled with the share of
  // the whole it belongs to.
  shareCell: { flexDirection: "row", alignItems: "center" },
  track: {
    flexGrow: 1,
    height: 6,
    backgroundColor: COLORS.track,
    borderRadius: 1,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: COLORS.fill },
  shareText: { width: 30, textAlign: "right", fontSize: 8 },

  note: { marginTop: 14, fontSize: 7.5, color: COLORS.muted },
  footer: {
    marginTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.line,
    paddingTop: 6,
    fontSize: 7.5,
    color: COLORS.muted,
    textAlign: "center",
  },
});

function ShareCell({
  units,
  max,
  share,
}: {
  units: number;
  max: number;
  share: number | null;
}) {
  const width =
    max > 0 && units > 0 ? Math.min(Math.max((units / max) * 100, 2), 100) : 0;
  return (
    <View style={styles.shareCell}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${width}%` }]} />
      </View>
      <Text style={styles.shareText}>
        {share === null ? "" : formatShare(share)}
      </Text>
    </View>
  );
}

// The ranked rows of one list: bars against the best of the group on the
// measure, shares of the group's total on it, the group being a category or
// the supplier.
function Lines({
  lines,
  measure,
  max,
  whole,
}: {
  lines: SupplierItemLine[];
  measure: SupplierItemMeasure;
  max: number;
  whole: number;
}) {
  return lines.map((line, i) => (
    <View key={line.itemId} style={styles.row} wrap={false}>
      <Text style={styles.colRank}>{i + 1}</Text>
      <Text style={styles.colName}>{line.name}</Text>
      <Text style={styles.colUnits}>{formatUnits(line.units)}</Text>
      <View style={styles.colShare}>
        <ShareCell
          units={measureOf(line, measure)}
          max={max}
          share={shareOf(measureOf(line, measure), whole)}
        />
      </View>
      <Text style={styles.colBilled}>{formatMoney(line.revenue)}</Text>
    </View>
  ));
}

export default function SupplierItemsPdfDocument({
  supplier,
  order,
  view,
  measure,
  range,
  data,
  generatedAt,
  logoSrc = CLINIC.logo.src,
}: {
  supplier: SupplierOption;
  order: SupplierItemOrder;
  view: SupplierItemView;
  measure: SupplierItemMeasure;
  range: AnalyticsRange;
  data: SupplierItemLines;
  // When the file was made, as an ISO string, so the same report pulled twice
  // a month apart can be told apart.
  generatedAt: string;
  logoSrc?: string;
}) {
  const label = SUPPLIER_ITEM_ORDER_LABELS[measure][order];
  const address = CLINIC.addressLines.filter(Boolean);
  const totals = supplierTotals(data);
  // The supplier's best seller or earner, for the flat list's bars, and the
  // biggest category, for the band rows'.
  const wholeMax =
    measure === "units" ? totals.maxLineUnits : totals.maxLineRevenue;
  const categoriesMax =
    measure === "units" ? totals.maxUnits : totals.maxRevenue;
  const flat = view === "item" ? flatLines(data, measure) : [];
  const note =
    view === "item" ? flatNote(data, flat, measure) : supplierNote(data);

  return (
    <Document title={`${label} - ${supplier.name}`} author={CLINIC.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image
              src={logoSrc}
              style={[
                styles.logo,
                { width: CLINIC.logo.width, height: CLINIC.logo.height },
              ]}
            />
            {address.map((l) => (
              <Text key={l} style={styles.muted}>
                {l}
              </Text>
            ))}
            {CLINIC.phone ? (
              <Text style={styles.muted}>{CLINIC.phone}</Text>
            ) : null}
            {CLINIC.email ? (
              <Text style={styles.muted}>{CLINIC.email}</Text>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>{label}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Period</Text>
              <Text style={styles.bold}>{formatRangeLabel(range)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Issued</Text>
              <Text style={styles.bold}>
                {formatClinicDateTime(generatedAt)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.subject}>
          <Text style={styles.sectionLabel}>Supplier</Text>
          <Text style={styles.supplierName}>{supplier.name}</Text>
          <Text style={styles.muted}>
            {supplierItemsCaption(order, view, measure, range)}
          </Text>
        </View>

        {/* Repeats at the top of every page, so a column of figures on a
            continuation sheet is never unlabelled. */}
        <View style={styles.headRow} fixed>
          <Text style={styles.colRank}>#</Text>
          <Text style={styles.colName}>Product</Text>
          <Text style={styles.colUnits}>Units</Text>
          <Text style={styles.colShare}>Share</Text>
          <Text style={styles.colBilled}>Billed</Text>
        </View>

        {data.categories.length === 0 && (
          <View style={styles.row}>
            <Text style={styles.muted}>
              This supplier has no products filed under it.
            </Text>
          </View>
        )}

        {view === "item" && (
          <>
            {flat.length === 0 && (
              <View style={styles.row}>
                <Text style={styles.muted}>
                  None of this supplier&apos;s products sold over the period.
                </Text>
              </View>
            )}
            <Lines
              lines={flat}
              measure={measure}
              max={wholeMax}
              whole={measureOf(totals, measure)}
            />
            <View style={styles.totalRow} wrap={false}>
              <Text style={styles.colRank} />
              {/* No summary beside the label: the note under the table
                  already says how many did not sell. */}
              <Text style={styles.colName}>
                {`All ${totals.items} products that sold`}
              </Text>
              <Text style={styles.colUnits}>{formatUnits(totals.units)}</Text>
              <View style={styles.colShare}>
                <ShareCell
                  units={wholeMax}
                  max={wholeMax}
                  share={measureOf(totals, measure) > 0 ? 100 : null}
                />
              </View>
              <Text style={styles.colBilled}>
                {formatMoney(totals.revenue)}
              </Text>
            </View>
          </>
        )}

        {view === "category" &&
          sortedCategories(data, measure).map((cat) => {
            const lines = rankedLines(cat, measure, order);
            const note = categoryNote(cat, lines, measure);
            return (
              <View key={cat.category}>
                {/* A band is never left alone at the foot of a page: it moves
                  to the next one with the lines it introduces. */}
                <View style={styles.bandRow} minPresenceAhead={48}>
                  <Text style={styles.colRank} />
                  <Text style={styles.colName}>
                    {cat.category}
                    <Text style={styles.bandSummary}>
                      {`   ${soldSummary(cat.total.items, cat.unsoldItems)}`}
                    </Text>
                  </Text>
                  <Text style={styles.colUnits}>
                    {formatUnits(cat.total.units)}
                  </Text>
                  <View style={styles.colShare}>
                    <ShareCell
                      units={measureOf(cat.total, measure)}
                      max={categoriesMax}
                      share={shareOf(
                        measureOf(cat.total, measure),
                        measureOf(totals, measure),
                      )}
                    />
                  </View>
                  <Text style={styles.colBilled}>
                    {formatMoney(cat.total.revenue)}
                  </Text>
                </View>

                {cat.lines.length === 0 && (
                  <Text style={styles.emptyRow}>
                    Nothing sold in this category over the period.
                  </Text>
                )}

                <Lines
                  lines={lines}
                  measure={measure}
                  max={categoryMax(cat, measure)}
                  whole={measureOf(cat.total, measure)}
                />

                {note && <Text style={styles.categoryNote}>{note}</Text>}
              </View>
            );
          })}

        {view === "category" && data.categories.length > 1 && (
          <View style={styles.totalRow} wrap={false}>
            <Text style={styles.colRank} />
            <Text style={styles.colName}>
              All categories
              <Text style={styles.bandSummary}>
                {`   ${soldSummary(totals.items, totals.unsoldItems)}`}
              </Text>
            </Text>
            <Text style={styles.colUnits}>{formatUnits(totals.units)}</Text>
            <View style={styles.colShare}>
              <ShareCell
                units={categoriesMax}
                max={categoriesMax}
                share={measureOf(totals, measure) > 0 ? 100 : null}
              />
            </View>
            <Text style={styles.colBilled}>{formatMoney(totals.revenue)}</Text>
          </View>
        )}

        <Text style={styles.note}>
          {note ? `${note} ` : ""}
          Units are what customers were invoiced for, net of returns; Billed is
          the value of those invoice lines. Stock used by the clinic itself is
          not counted. A product is this supplier&apos;s when it is filed under
          them as its usual supplier
          {view === "category"
            ? `, and its share is of the ${measure === "units" ? "units" : "revenue"} of the category it sits in; a category's share is of the supplier.`
            : `, and its share is of everything the supplier's products ${measure === "units" ? "sold" : "billed"}.`}
        </Text>

        <Text style={styles.footer}>
          {`${CLINIC.name} · ${label} for ${supplier.name}`}
        </Text>
      </Page>
    </Document>
  );
}
