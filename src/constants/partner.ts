// Partner (outsourced / consignment inventory) copy + option constants.

// The partner page and the partners list both open on today, where the
// analytics sections open on the current month. A partner screen answers "what
// do I owe them right now", and every ledger under it loads for whatever range
// is set, so a month of rows is a lot to pull for a question that is usually
// about this morning. Widening the dates is one click.
export const PARTNER_DEFAULT_PRESET_ID = "today";

// Rows per page in the ledgers under a partner. They are scanned newest-first
// rather than browsed, so a short page keeps the first screen quick and the
// pager carries anyone who really wants to read further.
export const PARTNER_PAGE_SIZE = 25;

// Payment methods offered when recording a payout to a partner. Mirrors the
// invoice PAYMENT_METHODS shape but kept separate so the two can diverge.
export const PARTNER_PAYOUT_METHODS = [
  "Cash",
  "Card",
  "Bank Transfer",
  "Other",
] as const;

export type PartnerPayoutMethod = (typeof PARTNER_PAYOUT_METHODS)[number];

// The sample sale the partner forms use to show what a pair of payout rates
// means in cash. Round numbers on purpose: the point is to make a deal legible
// at a glance, so the reader can check the arithmetic in their head.
export const SAMPLE_PAYOUT_COST = 100;
export const SAMPLE_PAYOUT_PRICE = 150;

// Plain-language definitions surfaced on the partners screens. Consignment
// blends two very different things into one payout (the partner's capital coming
// back, and their cut of the profit), which is the single biggest source of
// confusion when reading these figures, so the UI spells it out rather than
// leaving it to be worked out from the numbers.
export const PARTNER_GLOSSARY: { term: string; meaning: string }[] = [
  {
    term: "Revenue",
    meaning:
      "What customers paid for the partner's items. Stock only: money billed for services they performed is counted under Services, not here.",
  },
  {
    term: "Capital",
    meaning:
      "The partner's own money in the stock: what has already come back through sales plus what is still on the shelf. It is not profit for anyone, it is their stake being returned. How much of it the deal actually returns is the cost share: 100% hands back their outlay exactly, and a higher or lower rate hands back more or less.",
  },
  {
    term: "Gross profit",
    meaning: "Revenue minus what that stock cost. This is what gets split.",
  },
  {
    term: "Their share",
    meaning:
      "Everything the deal pays the partner above what the stock cost them. That is their profit cut, plus or minus any part of the cost share that runs above or below 100%.",
  },
  {
    term: "Clinic share",
    meaning:
      "What the clinic keeps: revenue less what the partner is owed. It can be negative, because a sale below cost still owes the partner their cost share and pays them no profit, so the clinic absorbs the shortfall.",
  },
  {
    term: "Owed",
    meaning:
      "Everything the partner has earned, minus payouts already made. That is the cost half of any stock deal, plus their profit cut, plus their cut of services they performed, plus any day the guarantee topped up. Split into capital and profit, and those two always add back to it. What their earnings were made of is a separate question, answered by the period figures above. Payouts settle capital first.",
  },
  {
    term: "Services",
    meaning:
      "Their cut of work they performed, rather than of stock they funded. Worked out per invoice line at the moment it was issued: the service price less what performing it cost, at the rate agreed for that service. Frozen there, so re-pricing stock later never moves a payout already earned.",
  },
  {
    term: "Day guarantee",
    meaning:
      "What the clinic tops a day up to when the partner was here and the day earned them less than their daily minimum. Everything that day paid them counts towards it: services they performed and their cut of any stock that sold. Each attended day stands on its own, so a quiet day is topped up even in a week that was busy overall. Only days somebody marked them present for, and only once settled.",
  },
  {
    term: "Performance vs Position",
    meaning:
      "Performance is a flow: what sold during the dates you picked, and nothing outside them. Position is a balance, so it counts everything from the start up to the last day of your range. Since every shortcut ends today, the position figures read as all-time until you set an earlier To date, which shows where things stood back then.",
  },
];
