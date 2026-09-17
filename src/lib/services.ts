import { Prisma } from "@/generated/prisma/client";
import type { ServiceCostComponentDTO } from "@/types/entities";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

// What one component costs the clinic, per performance of the service.
//
// An item line is valued at the item's lastCost, the same figure COGS and the
// consignment payout already use, so a service costs what its stock costs and
// no second notion of cost enters the app. An item with no cost on record
// contributes zero rather than inventing a figure: exactly what a hidden
// invoice line already does when it is expensed.
//
// Rounded per row rather than at the end, so the total is the sum of the
// figures actually shown beside each row and never reads a cent off them.
// The least a row has to be to be priced. Narrower than CostComponentRow on
// purpose: billing reads the recipe without selecting ids or names it will not
// use, and should not have to pretend it did.
export interface PricedComponent {
  quantity: Prisma.Decimal | null;
  amount: Prisma.Decimal | null;
  item?: { lastCost: Prisma.Decimal | null } | null;
}

export function componentCost(c: PricedComponent): Prisma.Decimal {
  if (c.amount != null) return c.amount;
  if (c.quantity == null) return D(0);
  return c.quantity.times(c.item?.lastCost ?? 0).toDecimalPlaces(2);
}

export type CostComponentRow = {
  componentId: number;
  itemId: number | null;
  quantity: Prisma.Decimal | null;
  label: string | null;
  amount: Prisma.Decimal | null;
  item?: { name: string; lastCost: Prisma.Decimal | null } | null;
};

export function toCostComponentDTO(
  c: CostComponentRow,
): ServiceCostComponentDTO {
  return {
    componentId: c.componentId,
    itemId: c.itemId,
    itemName: c.item?.name ?? null,
    quantity: c.quantity?.toString() ?? null,
    label: c.label,
    amount: c.amount?.toFixed(2) ?? null,
    lineCost: componentCost(c).toFixed(2),
    costKnown: c.itemId == null || c.item?.lastCost != null,
  };
}

// The same row for a caller who may edit the recipe but not see what stock
// costs: a stock line is the item and how much of it, unpriced; a flat row is
// exactly what was typed, because that figure is the editor's own and not a
// supplier price. lineCost is null on every row so nothing client-side can
// add them up into a total this caller is not allowed.
export function toBlindCostComponentDTO(
  c: CostComponentRow,
): ServiceCostComponentDTO {
  return { ...toCostComponentDTO(c), lineCost: null };
}

// What the whole service costs to perform once. Zero for a service with no
// components, which is every service until somebody gives it one.
export function serviceCostTotal(
  components: PricedComponent[],
): Prisma.Decimal {
  return components.reduce((sum, c) => sum.plus(componentCost(c)), D(0));
}

// Selected wherever a service's cost is wanted. lastCost rides along because
// the cost of an item line is derived from it, never stored on the component:
// a component is a recipe, and re-pricing stock must re-price the service.
export const costComponentInclude = {
  orderBy: { componentId: "asc" },
  include: { item: { select: { name: true, lastCost: true } } },
} as const;
