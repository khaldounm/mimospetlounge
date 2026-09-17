import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import { canSeePartnerDeal, hasPermission } from "@/lib/permissions";
import { serviceVisibility, toServiceDTO } from "@/lib/invoices";
import { costComponentInclude } from "@/lib/services";
import ServicesTable from "@/components/invoices/ServicesTable";

export default async function ServicesPage() {
  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "invoices:write");
  const canSeeDeal = canSeePartnerDeal(session?.user);
  // Setting a deal is a partners:write term; seeing one is partners:read. Both
  // are Admin today, but they are asked separately so a future read-only
  // partner role reads the column without being able to change it.
  const canEditDeal = hasPermission(session?.user, "partners:write");
  // Cost rides on orders:*, the same split that keeps purchase prices away from
  // clinical staff. See canSeeCost. Editing the recipe is orders:write and is
  // NOT the same as seeing what it costs: a Vet with purchasing builds the
  // stock lines blind, and the figures stay Admin's.
  const visible = serviceVisibility(session?.user);
  const canEditCost = visible.recipe;

  const services = await prisma.service.findMany({
    orderBy: { name: "asc" },
    include: {
      ...(visible.deal ? { partner: { select: { name: true } } } : {}),
      ...(visible.cost || visible.recipe
        ? { costComponents: costComponentInclude }
        : {}),
    },
  });

  return (
    <ServicesTable
      initialServices={services.map((s) => toServiceDTO(s, visible))}
      canWrite={canWrite}
      canSeeDeal={canSeeDeal}
      canEditDeal={canEditDeal}
      canSeeCost={visible.cost}
      canEditCost={canEditCost}
    />
  );
}
