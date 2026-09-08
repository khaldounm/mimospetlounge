import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { CLINIC } from "@/constants/clinic";
import { formatClinicDateTime, formatDate } from "@/utils/format";
import { formatTemperature, formatWeight, vitalsHistory } from "@/utils/vitals";
import type { MedicalRecordDTO } from "@/types/entities";
import VitalsPdfChart from "./VitalsPdfChart";

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
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: COLORS.accent,
    textAlign: "center",
    marginBottom: 24,
  },
  headerBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 22,
  },
  leftCol: { width: "52%" },
  rightCol: { width: "44%", alignItems: "flex-end" },
  logo: { marginBottom: 8 },
  muted: { color: COLORS.muted },
  bold: { fontFamily: "Helvetica-Bold" },
  metaBlock: { width: 200 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionLabelRight: { textAlign: "right" },
  ownerBlock: { marginTop: 14, alignItems: "flex-end" },
  historyTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    marginBottom: 8,
  },
  entry: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 3,
    marginBottom: 8,
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: COLORS.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  entryDate: { width: "20%", fontFamily: "Helvetica-Bold" },
  entryTitle: { width: "50%", fontFamily: "Helvetica-Bold" },
  // Wide enough that "Consultation / General examination" wraps on the slash
  // rather than being hyphenated mid-word.
  entryType: { width: "30%", textAlign: "right", color: COLORS.muted },
  entryBody: { paddingVertical: 6, paddingHorizontal: 8 },
  detailRow: { flexDirection: "row", marginBottom: 2 },
  detailLabel: { width: "28%", color: COLORS.muted },
  detailValue: { width: "72%" },
  dueNote: { marginTop: 4, fontFamily: "Helvetica-Bold" },
  empty: { color: COLORS.muted, marginTop: 8 },
  disclaimer: {
    marginTop: 20,
    fontSize: 8,
    color: COLORS.muted,
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

// Turns a details JSON key ("batchNumber") into a printable label
// ("Batch Number"), matching how the on-screen timeline renders it.
function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.bold}>{value}</Text>
    </View>
  );
}

export default function MedicalRecordPdfDocument({
  record,
  logoSrc = CLINIC.logo.src,
}: {
  record: MedicalRecordDTO;
  // Server-side rendering must pass an absolute URL; the browser default
  // (a root-relative path) only resolves in the client.
  logoSrc?: string;
}) {
  const { patient, clientName, records } = record;
  // Built once here so the chart and the per-visit rows below cannot
  // disagree about which readings exist.
  const vitals = vitalsHistory(records);

  return (
    <Document
      title={`Medical record - ${patient.name}`}
      author={CLINIC.name}
      subject={`Clinical history for ${patient.name} (${clientName})`}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.pageTitle}>MEDICAL RECORD</Text>

        {/* Clinic identity (left) + patient & owner details (right) */}
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
          </View>

          <View style={styles.rightCol}>
            <View style={styles.metaBlock}>
              <Text style={[styles.sectionLabel, styles.sectionLabelRight]}>
                Patient
              </Text>
              <MetaRow label="Name" value={patient.name} />
              <MetaRow label="Species" value={patient.species || "-"} />
              <MetaRow label="Breed" value={patient.breed || "-"} />
              <MetaRow
                label="Date of birth"
                value={formatDate(patient.dateOfBirth) || "-"}
              />
              <MetaRow label="Sex" value={patient.sex || "-"} />
              <MetaRow
                label="Neutered / spayed"
                value={patient.isNeutered ? "Yes" : "No"}
              />
              <MetaRow label="Microchip" value={patient.microchipId || "-"} />
            </View>

            <View style={[styles.metaBlock, styles.ownerBlock]}>
              <Text style={[styles.sectionLabel, styles.sectionLabelRight]}>
                Owner
              </Text>
              <Text style={styles.bold}>{clientName}</Text>
            </View>
          </View>
        </View>

        <VitalsPdfChart points={vitals} />

        <Text style={styles.historyTitle}>
          Clinical history ({records.length}{" "}
          {records.length === 1 ? "entry" : "entries"})
        </Text>

        {records.length === 0 ? (
          <Text style={styles.empty}>No clinical records on file.</Text>
        ) : (
          records.map((r) => {
            const details = Object.entries(r.details ?? {}).filter(
              ([, v]) =>
                v !== null && v !== undefined && String(v).trim() !== "",
            );
            const temperature = formatTemperature(r.temperature);
            const weight = formatWeight(r.weight);
            return (
              // A visit should not be split across a page break: `wrap={false}`
              // pushes the whole entry to the next page instead.
              <View key={r.recordId} style={styles.entry} wrap={false}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entryDate}>
                    {formatDate(r.performedAt)}
                  </Text>
                  <Text style={styles.entryTitle}>{r.title}</Text>
                  <Text style={styles.entryType}>
                    {r.subcategory
                      ? `${r.recordType} / ${r.subcategory}`
                      : r.recordType}
                  </Text>
                </View>
                <View style={styles.entryBody}>
                  {temperature ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Temperature</Text>
                      <Text style={styles.detailValue}>{temperature}</Text>
                    </View>
                  ) : null}
                  {weight ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Weight</Text>
                      <Text style={styles.detailValue}>{weight}</Text>
                    </View>
                  ) : null}
                  {details.map(([k, v]) => (
                    <View key={k} style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{humanize(k)}</Text>
                      <Text style={styles.detailValue}>{String(v)}</Text>
                    </View>
                  ))}
                  {r.notes ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Notes</Text>
                      <Text style={styles.detailValue}>{r.notes}</Text>
                    </View>
                  ) : null}
                  {r.performerName ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Seen by</Text>
                      <Text style={styles.detailValue}>{r.performerName}</Text>
                    </View>
                  ) : null}
                  {r.nextDueDate ? (
                    <Text style={styles.dueNote}>
                      Next due: {formatDate(r.nextDueDate)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })
        )}

        <Text style={styles.disclaimer}>
          This record is issued to the registered owner and reflects the
          treatments recorded at {CLINIC.name} as at{" "}
          {formatClinicDateTime(record.generatedAt)}.
        </Text>

        <View style={styles.footer} fixed>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `${CLINIC.name} | Medical record - ${patient.name} | Page ${pageNumber} of ${totalPages}`
            }
            fixed
          />
        </View>
      </Page>
    </Document>
  );
}
