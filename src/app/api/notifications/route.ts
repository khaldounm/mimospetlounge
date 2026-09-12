import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle, parseBody, requirePermission } from "@/lib/api";
import {
  composeNotification,
  notificationInclude,
  toNotificationDTO,
} from "@/lib/notifications";
import { writeAudit } from "@/lib/audit";
import { notificationCreateSchema } from "@/schemas/notification";

export async function GET(request: Request) {
  return handle(async () => {
    await requirePermission("notifications:read");

    const sp = new URL(request.url).searchParams;
    const status = sp.get("status")?.trim();
    const channel = sp.get("channel")?.trim();
    const clientId = Number(sp.get("clientId"));

    const notifications = await prisma.notification.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(channel ? { channel } : {}),
        ...(Number.isInteger(clientId) && clientId > 0 ? { clientId } : {}),
      },
      include: notificationInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      notifications: notifications.map(toNotificationDTO),
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requirePermission("notifications:write");
    const data = await parseBody(request, notificationCreateSchema);

    const notification = await composeNotification({
      clientId: data.clientId,
      patientId: data.patientId,
      bookingId: data.bookingId,
      templateId: data.templateId,
      channel: data.channel,
      body: data.body,
      scheduledAt: data.scheduledAt,
      dueDate: data.dueDate,
      serviceName: data.serviceName,
    });

    await writeAudit(session, {
      action: "create",
      entity: "notification",
      entityId: notification.notificationId,
      changes: {
        clientId: data.clientId,
        channel: data.channel,
        templateId: data.templateId,
      },
    });

    return NextResponse.json({ notification }, { status: 201 });
  });
}
