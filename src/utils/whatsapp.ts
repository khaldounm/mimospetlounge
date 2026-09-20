import { CLINIC } from "@/constants/clinic";
import { formatMoney } from "@/utils/format";
import { formatRangeLabel } from "@/utils/date-range";
import type {
  ClientStatementDTO,
  InvoiceDTO,
  MedicalRecordDTO,
  PurchaseOrderDTO,
} from "@/types/entities";

// Composes the WhatsApp message body (caption) for an invoice summary.
export function invoiceWhatsAppMessage(invoice: InvoiceDTO): string {
  const lines = [
    CLINIC.name,
    "",
    `Invoice ${invoice.number}`,
    `Total: ${formatMoney(invoice.total)}`,
    `Paid: ${formatMoney(invoice.amountPaid)}`,
    `Balance due: ${formatMoney(invoice.balance)}`,
  ];
  if (invoice.dueDate) lines.push(`Due date: ${invoice.dueDate}`);
  // What the client owes across their WHOLE account, this invoice included.
  // Worth saying only when it differs from the balance above: repeating the
  // same figure under a second name reads like two separate demands. Absent on
  // a walk-in, which has no account.
  if (invoice.clientBalance != null) {
    const account = Number(invoice.clientBalance);
    if (Math.abs(account - Number(invoice.balance)) >= 0.01) {
      lines.push(
        account < 0
          ? `Account in credit: ${formatMoney(Math.abs(account))}`
          : `Total account balance: ${formatMoney(account)}`,
      );
    }
  }
  lines.push("", "Thank you for your visit.");
  return lines.join("\n");
}

// Composes the WhatsApp message body (caption) sent to a supplier with a
// purchase order PDF. Addressed to the contact by name when there is one, since
// a company's number is often answered by whoever is nearest.
//
// The item count is included but the lines are not: the PDF is the order, and a
// long caption buries the attachment on a phone screen.
export function orderWhatsAppMessage(
  order: PurchaseOrderDTO,
  contactName?: string | null,
): string {
  const reference = order.reference || `PO-${order.orderId}`;
  const lineCount = order.lines?.length ?? order.lineCount;
  const lines = [
    contactName ? `Hello ${contactName},` : "Hello,",
    "",
    `Please find our purchase order ${reference} attached.`,
    `Items: ${lineCount}`,
    `Total: ${formatMoney(order.total)}`,
  ];
  if (order.notes) lines.push("", order.notes);
  lines.push("", "Thank you,", CLINIC.name);
  return lines.join("\n");
}

// Composes the WhatsApp message body (caption) sent to an owner with their
// pet's medical record PDF. The history itself stays in the attachment: a
// caption long enough to list visits pushes the file off a phone screen.
export function medicalRecordWhatsAppMessage(record: MedicalRecordDTO): string {
  const { patient, records } = record;
  const lines = [
    `Hello ${record.clientName},`,
    "",
    `Please find ${patient.name}'s medical record attached.`,
    `Entries: ${records.length}`,
  ];

  // The next recall is the one thing worth repeating outside the PDF, since it
  // is the only part that asks the owner to do something.
  const today = new Date().toISOString().slice(0, 10);
  const nextDue = records
    .map((r) => r.nextDueDate)
    .filter((d): d is string => !!d && d >= today)
    .sort()[0];
  if (nextDue) lines.push(`Next due: ${nextDue}`);

  lines.push("", "Thank you,", CLINIC.name);
  return lines.join("\n");
}

// Filename-safe slug of a pet's name, so the attachment arrives as
// "medical-record-luna.pdf" rather than an id the owner cannot read.
export function medicalRecordFileName(record: MedicalRecordDTO): string {
  const slug = record.patient.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `medical-record-${slug || record.patient.patientId}.pdf`;
}

// Composes the WhatsApp message body (caption) sent to a client with their
// statement PDF. The ledger itself stays in the attachment: a caption long
// enough to list documents pushes the file off a phone screen. What is repeated
// outside it is the one figure the message is about.
export function clientStatementWhatsAppMessage(
  statement: ClientStatementDTO,
): string {
  const owed = Number(statement.accountBalance);
  const lines = [
    `Hello ${statement.clientName},`,
    "",
    "Please find your statement of account attached.",
    `Period: ${formatRangeLabel(statement.range)}`,
  ];
  if (owed > 0) {
    lines.push(`Balance due: ${formatMoney(owed)}`);
  } else if (owed < 0) {
    lines.push(`Your account is in credit: ${formatMoney(Math.abs(owed))}`);
  } else {
    lines.push("Your account is fully settled. Thank you.");
  }
  lines.push("", "Thank you,", CLINIC.name);
  return lines.join("\n");
}

// Filename the client sees on their phone: named for them and dated, so a
// second statement sent later does not overwrite the first in their downloads.
export function clientStatementFileName(statement: ClientStatementDTO): string {
  const slug = statement.clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `statement-${slug || statement.clientId}-${statement.asAt}.pdf`;
}

// The one message sent to a member of staff rather than a client: their
// one-time link to set up a passkey. Plain words, the link on its own line so
// WhatsApp makes it tappable, and the two facts that matter (once, minutes).
export function enrollmentWhatsAppMessage(
  firstName: string,
  url: string,
  ttlMinutes: number,
): string {
  return [
    `Hi ${firstName}, here is your sign-in link for ${CLINIC.name}.`,
    "Open it on this phone and follow the steps.",
    "",
    url,
    "",
    `It works once and expires in ${ttlMinutes} minutes.`,
  ].join("\n");
}
