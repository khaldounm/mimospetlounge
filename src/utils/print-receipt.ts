import { CLINIC, SECONDARY_CURRENCY } from "@/constants/clinic";
import { RECEIPT_WIDTH_MM } from "@/constants/invoice";
import { formatMoney, formatSecondaryMoney } from "@/utils/format";
import { printHtmlDocument } from "@/utils/print-document";
import type { InvoiceDTO } from "@/types/entities";

// Escapes a value for safe interpolation into the receipt HTML.
function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(value: string | number): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// The roll stylesheet and page shell, shared by every kind of receipt so a
// second slip cannot drift away from the first. The body is whatever goes
// inside the receipt div.
const RECEIPT_STYLE = `
  /* Industry-standard receipt: the page IS the receipt, an 80mm roll cut to the
     length of the content, so Save-as-PDF yields a clean narrow slip rather
     than a strip stranded on an A4 sheet. The height cannot be written here
     because it is not known until the receipt has rendered: printHtmlDocument
     measures it and appends the real @page rule. */
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${RECEIPT_WIDTH_MM}mm;
    /* A thermal head is 203 DPI and one bit deep: it cannot lay down a thin
       stroke, only decide whether each dot burns. Courier's hairlines fell
       below that threshold and came out grey and broken. A sturdy sans at a
       larger size gives the head solid runs to burn, which is the whole of why
       the old till slips read cleanly and ours did not. */
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt {
    padding: 4mm 3mm 6mm;
    font-size: 13px;
    line-height: 1.35;
  }
  .center { text-align: center; }
  .name { font-size: 20px; font-weight: 700; }
  .addr { font-size: 12px; }
  .muted { color: #000; }
  /* Solid, not dashed. A dashed rule is a row of isolated dots at this
     resolution and half of them fail to register. */
  .sep { border-top: 1px solid #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.6mm 0; vertical-align: top; font-weight: normal; }
  thead th { text-align: left; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 1mm; }
  .qty { width: 12%; }
  .desc { width: 46%; word-break: break-word; }
  .num { width: 21%; text-align: right; }
  th.num { text-align: right; }
  .meta { font-weight: 700; }
  .totline { display: flex; justify-content: space-between; }
  .totline.strong { font-weight: 700; font-size: 15px; margin-top: 1mm; }
  .foot { margin-top: 4mm; text-align: center; font-weight: 700; }
  .heart { color: #000; }
`;

function receiptDocument(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>${RECEIPT_STYLE}</style>
</head>
<body>
  <div class="receipt">
${body}
  </div>
</body>
</html>`;
}

// The clinic name, address and contact lines every receipt opens with.
function receiptHeader(): string {
  const addr = CLINIC.addressLines
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join("");
  return `  <div class="center">
    <div class="name">${esc(CLINIC.name)}</div>
    <div class="addr">
      ${addr}
      ${CLINIC.phone ? `<div>${esc(CLINIC.phone)}</div>` : ""}
      ${CLINIC.website ? `<div>${esc(CLINIC.website)}</div>` : ""}
    </div>
  </div>`;
}

function totalsRow(label: string, value: string, strong = false): string {
  return `
    <div class="totline${strong ? " strong" : ""}">
      <span>${esc(label)}</span><span>${esc(value)}</span>
    </div>`;
}

function stampNow(): string {
  // Short month rather than a numeric one: the counter hands this to the
  // customer, and 09/08 reads as 9 August here and 8 September elsewhere.
  return new Date().toLocaleString(CLINIC.locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Builds a minimal receipt centered on an A4 page. Prints cleanly on any
// printer and saves as a shareable PDF, with no corner-clustering.
function receiptHtml(invoice: InvoiceDTO): string {
  const stamp = stampNow();
  const discountValue = Number(invoice.discountValue);
  const hasDiscount = discountValue !== 0;
  // A flat discount described as a percentage reads as a rounding error, and
  // the reverse hides the figure that was actually agreed at the counter.
  const discountLabel =
    Number(invoice.discountAmount) > 0
      ? "Discount"
      : `Discount (${invoice.discountPct}%)`;
  const hasTax = Number(invoice.taxPct) > 0;
  const adjustment = Number(invoice.adjustment);
  // Lines the clinic consumed rather than sold never reach the customer's copy.
  const lineItems = invoice.lineItems.filter((l) => !l.isHidden);
  const accountBalance =
    invoice.clientBalance != null ? Number(invoice.clientBalance) : null;

  const rows = lineItems
    .map(
      (l) => `
      <tr>
        <td class="qty">${esc(Number(l.quantity))}</td>
        <td class="desc">${esc(l.description)}</td>
        <td class="num">${num(l.unitPrice)}</td>
        <td class="num">${num(l.lineTotal)}</td>
      </tr>`,
    )
    .join("");

  return receiptDocument(
    `Receipt ${invoice.number}`,
    `${receiptHeader()}

  <div class="sep"></div>
  <div>${esc(stamp)}</div>
  <div class="meta">INVOICE# ${esc(invoice.number)}</div>
  <div>Bill to: ${esc(invoice.clientName)}</div>

  <div class="sep"></div>
  <table>
    <thead>
      <tr>
        <th class="qty">Qty</th>
        <th class="desc">Description</th>
        <th class="num">Price</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="sep"></div>
  ${totalsRow("Subtotal", formatMoney(invoice.subtotal))}
  ${hasDiscount ? totalsRow(discountLabel, `-${formatMoney(discountValue)}`) : ""}
  ${hasTax ? totalsRow(`Tax (${invoice.taxPct}%)`, formatMoney(invoice.taxAmount)) : ""}
  ${
    /* The rounding the counter agreed to, shown rather than folded into the
       total: a customer told "call it 100" should see the 1.12 come off. */
    adjustment !== 0
      ? totalsRow(
          "Adjustment",
          `${adjustment > 0 ? "+" : "-"}${formatMoney(Math.abs(adjustment))}`,
        )
      : ""
  }
  ${totalsRow("TOTAL", formatMoney(invoice.total), true)}
  ${
    /* Lira at the rate frozen when the invoice was issued, so a reprint shows
       what the customer actually handed over. Drafts have no rate yet. */
    invoice.fxRate
      ? totalsRow(
          `TOTAL ${SECONDARY_CURRENCY.code}`,
          formatSecondaryMoney(invoice.total, Number(invoice.fxRate)),
          true,
        )
      : ""
  }
  ${totalsRow("Paid", formatMoney(invoice.amountPaid))}
  ${totalsRow("Balance due", formatMoney(invoice.balance), true)}
  ${
    /* What the client owes across their WHOLE account, this invoice included.
       A different number from the balance above whenever anything else is
       outstanding, which is the reason for printing it: the customer standing
       at the counter can settle the lot. Absent on a walk-in. */
    accountBalance != null
      ? `<div class="sep"></div>` +
        totalsRow(
          accountBalance < 0 ? "Account in credit" : "Account balance",
          formatMoney(Math.abs(accountBalance)),
          true,
        )
      : ""
  }

  <div class="sep"></div>
  <div>Items# ${lineItems.length}</div>

  <div class="foot">
    <div><span class="heart">&#9829;</span> Thank you for your visit</div>
  </div>
`,
  );
}

// Renders the invoice as a thermal receipt and sends it to the printer. On a
// counter browser launched with kiosk printing it goes straight to the roll.
export function printInvoiceReceipt(invoice: InvoiceDTO): void {
  printHtmlDocument(receiptHtml(invoice), { rollWidthMm: RECEIPT_WIDTH_MM });
}

// What the counter hands a customer who came in only to pay off their account.
// There is no invoice behind it, so the slip has to carry the proof on its own:
// what was paid, and what the account stands at now. Zero here is the whole
// reason this exists, so it is stated rather than left to be inferred.
export interface AccountReceipt {
  clientName: string;
  // USD, the ledger figure that actually moved the account.
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  method: string | null;
  reference: string | null;
  // What physically crossed the counter, per currency, so a customer who paid
  // in lira sees the lira figure rather than its dollar conversion.
  tenders: { currency: string; amountOriginal: string }[];
  // LBP per 1 USD at the moment of payment. Null when nothing lira was handed
  // over and the rate would only be noise.
  fxRate: number | null;
}

function accountReceiptHtml(receipt: AccountReceipt): string {
  const settled = Number(receipt.balanceAfter) <= 0;
  const lira = receipt.tenders.filter((t) => t.currency !== "USD");
  const dollars = receipt.tenders.filter((t) => t.currency === "USD");

  return receiptDocument(
    `Account payment ${receipt.clientName}`,
    `${receiptHeader()}

  <div class="sep"></div>
  <div>${esc(stampNow())}</div>
  <div class="meta">ACCOUNT PAYMENT</div>
  <div>Received from: ${esc(receipt.clientName)}</div>

  <div class="sep"></div>
  ${totalsRow("Balance before", formatMoney(receipt.balanceBefore))}
  ${dollars
    .map((t) => totalsRow("Paid (USD)", formatMoney(t.amountOriginal)))
    .join("")}
  ${lira
    .map((t) =>
      totalsRow(
        `Paid (${SECONDARY_CURRENCY.code})`,
        `${SECONDARY_CURRENCY.symbol} ${Number(t.amountOriginal).toLocaleString("en-US")}`,
      ),
    )
    .join("")}
  ${totalsRow("Paid", formatMoney(receipt.amount), true)}
  ${
    receipt.fxRate
      ? `<div class="totline"><span>Rate used</span><span>${esc(
          receipt.fxRate.toLocaleString("en-US"),
        )} / $1</span></div>`
      : ""
  }
  ${receipt.method ? totalsRow("Method", receipt.method) : ""}
  ${receipt.reference ? totalsRow("Reference", receipt.reference) : ""}

  <div class="sep"></div>
  ${totalsRow(
    // A cleared account is the thing the customer came for, so it is said in
    // words. Anything left is stated as what is still owed.
    settled ? "ACCOUNT SETTLED" : "Balance remaining",
    formatMoney(Math.abs(Number(receipt.balanceAfter))),
    true,
  )}
  ${
    receipt.fxRate && !settled
      ? totalsRow(
          `Remaining ${SECONDARY_CURRENCY.code}`,
          formatSecondaryMoney(receipt.balanceAfter, receipt.fxRate),
        )
      : ""
  }

  <div class="foot">
    <div><span class="heart">&#9829;</span> Thank you</div>
  </div>
`,
  );
}

// Renders the account payment as a thermal receipt and sends it to the printer,
// the same roll path the invoice receipt uses.
export function printAccountReceipt(receipt: AccountReceipt): void {
  printHtmlDocument(accountReceiptHtml(receipt), {
    rollWidthMm: RECEIPT_WIDTH_MM,
  });
}
