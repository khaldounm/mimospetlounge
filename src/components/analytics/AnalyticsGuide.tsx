"use client";

import { useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";

// One term and its plain-English meaning.
function Term({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

// An info button that opens a plain-language guide to every figure on the
// analytics page: what the page is for, what each term means (COGS especially),
// and how the numbers are worked out.
export default function AnalyticsGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip title="What do these numbers mean?">
        <IconButton
          onClick={() => setOpen(true)}
          size="small"
          aria-label="About this page"
        >
          <InfoOutlinedIcon />
        </IconButton>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          Understanding this page
          <IconButton
            onClick={() => setOpen(false)}
            size="small"
            aria-label="Close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={3}>
            <Typography variant="body2">
              A snapshot of your clinic&apos;s money and stock: the figures are
              for the current month, and charts marked &quot;12 months&quot;
              show the trend over the past year. Here is what each number means
              and how it is worked out.
            </Typography>

            <Section title="Profitability">
              <Term label="Revenue this month">
                Money you actually collected from clients this month (payments
                received, not just billed).
              </Term>
              <Term label="Cost of goods sold (COGS)">
                What the items you SOLD this month originally cost you to buy.
                Example: you sell a bag of treats that cost you $5, so $5 is
                COGS. It is the cost of the goods, not their sale price. Items a
                partner earns on are counted here too, because you paid for
                them; only the part of a cost your partner is handed back on the
                sale moves to Partner earnings instead.
              </Term>
              <Term label="Partner earnings">
                Everything your partners earned this month, counted the moment
                they earned it: their cut of the stock they earn on, their cut
                of the services they performed, and any guaranteed day topped
                up. Example: an item cost $100 and sold for $150 with the
                partner on half the profit and no cost, so they earn $25 and you
                keep $125, being your $100 back and $25 of profit. Paying a
                partner does not show up here, because the earning was already
                counted; a payout settles what this figure created.
              </Term>
              <Term label="Operating costs">
                Your running costs logged this month: rent, salaries, utilities,
                and the like.
              </Term>
              <Term label="Net profit this month">
                Revenue minus COGS minus partner earnings minus operating costs.
                The money you truly made this month.
              </Term>
              <Term label="Inventory on hand">
                The value of the stock you are holding right now, valued at what
                it cost you. This is an asset you own, not money lost. Stock a
                partner earns on is counted too, because you paid for it; only
                stock a partner actually fronted is left out.
              </Term>
            </Section>

            <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                Why buying stock is not a loss
              </Typography>
              <Typography variant="body2" color="text.secondary">
                When you buy inventory you swap cash for goods of equal value,
                so your profit does not drop. That cost only counts (as COGS)
                when you sell the item. Your cash going down is a separate thing
                (cash flow) from whether you made a profit.
              </Typography>
            </Box>

            <Section title="Revenue & financial">
              <Term label="Collected vs Invoiced">
                Collected is cash received this month; Invoiced is the value you
                billed this month. They differ when clients have not paid yet.
              </Term>
              <Term label="Outstanding">
                Unpaid balance still owed across issued invoices.
              </Term>
              <Term label="Avg invoice">
                Average total of an invoice (excluding drafts and voided ones).
              </Term>
              <Term label="Void rate">
                Share of invoices that were cancelled (voided).
              </Term>
            </Section>

            <Section title="Category performance">
              <Term label="Month on month / Year on year">
                The same dates one month, or one year, earlier. A part-finished
                month compares against the same days of the previous one, so Aug
                1-25 reads against Jul 1-25 rather than a whole month.
              </Term>
              <Term label="Billed, not collected">
                A payment settles a whole invoice, not a single line, so cash
                cannot be split by category. These figures are what you billed,
                and will not match Collected in Revenue.
              </Term>
              <Term label="Products / Vet services / Grooming services">
                Stock lines take the product category; service lines take the
                service category, with grooming shown as its own trade.
                Discounts and unmatched legacy lines sit under Other.
              </Term>
              <Term label="New / n/a">
                New means the earlier period billed nothing, so there is no
                percentage to show. n/a means it netted negative (a discount
                line), which a percentage cannot describe.
              </Term>
            </Section>

            <Section title="Clients & patients">
              <Term label="Active clients">
                Clients on file who are not archived. A head count of right now,
                not of the dates picked at the top of the section.
              </Term>
              <Term label="New in period">
                Clients added between the dates picked at the top of the
                section.
              </Term>
              <Term label="Lapsed">
                Clients on file with no invoice and no appointment between those
                dates. Change the dates to change what counts as gone quiet: a
                year asks who has stopped coming, a month asks who has not been
                in lately.
              </Term>
              <Term label="Last activity">
                The day a client was last billed or last had an appointment,
                whichever came later. Cancellations and no-shows do not count,
                because neither one put the animal in front of anyone.
              </Term>
              <Term label="Top clients">
                Ranked by what they were billed between those dates. Walk-ins
                are left out: a counter sale belongs to no account.
              </Term>
              <Term label="Lifetime billed">
                Everything a client has ever been charged, up to the end of the
                dates picked. On the lapsed list it is what says whether the
                client walking away is worth a phone call.
              </Term>
              <Term label="Download">
                The icon on either list saves it as a spreadsheet for the dates
                on screen. The table shows the first ten; the file holds every
                row.
              </Term>
              <Term label="Total patients">
                Animals registered across all clients.
              </Term>
            </Section>

            <Section title="Inventory">
              <Term label="Total items">
                How many active products you stock.
              </Term>
              <Term label="Stock value">
                Quantity on hand times its cost, added up across every item you
                paid for. Stock a partner earns on is still your money and is
                counted here; the note underneath says how much of it there is.
              </Term>
              <Term label="Stock on hand">
                Where the shelf&apos;s money would land if every item sold at
                today&apos;s price. Cost value is your own outlay coming back to
                you. Partner profit is your partners&apos; cut of the margin at
                their agreed rates, and Clinic profit is the margin you keep.
                The three add up to Total, the whole shelf at its sale price. An
                item costing $100 and selling at $150 with a partner on half the
                profit reads as $100 cost, $25 to you and $25 to them. None of
                it is earned until the stock actually sells.
              </Term>
              <Term label="Low stock / Out of stock">
                Items at or below their reorder level, and items with zero on
                hand. Low stock needs a reorder level set on the item.
              </Term>
              <Term label="Expiring (30d)">
                Items whose expiry date falls within the next 30 days.
              </Term>
              <Term label="Top 10 items sold">
                The ten products that moved the most units over the dates picked
                at the top of this section, ranked after returns rather than
                before them. It reads the invoices, so a refunded sale takes
                itself back off the board.
              </Term>
              <Term label="Item performance">
                Type a name or scan a barcode to see one product on its own:
                what it sold, what came back, what it billed, and what is left
                on the shelf.
              </Term>
              <Term label="Net billed">
                Billed on sales minus refunded on returns. Billed, not
                collected: a payment settles a whole invoice, so it cannot be
                split per product.
              </Term>
              <Term label="Average price per unit">
                What a unit actually fetched over the period, after returns and
                after any discount typed at the counter. It will not always
                match the current list price.
              </Term>
            </Section>

            <Section title="Bookings & operations">
              <Term label="This month">
                Appointments scheduled in the current month.
              </Term>
              <Term label="Completed / No-show (90d)">
                Share of the last 90 days&apos; bookings that were completed,
                and that were no-shows.
              </Term>
            </Section>

            <Typography variant="caption" color="text.secondary">
              Charts stay empty until there is data to show. Money figures use
              the current calendar month unless a chart says otherwise.
            </Typography>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
