import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { CLINIC } from "@/constants/clinic";
import { formatDate, formatMoney } from "@/utils/format";
import type { PurchaseOrderDTO } from "@/types/entities";

// Deliberately a separate document from the invoice rather than a shared
// template. An invoice is the clinic asking to be paid; this is the clinic
// asking to be supplied, so it has no balance, no payments and no thank-you,
// and the identity block is the buyer rather than the seller.

const COLORS = {
  text: "#1a1a1a",
  muted: "#666666",
  line: "#d0d0d0",
  headerBg: "#f4f4f5",
  accent: "#1976d2",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 9,
    color: COLORS.text,
    fontFamily: "Helvetica",
    lineHeight: 1.4,
  },
  pageTitle: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    textAlign: "center",
    marginBottom: 28,
  },
  headerBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  leftCol: { width: "52%" },
  rightCol: { width: "44%", alignItems: "flex-end" },
  logo: { marginBottom: 8 },
  muted: { color: COLORS.muted },
  metaBlock: { width: 184 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  metaLabel: { color: COLORS.muted },
  metaValue: { fontFamily: "Helvetica-Bold" },
  supplierBlock: { marginTop: 16, alignItems: "flex-end" },
  sectionLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
    textAlign: "right",
  },
  bold: { fontFamily: "Helvetica-Bold" },
  table: { marginBottom: 16 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontFamily: "Helvetica-Bold",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  colDesc: { width: "52%" },
  // With a supplier-code column the description gives up the room for it.
  // The column only appears when some line carries a code, so an order for a
  // catalogue without codes prints exactly as it always has.
  colDescWithCode: { width: "38%" },
  colCode: { width: "14%" },
  colQty: { width: "12%", textAlign: "right" },
  colUnit: { width: "18%", textAlign: "right" },
  colTotal: { width: "18%", textAlign: "right" },
  lineNote: { color: COLORS.muted, fontSize: 8 },
  totals: { flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: "45%" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    marginVertical: 4,
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: COLORS.headerBg,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  notes: { marginTop: 22 },
  deliverTo: { marginTop: 22 },
  deliverLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    paddingTop: 8,
    fontSize: 8,
    color: COLORS.muted,
  },
  pageNumber: { textAlign: "right", marginTop: 2 },
});

export default function OrderPdfDocument({
  order,
  logoSrc = CLINIC.logo.src,
}: {
  order: PurchaseOrderDTO;
  // Server-side rendering must pass an absolute URL; the browser default
  // (a root-relative path) only resolves in the client.
  logoSrc?: string;
}) {
  const reference = order.reference || `PO-${order.orderId}`;
  const lines = order.lines ?? [];
  // The supplier's own product codes, where the catalogue has them. This is
  // the column the rep actually reads.
  const showCodes = lines.some((l) => l.supplierCode);
  const colDesc = showCodes ? styles.colDescWithCode : styles.colDesc;
  const discount = Number(order.discountAmount ?? 0);
  const shipping = Number(order.shippingAmount ?? 0);
  const tax = Number(order.taxAmount ?? 0);

  return (
    <Document
      title={`Purchase order ${reference}`}
      author={CLINIC.name}
      subject={`Purchase order ${reference} for ${order.supplierName ?? "supplier"}`}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.pageTitle}>PURCHASE ORDER</Text>

        {/* Buyer identity (left) + order & supplier meta (right) */}
        <View style={styles.headerBody}>
          <View style={styles.leftCol}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image
              src={logoSrc}
              style={[
                styles.logo,
                { width: CLINIC.logo.width, height: CLINIC.logo.height },
              ]}
            />
            {CLINIC.addressLines.filter(Boolean).map((line) => (
              <Text key={line} style={styles.muted}>
                {line}
              </Text>
            ))}
            {CLINIC.phone ? (
              <Text style={styles.muted}>{CLINIC.phone}</Text>
            ) : null}
            {CLINIC.email ? (
              <Text style={styles.muted}>{CLINIC.email}</Text>
            ) : null}
            {CLINIC.taxId ? (
              <Text style={[styles.muted, { marginTop: 4 }]}>
                {CLINIC.taxId}
              </Text>
            ) : null}
          </View>

          <View style={styles.rightCol}>
            <View style={styles.metaBlock}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Order no.</Text>
                <Text style={styles.metaValue}>{reference}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Status</Text>
                <Text style={styles.metaValue}>{order.status}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Order date</Text>
                <Text style={styles.metaValue}>
                  {order.orderedOn
                    ? formatDate(order.orderedOn)
                    : formatDate(order.createdAt.slice(0, 10))}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Items</Text>
                <Text style={styles.metaValue}>{lines.length}</Text>
              </View>
            </View>

            <View style={styles.supplierBlock}>
              <Text style={styles.sectionLabel}>Supplier</Text>
              <Text style={styles.bold}>
                {order.supplierName ?? "No supplier"}
              </Text>
            </View>
          </View>
        </View>

        {/* Line items. Quantity is the stocking unit; a line keyed in loose
            units shows that underneath so the supplier reads what was meant. */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={colDesc}>Item</Text>
            {showCodes ? <Text style={styles.colCode}>Your code</Text> : null}
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colUnit}>Unit cost</Text>
            <Text style={styles.colTotal}>Amount</Text>
          </View>
          {lines.map((l) => (
            <View key={l.lineId} style={styles.tableRow} wrap={false}>
              <View style={colDesc}>
                <Text>{l.itemName}</Text>
                {l.looseQty && l.looseUnit ? (
                  <Text style={styles.lineNote}>
                    {`${l.looseQty} ${l.looseUnit}`}
                  </Text>
                ) : null}
                {l.notes ? (
                  <Text style={styles.lineNote}>{l.notes}</Text>
                ) : null}
              </View>
              {showCodes ? (
                <Text style={styles.colCode}>{l.supplierCode ?? ""}</Text>
              ) : null}
              <Text style={styles.colQty}>
                {l.unit ? `${l.quantityOrdered} ${l.unit}` : l.quantityOrdered}
              </Text>
              <Text style={styles.colUnit}>
                {l.unitCost ? formatMoney(l.unitCost) : "-"}
              </Text>
              <Text style={styles.colTotal}>{formatMoney(l.lineTotal)}</Text>
            </View>
          ))}
        </View>

        {/* Totals. Discount, shipping and tax only appear when they carry a
            value, so a plain order is not padded with rows of zeros. */}
        <View style={styles.totals}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.muted}>Subtotal</Text>
              <Text>{formatMoney(order.subtotal)}</Text>
            </View>
            {discount !== 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.muted}>Discount</Text>
                <Text>-{formatMoney(discount)}</Text>
              </View>
            ) : null}
            {shipping !== 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.muted}>Shipping</Text>
                <Text>{formatMoney(shipping)}</Text>
              </View>
            ) : null}
            {tax !== 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.muted}>
                  {order.taxRate ? `Tax (${order.taxRate}%)` : "Tax"}
                </Text>
                <Text>{formatMoney(tax)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsDivider} />
            <View style={styles.grandTotalRow}>
              <Text>Total</Text>
              <Text>{formatMoney(order.total)}</Text>
            </View>
          </View>
        </View>

        {order.notes ? (
          <View style={styles.notes}>
            <Text style={styles.deliverLabel}>Notes</Text>
            <Text>{order.notes}</Text>
          </View>
        ) : null}

        <View style={styles.deliverTo}>
          <Text style={styles.deliverLabel}>Deliver to</Text>
          {CLINIC.addressLines.filter(Boolean).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          {CLINIC.phone ? <Text>{CLINIC.phone}</Text> : null}
        </View>

        <View style={styles.footer} fixed>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `${CLINIC.name} | Purchase order ${reference} | Page ${pageNumber} of ${totalPages}`
            }
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}
