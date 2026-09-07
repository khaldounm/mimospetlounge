import { notFound } from "next/navigation";
import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import { canSeeCost, hasPermission } from "@/lib/permissions";
import {
  itemExpiryInclude,
  toInventoryItemDTO,
  toInventoryTransactionDTO,
} from "@/lib/inventory";
import InventoryDetail from "@/components/inventory/InventoryDetail";

export default async function InventoryItemPage({ id }: { id: number }) {
  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "inventory:write");
  const canViewSuppliers = hasPermission(session?.user, "orders:read");
  const canCreateSuppliers = hasPermission(session?.user, "orders:write");
  // Admin only, and checked on the role rather than the toggle. See canSeeCost.
  const showCost = canSeeCost(session?.user);

  const item = await prisma.inventoryItem.findFirst({
    where: { itemId: id, deletedAt: null },
    include: {
      partner: { select: { name: true } },
      supplier: { select: { name: true } },
      ...itemExpiryInclude,
      transactions: {
        orderBy: { performedAt: "desc" },
        include: { performer: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!item) notFound();

  return (
    <InventoryDetail
      item={toInventoryItemDTO(item, showCost)}
      initialTransactions={item.transactions.map((t) =>
        toInventoryTransactionDTO(t, showCost),
      )}
      canWrite={canWrite}
      canViewSuppliers={canViewSuppliers}
      canSeeCost={showCost}
      canCreateSuppliers={canCreateSuppliers}
      canOrder={canCreateSuppliers}
    />
  );
}
