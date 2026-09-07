/**
 * One dynamic segment serves two things: an item's detail page and a category
 * listing.
 *
 * Next.js allows only one dynamic slug name per path position, so
 * /inventory/[itemId] and /inventory/[category] cannot both exist. Numeric
 * segments are item ids and anything else is a category slug, which keeps the
 * existing /inventory/123 links working while giving categories the
 * /inventory/food shape.
 */
import { notFound } from "next/navigation";

import { liveSession } from "@/lib/session-user";
import { canSeeCost, hasPermission } from "@/lib/permissions";
import {
  getInventoryCategories,
  listInventory,
  INVENTORY_PAGE_SIZE,
} from "@/lib/inventory";
import { getActiveSuppliers } from "@/lib/suppliers";
import { categoryFromSlug } from "@/utils/inventory";
import InventoryTable from "@/components/inventory/InventoryTable";
import ItemPage from "./ItemPage";

export default async function InventorySegmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ segment: string }>;
  searchParams: Promise<{ supplier?: string }>;
}) {
  const { segment } = await params;

  if (/^\d+$/.test(segment)) {
    const id = Number(segment);
    if (!Number.isInteger(id) || id <= 0) notFound();
    return <ItemPage id={id} />;
  }

  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "inventory:write");
  const canViewSuppliers = hasPermission(session?.user, "orders:read");
  // Cost is its own answer, and a harder one: Admin only. See canSeeCost.
  const showCost = canSeeCost(session?.user);
  const canPurchase = hasPermission(session?.user, "orders:write");

  const categories = await getInventoryCategories();
  const category = categoryFromSlug(
    segment,
    categories.map((c) => c.category),
  );
  if (!category) notFound();

  const requested = canViewSuppliers
    ? (await searchParams).supplier
    : undefined;

  const [page, suppliers] = await Promise.all([
    listInventory({ category, supplier: requested, page: 1 }, showCost),
    canViewSuppliers ? getActiveSuppliers() : Promise.resolve([]),
  ]);

  return (
    <InventoryTable
      initialItems={page.items}
      initialTotal={page.total}
      pageSize={INVENTORY_PAGE_SIZE}
      categories={categories}
      activeCategory={category}
      canWrite={canWrite}
      canViewSuppliers={canViewSuppliers}
      canSeeCost={showCost}
      canCreateSuppliers={canPurchase}
      canOrder={canPurchase}
      suppliers={suppliers}
      initialSupplierFilter={requested ?? ""}
    />
  );
}
