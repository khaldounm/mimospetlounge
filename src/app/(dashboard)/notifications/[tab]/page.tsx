import { notFound } from "next/navigation";
import { CLINIC } from "@/constants/clinic";
import { liveSession } from "@/lib/session-user";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  listMissedBookings,
  listReminderTemplates,
  listUpcomingBookings,
  UPCOMING_PAGE_SIZE,
  notificationInclude,
  toNotificationDTO,
  toReminderTemplateOption,
  toTemplateDTO,
} from "@/lib/notifications";
import { listDueReminders } from "@/lib/reminders";
import { listBookingTypeOptions } from "@/lib/bookings";
import { RECALL_LEAD_DAYS } from "@/constants/notification";
import NotificationsTable from "@/components/notifications/NotificationsTable";
import TemplatesTable from "@/components/notifications/TemplatesTable";
import UpcomingTable from "@/components/notifications/UpcomingTable";
import MissedTable from "@/components/notifications/MissedTable";
import DueRecordsTable from "@/components/notifications/DueRecordsTable";
import type {
  BookingOption,
  ClientOption,
  PatientOption,
  TemplateOption,
} from "@/components/notifications/ComposeNotificationDialog";
import type { RecordType } from "@/types/enums";

// Recall tabs share DueRecordsTable; map slug -> reminder type + display noun.
const RECALL_TABS: Record<string, { recordType: RecordType; noun: string }> = {
  consultations: { recordType: "Consultation", noun: "consultation" },
  vaccinations: { recordType: "Vaccination", noun: "vaccination" },
  grooming: { recordType: "Grooming", noun: "groom" },
  treatments: { recordType: "Treatment", noun: "treatment" },
};

// Dropdown data for the compose dialog, fetched only by tabs that can send
// messages (missed + recalls + sent). Four light selects run in parallel.
async function getComposeOptions() {
  const now = new Date();
  const [clients, patients, bookings, templates] = await Promise.all([
    prisma.client.findMany({
      where: { deletedAt: null },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { clientId: true, firstName: true, lastName: true },
    }),
    prisma.patient.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { patientId: true, clientId: true, name: true },
    }),
    prisma.booking.findMany({
      where: { startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 200,
      select: {
        bookingId: true,
        clientId: true,
        startsAt: true,
        patient: { select: { name: true } },
      },
    }),
    prisma.notificationTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const clientOptions: ClientOption[] = clients.map((c) => ({
    clientId: c.clientId,
    label: `${c.firstName} ${c.lastName}`,
  }));
  const patientOptions: PatientOption[] = patients.map((p) => ({
    patientId: p.patientId,
    clientId: p.clientId,
    label: p.name,
  }));
  const bookingOptions: BookingOption[] = bookings.map((b) => ({
    bookingId: b.bookingId,
    clientId: b.clientId,
    label: `${b.patient.name} - ${b.startsAt.toLocaleString(CLINIC.locale, {
      timeZone: CLINIC.timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
  }));
  const templateOptions: TemplateOption[] = templates
    .map(toTemplateDTO)
    .map((t) => ({
      templateId: t.templateId,
      name: t.name,
      channel: t.channel,
      body: t.body,
    }));

  return { clientOptions, patientOptions, bookingOptions, templateOptions };
}

export default async function NotificationsTabPage({
  params,
}: {
  params: Promise<{ tab: string }>;
}) {
  const { tab } = await params;
  const session = await liveSession();
  const canWrite = hasPermission(session?.user, "notifications:write");

  if (tab === "upcoming") {
    // Opens on what is still to send: the tab is a worklist, and the first
    // thing on screen should be the work.
    const [upcoming, reminderTemplates] = await Promise.all([
      listUpcomingBookings({ pendingOnly: true }),
      listReminderTemplates(),
    ]);
    return (
      <UpcomingTable
        initialPage={upcoming}
        pageSize={UPCOMING_PAGE_SIZE}
        reminderOptions={reminderTemplates.map(toReminderTemplateOption)}
        canWrite={canWrite}
      />
    );
  }

  if (tab === "missed") {
    const [missed, options] = await Promise.all([
      listMissedBookings(),
      getComposeOptions(),
    ]);
    return (
      <MissedTable initialMissed={missed} canWrite={canWrite} {...options} />
    );
  }

  const recall = RECALL_TABS[tab];
  if (recall) {
    const [records, options] = await Promise.all([
      listDueReminders(recall.recordType),
      getComposeOptions(),
    ]);
    return (
      <DueRecordsTable
        initialRecords={records}
        noun={recall.noun}
        leadDays={RECALL_LEAD_DAYS[recall.recordType]}
        canWrite={canWrite}
        {...options}
      />
    );
  }

  if (tab === "templates") {
    const [templates, bookingTypes] = await Promise.all([
      prisma.notificationTemplate.findMany({ orderBy: { name: "asc" } }),
      listBookingTypeOptions(),
    ]);
    return (
      <TemplatesTable
        initialTemplates={templates.map(toTemplateDTO)}
        bookingTypes={bookingTypes}
        canWrite={canWrite}
      />
    );
  }

  if (tab === "sent") {
    const [notifications, options] = await Promise.all([
      prisma.notification.findMany({
        include: notificationInclude,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      getComposeOptions(),
    ]);
    return (
      <NotificationsTable
        initialNotifications={notifications.map(toNotificationDTO)}
        canWrite={canWrite}
        {...options}
      />
    );
  }

  notFound();
}
