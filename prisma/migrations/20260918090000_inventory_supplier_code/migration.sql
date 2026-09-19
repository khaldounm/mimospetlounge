-- The supplier's own product code on an inventory item.
--
-- Suppliers identify a product by a short alphanumeric code on their price
-- lists and delivery notes (4, 8 or 12 characters seen so far; 32 leaves
-- room). It is carried onto purchase orders so the rep reads their own code
-- next to our name. It is NOT a barcode: many items have none and carry a
-- clinic-generated EAN instead, so this is free text, nullable, not unique,
-- and never used for scanning. No backfill: nothing existing changes.

-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN     "supplier_code" VARCHAR(32);
