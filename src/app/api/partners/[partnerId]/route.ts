import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  handle,
  parseBody,
  parseId,
  requirePermission,
} from "@/lib/api";
import { getPartnerHeader, toPartnerDTO } from "@/lib/partners";
import { writeAudit } from "@/lib/audit";
import {
  partnerRangeQuerySchema,
  partnerUpdateSchema,
} from "@/schemas/partner";
import { resolvePreset } from "@/utils/date-range";
import { PARTNER_DEFAULT_PRESET_ID } from "@/constants/partner";

async function getPartnerId(params: Promise<{ partnerId: string }>) {
  return parseId((await params).partnerId, "partner id");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ partnerId: string }> },
) {
  return handle(async () => {
    await requirePermission("partners:read");
    const partnerId = await getPartnerId(params);

    const sp = new URL(request.url).searchParams;
    const parsed = partnerRangeQuerySchema.safeParse({
      from: sp.get("from"),
      to: sp.get("to"),
    });
    if (sp.has("from") && !parsed.success) {
      throw new ApiError(400, parsed.error.issues[0].message);
    }
    const range = parsed.success
      ? parsed.data
      : resolvePreset(PARTNER_DEFAULT_PRESET_ID)!;

    // Header figures only. The sales, payout and item ledgers are their own
    // endpoints, fetched when their section is opened.
    const header = await getPartnerHeader(partnerId, range);
    if (!header) throw new ApiError(404, "Partner not found");

    return NextResponse.json(header);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ partnerId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("partners:write");
    const partnerId = await getPartnerId(params);
    const data = await parseBody(request, partnerUpdateSchema);

    const existing = await prisma.partner.findFirst({
      where: { partnerId, deletedAt: null },
      select: { partnerId: true },
    });
    if (!existing) throw new ApiError(404, "Partner not found");

    const partner = await prisma.partner.update({
      where: { partnerId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.defaultCostPct !== undefined
          ? { defaultCostPct: data.defaultCostPct }
          : {}),
        ...(data.dailyMinimum !== undefined
          ? { dailyMinimum: data.dailyMinimum }
          : {}),
        ...(data.defaultProfitPct !== undefined
          ? { defaultProfitPct: data.defaultProfitPct }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    await writeAudit(session, {
      action: "update",
      entity: "partner",
      entityId: partnerId,
      changes: data,
    });
    return NextResponse.json({ partner: toPartnerDTO(partner) });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ partnerId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("partners:write");
    const partnerId = await getPartnerId(params);

    const existing = await prisma.partner.findFirst({
      where: { partnerId, deletedAt: null },
      select: { partnerId: true },
    });
    if (!existing) throw new ApiError(404, "Partner not found");

    // A soft-deleted partner drops off the ledger, so refuse to remove one that
    // still sources stock (future sales would accrue to a now-hidden partner) or
    // is still owed money. These must be cleared or settled first.
    const [activeItems, earnedAgg, paidAgg] = await Promise.all([
      prisma.inventoryItem.count({ where: { partnerId, deletedAt: null } }),
      prisma.inventoryTransaction.aggregate({
        _sum: { partnerPayable: true },
        where: { partnerId },
      }),
      prisma.partnerPayout.aggregate({
        _sum: { amount: true },
        where: { partnerId, deletedAt: null },
      }),
    ]);
    if (activeItems > 0) {
      throw new ApiError(
        409,
        `This partner still sources ${activeItems} inventory item(s). Reassign or clear them before removing the partner.`,
      );
    }
    const balance = (
      earnedAgg._sum.partnerPayable ?? new Prisma.Decimal(0)
    ).minus(paidAgg._sum.amount ?? 0);
    if (!balance.isZero()) {
      throw new ApiError(
        409,
        `This partner has an outstanding balance of ${balance.toFixed(2)}. Settle it with a payout before removing them.`,
      );
    }

    // Soft-delete: keep the accrual/payout history so balances stay reproducible.
    // The SET NULL FK leaves already-sold movements' frozen payable intact.
    await prisma.partner.update({
      where: { partnerId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await writeAudit(session, {
      action: "delete",
      entity: "partner",
      entityId: partnerId,
      changes: { softDelete: true },
    });
    return NextResponse.json({ ok: true });
  });
}
