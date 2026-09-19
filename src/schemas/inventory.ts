import { z } from "zod";
import {
  optionalCostPct,
  optionalDate,
  optionalLinkId,
  optionalProfitPct,
  optionalString,
} from "./common";
import { INVENTORY_TX_TYPES, SIGNED_TX_TYPES } from "@/types/enums";

// Non-negative money value (sale price / cost). Blank -> undefined.
const optionalMoney = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().nonnegative().max(99_999_999.99).optional(),
);

const optionalPositiveInt = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

// Non-negative stock quantity (2dp). Blank -> undefined.
const optionalQuantity = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce.number().nonnegative().max(1_000_000).optional(),
);

// Loose selling config. Each is nullable so the setup can be cleared, and the
// three are validated together below: an item is either set up for loose sale
// or it is not, never half configured.
const optionalLooseUnit = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : (v ?? null)),
    z.string().trim().min(1).max(20).nullable(),
  )
  .optional();

const optionalLoosePerUnit = z
  .preprocess(
    (v) => (v === "" || v === null ? null : v),
    z.coerce.number().positive().max(1_000_000).nullable(),
  )
  .optional();

const optionalLoosePrice = z
  .preprocess(
    (v) => (v === "" || v === null ? null : v),
    z.coerce.number().nonnegative().max(99_999_999.99).nullable(),
  )
  .optional();

// Item metadata plus an optional opening stock. Ongoing stock still moves solely
// through inventory transactions; opening stock just seeds the first Received
// movement at create time, so the audit log stays the source of truth.
const inventoryItemCreateFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  category: optionalString(100),
  barcode: optionalString(100),
  // The supplier's own product code. 4 to 12 characters in practice; 32 is the
  // column. Not a barcode, so no format is imposed beyond the length.
  supplierCode: optionalString(32),
  unit: optionalString(50),
  reorderLevel: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  salePrice: optionalMoney,
  lastCost: optionalMoney,
  partnerId: optionalLinkId,
  partnerCostPct: optionalCostPct,
  partnerProfitPct: optionalProfitPct,
  supplierId: optionalLinkId,
  expiryDate: optionalDate,
  // Perishable: capture a lot and expiry at each delivery, and pick
  // first-expiring-first on sale.
  tracksExpiry: z.coerce.boolean().optional(),
  // Loose selling: the unit a broken-open pack is sold in, how many of them a
  // pack holds, and what one costs. loosePrice is its own figure and is meant
  // to sit above salePrice / loosePerUnit, because loose sells at a markup.
  looseUnit: optionalLooseUnit,
  loosePerUnit: optionalLoosePerUnit,
  loosePrice: optionalLoosePrice,
  notes: optionalString(5000),
  openingStock: optionalQuantity,
});

// The three loose fields stand or fall together, matching the DB CHECK. Setting
// a pack size without a price would leave an item that looks sellable by weight
// but has nothing to charge for it.
type LooseShape = {
  looseUnit?: string | null;
  loosePerUnit?: number | null;
  loosePrice?: number | null;
};

function looseIsCoherent(data: LooseShape): boolean {
  const set = [data.looseUnit, data.loosePerUnit, data.loosePrice].filter(
    (v) => v != null,
  ).length;
  return set === 0 || set === 3;
}

const LOOSE_MESSAGE =
  "To sell this loose, set the unit, how many are in a pack, and the loose price. To stop selling it loose, clear all three.";

export const inventoryItemCreateSchema = inventoryItemCreateFields.refine(
  looseIsCoherent,
  { message: LOOSE_MESSAGE, path: ["looseUnit"] },
);

// Updates never touch stock directly (that is what movements are for), so drop
// openingStock from the update shape.
export const inventoryItemUpdateSchema = inventoryItemCreateFields
  .omit({ openingStock: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  })
  // A partial update that mentions any loose field has to leave the trio
  // coherent, so a half-configured item cannot be reached in two steps either.
  .refine(
    (data) =>
      data.looseUnit === undefined &&
      data.loosePerUnit === undefined &&
      data.loosePrice === undefined
        ? true
        : looseIsCoherent(data),
    { message: LOOSE_MESSAGE, path: ["looseUnit"] },
  );

// A single stock movement. `quantity` is a magnitude for the directional types,
// whose direction their name already fixes, and a signed delta for the two in
// SIGNED_TX_TYPES. The server converts this into the signed value stored on the
// transaction.
export const inventoryTransactionSchema = z
  .object({
    type: z.enum(INVENTORY_TX_TYPES),
    quantity: z.coerce.number().max(99_999_999.99).min(-99_999_999.99),
    unitCost: optionalMoney,
    referenceType: optionalString(50),
    referenceId: optionalPositiveInt,
    notes: optionalString(5000),
  })
  .superRefine((data, ctx) => {
    if (data.quantity === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Quantity cannot be zero",
      });
    }
    if (!SIGNED_TX_TYPES.includes(data.type) && data.quantity < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Quantity must be a positive number",
      });
    }
    if (data.type === "Received" && data.unitCost === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["unitCost"],
        message: "Unit cost is required when receiving stock",
      });
    }
  });

export type InventoryTransactionInput = z.infer<
  typeof inventoryTransactionSchema
>;
