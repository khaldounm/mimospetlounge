import { z } from "zod";
import { optionalString } from "./common";

// Profit-share percentage (0..100). Blank / absent -> 0.
const profitPct = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 0 : v),
  z.coerce
    .number({ message: "Profit share must be a number" })
    .min(0, "Profit share must be 0 or more")
    .max(100, "Profit share must be 100 or less"),
);

// Cost-share percentage. Deliberately allowed above 100, which is how an agreed
// uplift on cost is expressed (120 = cost plus 20%); capping it at 100 would
// make that deal unrepresentable. Blank / absent -> 100, so saying nothing about
// cost returns the partner their outlay. The ceiling is the column's own limit,
// Decimal(5,2).
const costPct = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? 100 : v),
  z.coerce
    .number({ message: "Cost share must be a number" })
    .min(0, "Cost share must be 0 or more")
    .max(999.99, "Cost share must be 999.99 or less"),
);

export const partnerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: optionalString(40),
  defaultCostPct: costPct,
  defaultProfitPct: profitPct,
  // What they take for a day they were here, whatever it earned. Blank clears
  // it, which puts the partner on no guarantee at all.
  dailyMinimum: z
    .preprocess(
      (v) => (v === "" || v === null ? null : v),
      z.coerce.number().nonnegative().max(99_999_999.99).nullable(),
    )
    .optional(),
  notes: optionalString(5000),
  isActive: z.coerce.boolean().optional(),
});

export const partnerUpdateSchema = partnerCreateSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

// ---- Payout ----

// Payout amount (must be greater than zero). Blank -> validation error.
const money = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce
    .number({ message: "Amount is required" })
    .positive("Amount must be greater than zero")
    .max(99_999_999.99),
);

// Required date the payout was made. Blank -> validation error.
const paidOn = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.trim() === "") return undefined;
    return v;
  },
  z.coerce.date({ message: "Date is required" }),
);

export const partnerPayoutCreateSchema = z.object({
  amount: money,
  paidOn,
  method: optionalString(50),
  reference: optionalString(100),
  notes: optionalString(5000),
});

// ---- Range query ----

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// The from/to pair the partner reads accept for their range-scoped figures.
// Both absent means "use the default range", which the caller supplies.
export const partnerRangeQuerySchema = z
  .object({ from: dateString, to: dateString })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

// A range plus a zero-based page index, for the paginated ledgers under a
// partner. Each of those sections asks for its own page, so the range and the
// page always travel together.
export const partnerPagedQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    page: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .refine((d) => d.from <= d.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type PartnerPagedQuery = z.infer<typeof partnerPagedQuerySchema>;

export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;
export type PartnerPayoutCreateInput = z.infer<
  typeof partnerPayoutCreateSchema
>;

// A month as the days view asks for it. Defaults to the current one, so the
// page can open without the caller working out today's date.
export const partnerMonthSchema = z.preprocess(
  (v) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : undefined),
  z.string().default(() => new Date().toISOString().slice(0, 7)),
);

// What can happen to one of a partner's days.
export const partnerDayActionSchema = z.object({
  action: z.enum(["attend", "absent", "settle", "unsettle"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  notes: z.string().trim().max(500).optional(),
});
