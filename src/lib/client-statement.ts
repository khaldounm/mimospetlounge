import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CLINIC, CURRENCY } from "@/constants/clinic";
import { formatInvoiceNumber } from "@/lib/invoices";
import {
  formatLocalDate,
  parseLocalDate,
  rangeBounds,
} from "@/utils/date-range";
import { toDateOnly, todayForDateInput } from "@/utils/format";
import type {
  AnalyticsRange,
  ClientStatementDTO,
  ClientStatementLineDTO,
} from "@/types/entities";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

// A client statement in the accounts-receivable sense: what the account was
// carrying when the period opened, every document that moved it, and what it
// closed on. The identity
//
//   brought forward + invoiced - paid = closing
//
// holds by construction, because both sides come off the same two running sums
// split at the period boundary. That is what lets a client check the figure
// against their own receipts instead of taking it on trust.
//
// The stored `accountBalance` is the authority on what is owed: it is what the
// counter collects, what the clients list shows, and what the payment dialog
// validates against. This report derives the same number from the documents and
// says so when the two disagree, which the old system's carried-forward figures
// make possible on a handful of accounts. It never silences the difference by
// deriving the closing figure from the stored one.

// An invoice is a charge from the moment it is issued, which is exactly when
// issueInvoice raises the account. Drafts have not been billed and Void ones
// were taken back, so neither ever reached the balance.
const CHARGED_STATUSES = ["Issued", "Partial", "Paid", "Overdue"] as const;

const invoiceSelect = {
  invoiceId: true,
  status: true,
  total: true,
  issuedAt: true,
  lineItems: {
    // Hidden lines are consumed during the visit, not sold: the customer is
    // neither shown them nor charged for them, so they stay off a document the
    // customer reads. They are already out of the invoice total.
    where: { isHidden: false },
    select: {
      description: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      looseQty: true,
      looseUnit: true,
    },
    orderBy: { lineItemId: "asc" },
  },
} as const;

const paymentSelect = {
  paymentId: true,
  invoiceId: true,
  amount: true,
  paidAt: true,
  method: true,
  reference: true,
} as const;

/**
 * One client's statement over `range`, or over their whole history when no
 * range is given.
 *
 * Returns null when the client does not exist, so the page can 404 rather than
 * render an empty statement against an id that was never valid.
 */
export async function getClientStatement(
  clientId: number,
  range: AnalyticsRange | null,
): Promise<ClientStatementDTO | null> {
  const client = await prisma.client.findFirst({
    where: { clientId, deletedAt: null },
    select: {
      clientId: true,
      firstName: true,
      lastName: true,
      phone: true,
      phone2: true,
      email: true,
      accountBalance: true,
      // At most one: the import writes a single row per client, dated the day
      // the new system took over.
      openingBalances: {
        orderBy: { asOfDate: "asc" },
        take: 1,
        select: { amount: true, asOfDate: true },
      },
    },
  });
  if (!client) return null;

  const opening = client.openingBalances[0] ?? null;
  const openingDate = opening ? (toDateOnly(opening.asOfDate) ?? null) : null;

  // Everything up to the end of the period. Documents before it are not
  // filtered out: they are what the brought-forward figure is made of, and
  // deriving that from a second query is how the two halves drift apart.
  const upperBound = range ? rangeBounds(range).toExclusive : undefined;

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        clientId,
        status: { in: [...CHARGED_STATUSES] },
        issuedAt: upperBound ? { not: null, lt: upperBound } : { not: null },
      },
      select: invoiceSelect,
      orderBy: { issuedAt: "asc" },
    }),
    prisma.payment.findMany({
      where: {
        clientId,
        ...(upperBound ? { paidAt: { lt: upperBound } } : {}),
      },
      select: paymentSelect,
      orderBy: { paidAt: "asc" },
    }),
  ]);

  // With no range asked for, the statement covers the whole account: from the
  // day it first moved (or the day it was opened with a balance) to today. It
  // is resolved to concrete dates rather than left open-ended so the period in
  // the URL, on screen and on the PDF are the same three dates.
  const resolved = range ?? {
    from: earliestActivity(invoices, payments, openingDate),
    to: todayForDateInput(),
  };
  const { from } = rangeBounds(resolved);

  let broughtForward = D(0);
  let invoiced = D(0);
  let paid = D(0);
  const dated: {
    at: Date;
    rank: number;
    line: Omit<ClientStatementLineDTO, "balance">;
  }[] = [];

  // Brought forward, invoice, payment. A charge has to exist before it can be
  // settled, so on a day carrying both the invoice is listed first; a statement
  // that shows the payment above it looks wrong to anyone reading down the
  // balance column.
  const push = (
    at: Date,
    rank: number,
    line: Omit<ClientStatementLineDTO, "balance">,
  ) => dated.push({ at, rank, line });

  // The balance the account was opened with. Treated as an ordinary dated
  // charge so it falls into the brought-forward figure or onto a line by the
  // same rule as everything else. It is ALREADY inside accountBalance, which is
  // why it is never added to it: doing so bills the client twice.
  if (opening && openingDate) {
    if (openingDate < resolved.from) {
      broughtForward = broughtForward.plus(opening.amount);
    } else if (openingDate <= resolved.to) {
      invoiced = invoiced.plus(opening.amount);
      push(parseLocalDate(openingDate), 0, {
        kind: "opening",
        date: openingDate,
        reference: "Opening balance",
        description: "Balance carried over when the account was opened",
        charge: opening.amount.toFixed(2),
        payment: "0.00",
        href: null,
        method: null,
        appliedTo: null,
        items: [],
      });
    }
  }

  for (const invoice of invoices) {
    const issuedAt = invoice.issuedAt!;
    if (issuedAt < from) {
      broughtForward = broughtForward.plus(invoice.total);
      continue;
    }
    invoiced = invoiced.plus(invoice.total);
    push(issuedAt, 1, {
      kind: "invoice",
      date: toDateOnly(issuedAt) ?? "",
      reference: formatInvoiceNumber(invoice.invoiceId),
      description: describeInvoice(invoice.lineItems.length, invoice.total),
      charge: invoice.total.toFixed(2),
      payment: "0.00",
      href: `/invoices/${invoice.invoiceId}`,
      method: null,
      appliedTo: null,
      items: invoice.lineItems.map((l) => ({
        description: l.description,
        quantity: l.quantity.toFixed(3),
        unitPrice: l.unitPrice.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        looseLabel:
          l.looseQty != null && l.looseUnit
            ? `${l.looseQty.toFixed(3).replace(/\.?0+$/, "")} ${l.looseUnit}`
            : null,
      })),
    });
  }

  for (const payment of payments) {
    if (payment.paidAt < from) {
      broughtForward = broughtForward.minus(payment.amount);
      continue;
    }
    paid = paid.plus(payment.amount);
    push(payment.paidAt, 2, {
      kind: "payment",
      date: toDateOnly(payment.paidAt) ?? "",
      reference: payment.reference || `Payment #${payment.paymentId}`,
      description: describePayment(payment.amount, payment.invoiceId != null),
      charge: "0.00",
      payment: payment.amount.toFixed(2),
      href: payment.invoiceId ? `/invoices/${payment.invoiceId}` : null,
      method: payment.method,
      appliedTo: payment.invoiceId
        ? formatInvoiceNumber(payment.invoiceId)
        : null,
      items: [],
    });
  }

  dated.sort((a, b) => {
    const byDate = a.at.getTime() - b.at.getTime();
    return byDate !== 0 ? byDate : a.rank - b.rank;
  });

  // Run the balance forward so every row shows what the account stood at
  // immediately after it, which is the column a client actually reads.
  let running = broughtForward;
  const lines: ClientStatementLineDTO[] = dated.map(({ line }) => {
    running = running.plus(line.charge).minus(line.payment);
    return { ...line, balance: running.toFixed(2) };
  });

  const closing = broughtForward.plus(invoiced).minus(paid);

  // The derived closing figure can only be compared against the stored balance
  // when the period runs to today: end it earlier and the two are supposed to
  // differ by everything that happened since.
  const isCurrent = resolved.to >= todayForDateInput();
  const difference = isCurrent ? closing.minus(client.accountBalance) : D(0);

  return {
    clinicName: CLINIC.name,
    currency: CURRENCY.code,
    clientId: client.clientId,
    clientName: `${client.firstName} ${client.lastName}`.trim(),
    // Falls back to the second number: for many imported clients that is the
    // one that actually reaches them.
    clientPhone: client.phone ?? client.phone2 ?? null,
    clientEmail: client.email,
    range: resolved,
    asAt: resolved.to,
    generatedAt: new Date().toISOString(),
    broughtForward: broughtForward.toFixed(2),
    invoiced: invoiced.toFixed(2),
    paid: paid.toFixed(2),
    closingBalance: closing.toFixed(2),
    accountBalance: client.accountBalance.toFixed(2),
    ties: difference.isZero(),
    unreconciled: difference.toFixed(2),
    openingEntry:
      opening && openingDate
        ? { amount: opening.amount.toFixed(2), asOfDate: openingDate }
        : null,
    lines,
  };
}

// A refund is a payment row with its sign reversed: money handed back rather
// than taken in. The old system recorded a few dozen, and the import carries
// them across as negative payments, so the running balance goes UP on that row.
// Printing "Payment received" above a negative figure is exactly the kind of
// small wrongness that produces the phone call this document exists to prevent.
function describePayment(amount: Prisma.Decimal, applied: boolean): string {
  if (amount.isNegative()) return "Refund";
  return applied ? "Payment received" : "Payment on account";
}

// A one-line description for an invoice row in the summary view, where the
// items themselves are not listed.
//
// Deliberately says nothing an invoice's `notes` might: those are written for
// staff, and this document is read by the client over WhatsApp.
function describeInvoice(itemCount: number, total: Prisma.Decimal): string {
  // Two different negatives, and the client can tell them apart even if the
  // ledger cannot: a return means goods came back, and its lines say which; a
  // credit note is money taken off the account with nothing itemised behind it,
  // so it has no lines at all. Nothing else in this database is negative with
  // nothing to show, which is what makes the test safe rather than a guess.
  if (total.isNegative()) return itemCount === 0 ? "Credit note" : "Return";
  // The old system booked a payment against a document of its own, which comes
  // across as an invoice carrying nothing. The payment beneath it references it
  // by number, so the row has to stay; it just has no charge to explain.
  //
  // A charge with nothing itemised is the credit note's mirror image: an
  // adjustment to the account rather than a sale. It cannot be a sale, because
  // a hidden line is left out of the invoice total, so an invoice that charges
  // something always has at least one line the client can see.
  if (itemCount === 0)
    return total.isZero() ? "No charge" : "Account settlement";
  return itemCount === 1 ? "1 item" : `${itemCount} items`;
}

// The day this account first moved, for the all-time period. Falls back to
// today so a client with no history at all still gets a valid one-day range
// rather than a statement running from the epoch.
function earliestActivity(
  invoices: { issuedAt: Date | null }[],
  payments: { paidAt: Date }[],
  openingDate: string | null,
): string {
  const candidates: string[] = [];
  if (openingDate) candidates.push(openingDate);
  const firstInvoice = invoices[0]?.issuedAt;
  if (firstInvoice) candidates.push(formatLocalDate(firstInvoice));
  const firstPayment = payments[0]?.paidAt;
  if (firstPayment) candidates.push(formatLocalDate(firstPayment));
  if (candidates.length === 0) return todayForDateInput();
  return candidates.sort()[0]!;
}
