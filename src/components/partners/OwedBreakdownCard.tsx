"use client";

import { Divider, Paper, Stack, Typography } from "@mui/material";
import { formatMoney } from "@/utils/format";

interface Props {
  balance: string | undefined;
  capitalOwed: string | undefined;
  profitOwed: string | undefined;
  /** Shown under the profit line to give it context. */
  profitShareToDate?: string;
  /** Everything earned and everything paid, up to the same date. Shown as a
   *  pair: both climb together, so neither can be misread as an amount owed. */
  earnedToDate?: string;
  paidToDate?: string;
  /** The date this position is stated as at, from `rangeEndLabel`. */
  asOf: string;
}

function Row({
  label,
  value,
  hint,
  negative,
}: {
  label: string;
  value: string | undefined;
  hint?: string;
  negative?: boolean;
}) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
      <Stack>
        <Typography variant="body2">{label}</Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Stack>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, color: negative ? "error.main" : undefined }}
      >
        {formatMoney(value)}
      </Typography>
    </Stack>
  );
}

// The one figure the clinic acts on, split into the two things it is actually
// made of. Reported as a single number, it reads as if the whole amount were the
// partner's earnings, when most of it is usually the cost half coming back.
//
// Every row here is a share OF THE BALANCE, and the two of them always add back
// to it. That rule used to be broken by two extra rows carrying lifetime
// earnings from services and guaranteed days: those never fall when a payout is
// made, so a fully settled partner read as still owing whatever they had ever
// earned on services, under a heading saying zero. What their earnings were
// made of is a question about a period, and it is answered by the period
// figures above this card, where a wider date range asks for more of it.
export default function OwedBreakdownCard({
  balance,
  capitalOwed,
  profitOwed,
  profitShareToDate,
  earnedToDate,
  paidToDate,
  asOf,
}: Props) {
  const overpaid = Number(profitOwed ?? 0) < 0;
  // A range ending today makes this the live balance, which is both the usual
  // case and the one worth naming plainly.
  const live = asOf === "today";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: "100%",
        borderColor: "warning.main",
        borderLeftWidth: 3,
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {live ? "Owed now" : `Owed as at ${asOf}`}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.5, mb: 1.5 }}>
        {formatMoney(balance)}
      </Typography>

      <Divider sx={{ mb: 1.5 }} />

      <Stack spacing={1}>
        <Row
          label="Their capital"
          value={capitalOwed}
          hint="The cost half of the deal, going back to them"
        />
        <Row
          label="Their profit"
          value={profitOwed}
          hint={
            profitShareToDate
              ? `Of ${formatMoney(profitShareToDate)} earned ${
                  live ? "all time" : `up to ${asOf}`
                }`
              : "Their cut of the profit"
          }
          negative={overpaid}
        />
      </Stack>

      {/* What makes a zero read as settled rather than as empty. The pair is
          safe to show where a lone lifetime figure was not: both sides climb
          together, so the gap between them is always the balance above. */}
      {earnedToDate !== undefined && paidToDate !== undefined && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 1.5 }}
        >
          {`Earned ${formatMoney(earnedToDate)}, paid ${formatMoney(paidToDate)}${
            live ? " all time" : ` up to ${asOf}`
          }.`}
        </Typography>
      )}

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 0.5 }}
      >
        {overpaid
          ? "Payouts have gone past what is owed, so the profit line is negative."
          : "Payouts settle capital first, then profit."}
      </Typography>
    </Paper>
  );
}
