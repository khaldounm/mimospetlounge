import { NextResponse } from "next/server";
import { handle, parseId, requirePermission } from "@/lib/api";
import { getOrderDetail, splitOrder } from "@/lib/purchase-orders";
import { writeAudit } from "@/lib/audit";

// Closes a part-delivered order at what arrived and moves the rest to a new
// order, so this delivery's bill can be paid on its own. Moves no stock, so it
// needs orders:write but not inventory:write, the same as close-short.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  return handle(async () => {
    const session = await requirePermission("orders:write");
    const orderId = parseId((await params).orderId, "order id");

    const splitOrderId = await splitOrder(orderId, session.user.userId);
    await writeAudit(session, {
      action: "update",
      entity: "purchase_order",
      entityId: orderId,
      changes: { status: "Received", splitInto: splitOrderId },
    });
    await writeAudit(session, {
      action: "create",
      entity: "purchase_order",
      entityId: splitOrderId,
      changes: { splitFrom: orderId },
    });
    return NextResponse.json({
      order: await getOrderDetail(orderId),
      splitOrder: await getOrderDetail(splitOrderId),
    });
  });
}
