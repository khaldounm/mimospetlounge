import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handle, parseBody, requirePermission } from "@/lib/api";
import { canSeeCost } from "@/lib/permissions";
import {
  isUniqueConstraintError,
  itemExpiryInclude,
  openOpeningBatchTx,
  toInventoryItemDTO,
  toInventoryTransactionDTO,
} from "@/lib/inventory";
import { writeAudit } from "@/lib/audit";
import { inventoryItemUpdateSchema } from "@/schemas/inventory";

async function getItemId(params: Promise<{ itemId: string }>) {
  const { itemId } = await params;
  const id = Number(itemId);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid id");
  return id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("inventory:read");
    const itemId = await getItemId(params);

    const item = await prisma.inventoryItem.findFirst({
      where: { itemId, deletedAt: null },
      include: {
        partner: { select: { name: true } },
        supplier: { select: { name: true } },
        ...itemExpiryInclude,
        transactions: {
          orderBy: { performedAt: "desc" },
          include: {
            performer: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!item) throw new ApiError(404, "Inventory item not found");

    return NextResponse.json({
      item: toInventoryItemDTO(item, canSeeCost(session.user)),
      transactions: item.transactions.map((t) =>
        toInventoryTransactionDTO(t, canSeeCost(session.user)),
      ),
    });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("inventory:write");
    const itemId = await getItemId(params);
    const data = await parseBody(request, inventoryItemUpdateSchema);

    const existing = await prisma.inventoryItem.findFirst({
      where: { itemId, deletedAt: null },
      select: { itemId: true, tracksExpiry: true },
    });
    if (!existing) throw new ApiError(404, "Inventory item not found");

    // Switching an item that already holds stock over to batch tracking has to
    // open a batch for that stock. Sales of a tracked item pick from batches,
    // so a flag flip on its own leaves the item unsellable, refused as drift
    // that never happened.
    const startsTracking = data.tracksExpiry === true && !existing.tracksExpiry;

    try {
      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.inventoryItem.update({
          where: { itemId },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.category !== undefined ? { category: data.category } : {}),
            ...(data.barcode !== undefined ? { barcode: data.barcode } : {}),
            ...(data.unit !== undefined ? { unit: data.unit } : {}),
            ...(data.reorderLevel !== undefined
              ? { reorderLevel: data.reorderLevel }
              : {}),
            ...(data.salePrice !== undefined
              ? { salePrice: data.salePrice }
              : {}),
            // Cost is orders:read only. Hiding the field is not enough on its
            // own: a hand-rolled request from someone holding inventory:write
            // would still set a figure they are not allowed to read back.
            ...(data.lastCost !== undefined && canSeeCost(session.user)
              ? { lastCost: data.lastCost }
              : {}),
            ...(data.partnerId !== undefined
              ? { partnerId: data.partnerId }
              : {}),
            ...(data.partnerCostPct !== undefined
              ? { partnerCostPct: data.partnerCostPct }
              : {}),
            ...(data.partnerProfitPct !== undefined
              ? { partnerProfitPct: data.partnerProfitPct }
              : {}),
            ...(data.supplierId !== undefined
              ? { supplierId: data.supplierId }
              : {}),
            ...(data.expiryDate !== undefined
              ? { expiryDate: data.expiryDate }
              : {}),
            ...(data.tracksExpiry !== undefined
              ? { tracksExpiry: data.tracksExpiry }
              : {}),
            ...(data.looseUnit !== undefined
              ? { looseUnit: data.looseUnit }
              : {}),
            ...(data.loosePerUnit !== undefined
              ? { loosePerUnit: data.loosePerUnit }
              : {}),
            ...(data.loosePrice !== undefined
              ? { loosePrice: data.loosePrice }
              : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
          },
        });
        // Inside the flip's own transaction, so the flag and the batches can
        // never disagree.
        if (startsTracking) await openOpeningBatchTx(tx, itemId);
        return updated;
      });
      await writeAudit(session, {
        action: "update",
        entity: "inventory_item",
        entityId: itemId,
        changes: data,
      });
      return NextResponse.json({
        item: toInventoryItemDTO(item, canSeeCost(session.user)),
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ApiError(409, "That barcode is already in use.");
      }
      throw err;
    }
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("inventory:write");
    const itemId = await getItemId(params);

    const existing = await prisma.inventoryItem.findFirst({
      where: { itemId, deletedAt: null },
      select: { itemId: true },
    });
    if (!existing) throw new ApiError(404, "Inventory item not found");

    // Soft-delete: never hard-delete inventory. Keeps the transaction history
    // and any invoice line-item references intact.
    await prisma.inventoryItem.update({
      where: { itemId },
      data: { deletedAt: new Date() },
    });
    await writeAudit(session, {
      action: "delete",
      entity: "inventory_item",
      entityId: itemId,
      changes: { softDelete: true },
    });
    return NextResponse.json({ ok: true });
  });
}
