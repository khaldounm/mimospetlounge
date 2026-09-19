import { z } from "zod";
import { optionalString, optionalDate } from "./common";
import { DISCOUNT_UNITS, DEFAULT_DISCOUNT_UNIT } from "@/constants/order";

// Order quantity: always a positive magnitude (a line for zero is a line that
// should not exist, so it is removed instead).
const quantity = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce
    .number({ message: "Quantity is required" })
    .positive("Quantity must be greater than zero")
    .max(1_000_000),
);

// Amount keyed in the item's loose unit (200 for "200 kg"). The server converts
// it to a pack quantity and a per-pack cost, so the browser never decides how
// many bags 200 kg is.
const optionalLooseQty = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().positive().max(1_000_000).optional(),
);

// Non-negative unit cost. Blank -> undefined (cost not known yet).
const optionalCost = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().nonnegative().max(99_999_999.99).optional(),
);

// Order-level charge (discount, delivery, VAT amount). Each is a non-negative
// magnitude; which way it moves the total is fixed by which field it is, not by
// its sign. Blank -> null (clears it).
const optionalCharge = z
  .preprocess(
    (v) => (v === "" || v === null ? null : v),
    z.coerce.number().nonnegative().max(99_999_999.99).nullable(),
  )
  .optional();

// VAT percentage (0..100). Blank -> null, which means no VAT on this bill.
const optionalRate = z
  .preprocess(
    (v) => (v === "" || v === null ? null : v),
    z.coerce.number().min(0).max(100).nullable(),
  )
  .optional();

// Optional supplier link. Blank / 0 -> null, which parks the order back in the
// "No supplier" bucket.
const optionalSupplierId = z
  .preprocess(
    (v) => (v === "" || v === null || v === 0 || v === "0" ? null : v),
    z.coerce.number().int().positive().nullable(),
  )
  .optional();

// Which shelf an order covers. Blank -> null, meaning an order that is not tied
// to one product line. Not restricted to INVENTORY_CATEGORIES on purpose: the
// column is free text on the item too, and rejecting a category the catalogue
// already uses would block an order for stock that exists.
const optionalCategory = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(100).nullable(),
  )
  .optional();

export const purchaseOrderCreateSchema = z.object({
  supplierId: optionalSupplierId,
  category: optionalCategory,
  reference: optionalString(100),
  notes: optionalString(5000),
});

// Header edits only. Status changes go through the dedicated place / receive /
// cancel routes so their side effects can never be skipped by a plain PATCH.
export const purchaseOrderUpdateSchema = z
  .object({
    supplierId: optionalSupplierId,
    category: optionalCategory,
    reference: optionalString(100),
    orderedOn: optionalDate,
    discountAmount: optionalCharge,
    shippingAmount: optionalCharge,
    taxRate: optionalRate,
    taxAmount: optionalCharge,
    notes: optionalString(5000),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

// quantityOrdered becomes optional when a loose amount is sent instead, since
// the server derives one from the other.
const optionalQuantity = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().positive().max(1_000_000).optional(),
);

export const purchaseOrderLineCreateSchema = z
  .object({
    itemId: z.coerce.number().int().positive(),
    quantityOrdered: optionalQuantity,
    looseQty: optionalLooseQty,
    unitCost: optionalCost,
    notes: optionalString(5000),
  })
  .refine((d) => d.quantityOrdered !== undefined || d.looseQty !== undefined, {
    message: "Quantity is required",
    path: ["quantityOrdered"],
  });

export const purchaseOrderLineUpdateSchema = z
  .object({
    quantityOrdered: quantity,
    looseQty: optionalLooseQty,
    unitCost: optionalCost,
    notes: optionalString(5000),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

// One delivery against an order. Lines left out, or sent as zero, simply did not
// arrive this time and stay outstanding for a later receipt.
export const receiveOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.coerce.number().int().positive(),
        quantity: z.preprocess(
          (v) => (v === "" || v === null || v === undefined ? 0 : v),
          z.coerce.number().nonnegative().max(1_000_000),
        ),
        // What the supplier actually invoiced for this delivery, before any
        // discount. The order was raised from an estimate, so this is the first
        // point the real figure is known. Omitted leaves the line's existing
        // cost standing.
        unitCost: optionalCost,
        // A trade discount off that cost, as a flat amount or a percentage of
        // it. Reduces the unit cost, so the net is what books against stock and
        // against the supplier. A percentage is capped at 100 here; an amount
        // larger than the cost is caught per line below, where the cost is in
        // scope.
        discount: z.preprocess(
          (v) => (v === "" || v === null || v === undefined ? 0 : v),
          z.coerce
            .number({ message: "Discount must be a number" })
            .nonnegative("Discount cannot be negative")
            .max(99_999_999.99),
        ),
        discountUnit: z.enum(DISCOUNT_UNITS).default(DEFAULT_DISCOUNT_UNIT),
        // When the delivery note is written in kilos rather than bags. The cost
        // above is then per kilo and converts with it.
        looseQty: optionalLooseQty,
        // Off the carton, for perishables. Ignored on items that do not track
        // expiry, so a leash never needs one.
        lotNumber: optionalString(100),
        expiryDate: optionalDate,
      }),
    )
    .min(1, "Nothing to receive")
    // A discount that swallows the whole cost means someone mistyped a rate as
    // an amount (or the other way round). Refused rather than floored, because
    // booking stock in at zero would quietly wipe the item's cost price and
    // hand the profit report a free carton.
    .superRefine((lines, ctx) => {
      lines.forEach((line, i) => {
        if (line.discount <= 0) return;
        if (line.discountUnit === "percent") {
          if (line.discount > 100) {
            ctx.addIssue({
              code: "custom",
              path: [i, "discount"],
              message: "A percentage discount cannot be more than 100%",
            });
          }
          return;
        }
        if (line.unitCost !== undefined && line.discount > line.unitCost) {
          ctx.addIssue({
            code: "custom",
            path: [i, "discount"],
            message: `A discount of ${line.discount} is more than the unit cost of ${line.unitCost}`,
          });
        }
      });
    }),
  receivedOn: optionalDate,
  // When the delivery is short: close this order at what arrived and move the
  // rest to a new order, rather than leaving it Partial. A strict boolean for
  // the same reason as markPlaced below: coercion would read "false" as true,
  // and this rewrites the order's lines.
  splitRemainder: z.boolean().optional(),
});

// Bulk push from the inventory low-stock basket. Each line is routed to the
// open draft for that item's usual supplier, so the client never picks an order.
export const addToFutureOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.coerce.number().int().positive(),
        quantity,
      }),
    )
    .min(1, "Pick at least one item"),
});

export type PurchaseOrderLineCreateInput = z.infer<
  typeof purchaseOrderLineCreateSchema
>;
export type AddToFutureOrderInput = z.infer<typeof addToFutureOrderSchema>;

// One delivered line going back to the supplier. The quantity is a positive
// magnitude; the server negates it, so a caller cannot turn a return into an
// order by getting the sign wrong.
export const supplierReturnCreateSchema = z.object({
  entries: z
    .array(
      z.object({
        sourceLineId: z.coerce.number().int().positive(),
        quantity: z.coerce.number().positive().max(999_999),
      }),
    )
    .min(1, "Choose at least one line"),
});

export type SupplierReturnCreateInput = z.infer<
  typeof supplierReturnCreateSchema
>;

// Which of the supplier's contacts an order is being sent to. The server checks
// the contact actually belongs to that supplier, so an id alone is enough here.
//
// markPlaced carries the dialog's checkbox: sending a draft to a supplier is
// what placing an order means, but sending one to ask for a quote is not, and
// there is no way back out of Placed. It only applies to a Draft.
export const orderWhatsAppSchema = z.object({
  contactId: z.coerce.number().int().positive(),
  // A strict boolean, not z.coerce.boolean(): coercion treats any non-empty
  // string as true, so a body carrying "false" would place an order the caller
  // asked not to place. Placing cannot be undone, so this one has to be exact.
  markPlaced: z.boolean().optional(),
});

export type OrderWhatsAppInput = z.infer<typeof orderWhatsAppSchema>;
