import { notFound } from "next/navigation";
import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import {
  canSeeCost,
  canSeePartnerDeal,
  hasPermission,
} from "@/lib/permissions";
import { invoiceInclude, toInvoiceDTO, toServiceDTO } from "@/lib/invoices";
import { toInventoryItemDTO } from "@/lib/inventory";
import { getFxRate } from "@/lib/settings";
import InvoiceDetail from "@/components/invoices/InvoiceDetail";
import type {
  ItemLineOption,
  ServiceLineOption,
} from "@/components/invoices/LineItemDialog";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const id = Number(invoiceId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "invoices:write");
  const canPay = hasPermission(session?.user, "payments:write");

  const [invoice, services, items, currentFxRate] = await Promise.all([
    prisma.invoice.findUnique({
      where: { invoiceId: id },
      include: invoiceInclude,
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    }),
    getFxRate(),
  ]);
  if (!invoice) notFound();

  // An issued invoice keeps the rate it was issued at, so reprinting it shows
  // what the customer actually handed over. A draft has none yet and follows
  // the current setting until it is issued.
  const fxRate = invoice.fxRate ? invoice.fxRate.toNumber() : currentFxRate;

  // All false: the picker keeps only id, name and price, so the deal, cost and
  // recipe would be built and thrown away. Their joins are skipped too.
  const serviceOptions: ServiceLineOption[] = services
    .map((s) => toServiceDTO(s, { deal: false, cost: false, recipe: false }))
    .map((s) => ({ serviceId: s.serviceId, name: s.name, price: s.price }));

  const itemOptions: ItemLineOption[] = items
    .map((i) => toInventoryItemDTO(i, canSeeCost(session?.user)))
    .map((i) => ({
      itemId: i.itemId,
      name: i.name,
      barcode: i.barcode,
      salePrice: i.salePrice,
      currentStock: i.currentStock,
      unit: i.unit,
      looseUnit: i.looseUnit,
      loosePerUnit: i.loosePerUnit,
      loosePrice: i.loosePrice,
    }));

  return (
    <InvoiceDetail
      invoice={toInvoiceDTO(invoice)}
      serviceOptions={serviceOptions}
      itemOptions={itemOptions}
      canWrite={canWrite}
      canPay={canPay}
      canSeeDeal={canSeePartnerDeal(session?.user)}
      fxRate={fxRate}
    />
  );
}
