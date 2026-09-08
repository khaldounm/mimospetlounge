import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { CLINIC } from "@/constants/clinic";
import { formatClinicDateTime, formatDate, formatMoney } from "@/utils/format";
import { formatRangeLabel } from "@/utils/date-range";
import type {
  ClientStatementDTO,
  ClientStatementLineDTO,
} from "@/types/entities";

// The statement as a document rather than a screenshot of a page: who it is
// for, what period it covers, every document that moved the account, and the
// figure it lands on. The same component backs the in-app download and the file
// WaSenderApi attaches, so staff and client are looking at the same paper.

const COLORS = {
  text: "#1a1a1a",
  muted: "#666666",
  line: "#d0d0d0",
  rule: "#1a1a1a",
  band: "#f4f4f5",
  credit: "#2e7d32",
  warn: "#a33a00",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 52,
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

  billTo: { marginBottom: 12 },
  sectionLabel: {
    fontSize: 7.5,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 3,
  },
  clientName: { fontSize: 13, fontFamily: "Helvetica-Bold" },

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
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.line,
    paddingVertical: 4,
    paddingHorizontal: 5,
  },
  bandRow: {
    flexDirection: "row",
    backgroundColor: COLORS.band,
    paddingVertical: 5,
    paddingHorizontal: 5,
    fontFamily: "Helvetica-Bold",
  },
  itemRow: {
    flexDirection: "row",
    paddingVertical: 1.5,
    paddingHorizontal: 5,
    color: COLORS.muted,
    fontSize: 8,
  },

  colDate: { width: "13%" },
  colType: { width: "11%" },
  colRef: { width: "17%" },
  colDetail: { width: "27%" },
  colCharge: { width: "10%", textAlign: "right" },
  colPayment: { width: "10%", textAlign: "right" },
  colBalance: { width: "12%", textAlign: "right" },

  // Item lines hang off the invoice above them, so they are indented into the
  // description column and never into the money columns, which have to stay
  // readable as a single column down the page.
  itemDesc: { width: "57%", paddingLeft: 14 },
  itemQty: { width: "19%", textAlign: "right" },
  itemTotal: { width: "24%", textAlign: "right" },

  totals: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: "52%" },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsDivider: {
    borderTopWidth: 0.5,
    borderTopColor: COLORS.line,
    marginVertical: 3,
  },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: COLORS.band,
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  note: { marginTop: 14, fontSize: 7.5, color: COLORS.muted },
  warn: { marginTop: 10, fontSize: 8, color: COLORS.warn },
  // Ordinary flow content at the end of the document, not a `position:
  // absolute` element pinned to every page. react-pdf mislays a pinned footer
  // once a document runs past about five pages, and a statement with every
  // invoice opened out runs well past that: the box it hands pdfkit comes back
  // as -1.7e21 and the render dies.
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

const TYPE_LABEL: Record<ClientStatementLineDTO["kind"], string> = {
  opening: "Opening",
  invoice: "Invoice",
  payment: "Payment",
};

const trimQty = (value: string) =>
  value.includes(".") ? value.replace(/\.?0+$/, "") : value;

function detailOf(line: ClientStatementLineDTO): string {
  const parts = [line.description];
  if (line.method) parts.push(line.method);
  if (line.appliedTo) parts.push(`against ${line.appliedTo}`);
  return parts.join(" · ");
}

export default function ClientStatementPdfDocument({
  statement,
  detailed = false,
  logoSrc = CLINIC.logo.src,
}: {
  statement: ClientStatementDTO;
  /** Opens every invoice out into the items that were billed. */
  detailed?: boolean;
  logoSrc?: string;
}) {
  const owed = Number(statement.accountBalance);
  const address = CLINIC.addressLines.filter(Boolean);

  return (
    <Document
      title={`Statement of account - ${statement.clientName}`}
      author={CLINIC.name}
    >
      <Page size="A4" style={styles.page}>
        {/* Letterhead and account, once. Repeating them down every page of a
            long statement cost a third of each continuation sheet and told the
            reader nothing they did not learn on page one. Only the column
            headings below carry over, because money in an unlabelled column
            cannot be read at all. */}
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
            <Text style={styles.title}>Statement of Account</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Period</Text>
              <Text style={styles.bold}>
                {formatRangeLabel(statement.range)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Balance as at</Text>
              <Text style={styles.bold}>{formatDate(statement.asAt)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Currency</Text>
              <Text style={styles.bold}>{statement.currency}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Issued</Text>
              <Text style={styles.bold}>
                {formatClinicDateTime(statement.generatedAt)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.billTo}>
          <Text style={styles.sectionLabel}>Account of</Text>
          <Text style={styles.clientName}>{statement.clientName}</Text>
          {statement.clientPhone ? (
            <Text style={styles.muted}>{statement.clientPhone}</Text>
          ) : null}
          {statement.clientEmail ? (
            <Text style={styles.muted}>{statement.clientEmail}</Text>
          ) : null}
        </View>

        <View style={styles.headRow} fixed>
          <Text style={styles.colDate}>Date</Text>
          <Text style={styles.colType}>Type</Text>
          <Text style={styles.colRef}>Reference</Text>
          <Text style={styles.colDetail}>Details</Text>
          <Text style={styles.colCharge}>Charges</Text>
          <Text style={styles.colPayment}>Payments</Text>
          <Text style={styles.colBalance}>Balance</Text>
        </View>

        <View style={styles.bandRow}>
          <Text style={styles.colDate}>{formatDate(statement.range.from)}</Text>
          <Text style={{ width: "65%" }}>Balance brought forward</Text>
          <Text style={styles.colBalance}>
            {formatMoney(statement.broughtForward)}
          </Text>
        </View>

        {statement.lines.length === 0 ? (
          <View style={styles.row}>
            <Text style={styles.muted}>
              Nothing was billed or paid in this period.
            </Text>
          </View>
        ) : (
          statement.lines.map((line, i) => (
            // Keep an invoice with the items hanging off it: a balance read
            // apart from the documents behind it is worth nothing.
            <View key={`${line.kind}-${line.reference}-${i}`} wrap={false}>
              <View style={styles.row}>
                <Text style={styles.colDate}>{formatDate(line.date)}</Text>
                <Text style={styles.colType}>{TYPE_LABEL[line.kind]}</Text>
                <Text style={styles.colRef}>{line.reference}</Text>
                <Text style={styles.colDetail}>{detailOf(line)}</Text>
                {/* Each row prints on its own side of the ledger and stays
                    blank on the other, so the money columns read as two
                    columns rather than one interleaved with zeros. */}
                <Text style={styles.colCharge}>
                  {line.kind === "payment" ? "" : formatMoney(line.charge)}
                </Text>
                <Text style={[styles.colPayment, { color: COLORS.credit }]}>
                  {line.kind === "payment" ? formatMoney(line.payment) : ""}
                </Text>
                <Text style={[styles.colBalance, styles.bold]}>
                  {formatMoney(line.balance)}
                </Text>
              </View>
              {detailed &&
                line.items.map((item, j) => (
                  <View key={`item-${j}`} style={styles.itemRow}>
                    <Text style={styles.itemDesc}>{item.description}</Text>
                    <Text style={styles.itemQty}>
                      {(item.looseLabel ?? trimQty(item.quantity)) +
                        " x " +
                        formatMoney(item.unitPrice)}
                    </Text>
                    <Text style={styles.itemTotal}>
                      {formatMoney(item.lineTotal)}
                    </Text>
                  </View>
                ))}
            </View>
          ))
        )}

        <View style={styles.totals}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.muted}>Balance brought forward</Text>
              <Text>{formatMoney(statement.broughtForward)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.muted}>Total invoiced</Text>
              <Text>{formatMoney(statement.invoiced)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.muted}>Total paid</Text>
              <Text>{formatMoney(statement.paid)}</Text>
            </View>
            {!statement.ties && (
              <>
                <View style={styles.totalsDivider} />
                <View style={styles.totalsRow}>
                  <Text style={styles.muted}>
                    Adjustment from previous records
                  </Text>
                  <Text>{formatMoney(-Number(statement.unreconciled))}</Text>
                </View>
              </>
            )}
            <View style={styles.totalsDivider} />
            <View style={styles.grandRow}>
              <Text>{owed < 0 ? "Balance in credit" : "Balance due"}</Text>
              <Text>{formatMoney(Math.abs(owed))}</Text>
            </View>
          </View>
        </View>

        {!statement.ties && (
          <Text style={styles.warn}>
            Part of this balance was carried over from our previous records and
            is not covered by the documents listed above. Please contact us if
            you would like it explained.
          </Text>
        )}

        <Text style={styles.note}>
          Balance brought forward plus what was invoiced, less what was paid,
          gives the balance due. Every figure above is derived from the
          documents listed on this statement.
          {statement.openingEntry
            ? ` The opening balance of ${formatMoney(statement.openingEntry.amount)} as at ${formatDate(statement.openingEntry.asOfDate)} is already included in it.`
            : ""}
        </Text>

        <Text style={styles.footer}>
          {`${CLINIC.name} · Statement for ${statement.clientName}`}
        </Text>
      </Page>
    </Document>
  );
}
