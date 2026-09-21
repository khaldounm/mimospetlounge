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
  type SupplierItemOrder,
} from "@/constants/analytics";
import { formatClinicDateTime, formatMoney, formatShare } from "@/utils/format";
import { formatRangeLabel } from "@/utils/date-range";
import {
  supplierItemsCaption,
  supplierItemsNote,
  unitShare,
} from "@/utils/supplier-items";
import type {
  AnalyticsRange,
  SupplierItemLines,
  SupplierOption,
} from "@/types/entities";

// One supplier's best or slowest sellers as a page to hand over: the clinic's
// letterhead, the supplier, the dates, the fifteen lines with their share of
// the supplier's units, and what they add up to. Rendered in the browser
// from the figures the dialog already holds, so a download costs the server
// nothing and shows exactly what was on screen. Fifteen rows and a total fit
// one page, which keeps it clear of react-pdf's multi-page footer trap.

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
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.band,
    paddingVertical: 5,
    paddingHorizontal: 5,
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
  },

  colRank: { width: "6%", color: COLORS.muted },
  colName: { width: "50%", paddingRight: 6 },
  colUnits: { width: "10%", textAlign: "right" },
  colShare: { width: "20%", paddingLeft: 10, paddingRight: 4 },
  colBilled: { width: "14%", textAlign: "right" },

  // The share as a bar with its figure beside it, the same picture the dialog
  // draws: filled against the supplier's best seller, labelled with the share
  // of the whole.
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

export default function SupplierItemsPdfDocument({
  supplier,
  order,
  range,
  data,
  generatedAt,
  logoSrc = CLINIC.logo.src,
}: {
  supplier: SupplierOption;
  order: SupplierItemOrder;
  range: AnalyticsRange;
  data: SupplierItemLines;
  // When the file was made, as an ISO string, so the same report pulled twice
  // a month apart can be told apart.
  generatedAt: string;
  logoSrc?: string;
}) {
  const label = SUPPLIER_ITEM_ORDER_LABELS[order];
  const address = CLINIC.addressLines.filter(Boolean);
  const note = supplierItemsNote(data);

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
          <Text style={styles.muted}>{supplierItemsCaption(order, range)}</Text>
        </View>

        <View style={styles.headRow}>
          <Text style={styles.colRank}>#</Text>
          <Text style={styles.colName}>Product</Text>
          <Text style={styles.colUnits}>Units</Text>
          <Text style={styles.colShare}>Share</Text>
          <Text style={styles.colBilled}>Billed</Text>
        </View>

        {data.lines.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.muted}>
              None of this supplier&apos;s products sold over the period.
            </Text>
          </View>
        ) : (
          data.lines.map((line, i) => (
            <View key={line.itemId} style={styles.row}>
              <Text style={styles.colRank}>{i + 1}</Text>
              <Text style={styles.colName}>{line.name}</Text>
              <Text style={styles.colUnits}>{line.units}</Text>
              <View style={styles.colShare}>
                <ShareCell
                  units={line.units}
                  max={data.total.maxUnits}
                  share={unitShare(data, line.units)}
                />
              </View>
              <Text style={styles.colBilled}>{formatMoney(line.revenue)}</Text>
            </View>
          ))
        )}

        <View style={styles.totalRow}>
          <Text style={styles.colRank} />
          <Text style={styles.colName}>
            All {data.total.items} products that sold
          </Text>
          <Text style={styles.colUnits}>{data.total.units}</Text>
          <View style={styles.colShare}>
            <ShareCell
              units={data.total.maxUnits}
              max={data.total.maxUnits}
              share={data.total.units > 0 ? 100 : null}
            />
          </View>
          <Text style={styles.colBilled}>
            {formatMoney(data.total.revenue)}
          </Text>
        </View>

        <Text style={styles.note}>
          {note ? `${note} ` : ""}
          Units are what customers were invoiced for, net of returns; Billed is
          the value of those invoice lines. Stock used by the clinic itself is
          not counted. A product is this supplier&apos;s when it is filed under
          them as its usual supplier.
        </Text>

        <Text style={styles.footer}>
          {`${CLINIC.name} · ${label} for ${supplier.name}`}
        </Text>
      </Page>
    </Document>
  );
}
