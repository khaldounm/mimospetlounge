-- Links a purchase order to the order it was cut from.
--
-- A short delivery can close its order at what arrived, so that delivery's
-- bill is payable on its own, and move the rest to a new Placed order at the
-- same prices. The new order records where it came from here. Nullable: every
-- existing order was raised on its own and keeps NULL. SET NULL on delete so
-- the continuation, which has its own deliveries and bill, outlives the
-- paperwork it started from.

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "split_from_order_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_purchase_orders_split_from" ON "purchase_orders"("split_from_order_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_split_from_order_id_fkey" FOREIGN KEY ("split_from_order_id") REFERENCES "purchase_orders"("order_id") ON DELETE SET NULL ON UPDATE CASCADE;
