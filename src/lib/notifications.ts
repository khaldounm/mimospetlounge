import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { CLINIC } from "@/constants/clinic";
import { normalizePhone } from "@/utils/phone";
import { hasSendAtNote } from "@/utils/booking-notes";
import { mapWithConcurrency } from "@/utils/async";
import {
  BOOKING_REMINDER_LEAD_DAYS,
  BOOKING_REMINDER_TRIGGER,
  BULK_REMINDER_BATCH,
  BULK_REMINDER_CONCURRENCY,
  MISSED_BOOKING_STATUSES,
  REMINDER_BOOKING_STATUSES,
} from "@/constants/notification";
import type {
  MissedBookingDTO,
  NotificationDTO,
  NotificationTemplateDTO,
  ReminderTemplateOption,
  UpcomingBookingDTO,
  UpcomingPageDTO,
} from "@/types/entities";
import type {
  BookingStatus,
  NotificationChannel,
  NotificationStatus,
} from "@/types/enums";

// ---- Includes + row types ----

export const notificationInclude = {
  client: { select: { firstName: true, lastName: true } },
  patient: { select: { name: true } },
  template: { select: { name: true } },
} as const;

type NotificationRow = Prisma.NotificationGetPayload<{
  include: typeof notificationInclude;
}>;

type TemplateRow = Prisma.NotificationTemplateGetPayload<true>;

// ---- DTO mappers ----

export function toNotificationDTO(n: NotificationRow): NotificationDTO {
  return {
    notificationId: n.notificationId,
    clientId: n.clientId,
    clientName: `${n.client.firstName} ${n.client.lastName}`,
    patientId: n.patientId,
    patientName: n.patient?.name ?? null,
    bookingId: n.bookingId,
    templateId: n.templateId,
    templateName: n.template?.name ?? null,
    channel: n.channel as NotificationChannel | null,
    recipient: n.recipient,
    body: n.body,
    status: n.status as NotificationStatus,
    retryCount: n.retryCount,
    scheduledAt: n.scheduledAt ? n.scheduledAt.toISOString() : null,
    sentAt: n.sentAt ? n.sentAt.toISOString() : null,
    errorMessage: n.errorMessage,
    createdAt: n.createdAt.toISOString(),
  };
}

export function toTemplateDTO(t: TemplateRow): NotificationTemplateDTO {
  return {
    templateId: t.templateId,
    name: t.name,
    channel: t.channel as NotificationChannel | null,
    triggerEvent: t.triggerEvent,
    body: t.body,
    isActive: t.isActive,
  };
}

// ---- Placeholder rendering ----

export interface RenderContext {
  clientFirstName: string;
  clientLastName: string;
  patientName?: string | null;
  // What the message is about: the recall's record title, or the booking
  // type. Empty when neither applies, so the token renders as nothing rather
  // than as itself.
  serviceName?: string | null;
  bookingStartsAt?: Date | null;
  dueDate?: string | null;
}

// "YYYY-MM-DD" -> "DD/MM/YYYY", empty string for null/undefined.
function formatDueDate(date?: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

// Substitute {{tokens}} in a template body with values from the linked entities.
// Unknown tokens are left untouched so authors notice typos.
export function renderBody(template: string, ctx: RenderContext): string {
  const at = ctx.bookingStartsAt ?? null;
  const map: Record<string, string> = {
    "{{client_name}}": `${ctx.clientFirstName} ${ctx.clientLastName}`.trim(),
    "{{client_first_name}}": ctx.clientFirstName,
    "{{patient_name}}": ctx.patientName ?? "",
    "{{service_name}}": ctx.serviceName ?? "",
    "{{booking_date}}": at
      ? at.toLocaleDateString("en-US", {
          timeZone: CLINIC.timezone,
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "",
    "{{booking_time}}": at
      ? at.toLocaleTimeString("en-US", {
          timeZone: CLINIC.timezone,
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    "{{clinic_name}}": CLINIC.name,
    "{{due_date}}": formatDueDate(ctx.dueDate),
    "{{consultation_due_date}}": formatDueDate(ctx.dueDate),
    "{{vaccination_due_date}}": formatDueDate(ctx.dueDate),
    "{{grooming_due_date}}": formatDueDate(ctx.dueDate),
    "{{treatment_due_date}}": formatDueDate(ctx.dueDate),
  };
  return template.replace(/\{\{[a-z_]+\}\}/g, (token) =>
    token in map ? map[token] : token,
  );
}

// Resolve and freeze the recipient address for a channel from the client record.
export function resolveRecipient(
  channel: NotificationChannel,
  client: { phone: string | null; email: string | null },
): string {
  if (channel === "Email") {
    if (!client.email) {
      throw new ApiError(400, "Client has no email address on file");
    }
    return client.email;
  }
  // WhatsApp + SMS are addressed by phone number.
  if (!client.phone) {
    throw new ApiError(400, "Client has no phone number on file");
  }
  const normalized = normalizePhone(client.phone);
  if (!normalized) {
    throw new ApiError(
      400,
      `Client phone number "${client.phone}" is not valid`,
    );
  }
  return normalized;
}

// ---- WhatsApp Cloud API ----

// Default WaSenderApi endpoint. Override with WASENDER_API_URL if the provider
// changes the path or you proxy it through your own gateway.
const WASENDER_DEFAULT_URL = "https://www.wasenderapi.com/api/send-message";

// Sends a free-form text message via WaSenderApi (wasenderapi.com) and returns
// the provider message id. Throws a descriptive Error when the API key is
// missing or the provider rejects the request, so dispatchNotification records
// the notification as Failed.
async function sendViaWhatsApp(
  recipient: string,
  body: string,
): Promise<string> {
  const apiUrl = process.env.WASENDER_API_URL || WASENDER_DEFAULT_URL;
  const apiKey = process.env.WASENDER_API_KEY;
  if (!apiKey) {
    throw new Error("WhatsApp API is not configured. Set WASENDER_API_KEY.");
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: recipient,
      text: body,
    }),
  });

  const json = (await res.json().catch(() => null)) as {
    data?: { msgId?: string | number; id?: string | number };
    message?: string;
    error?: string;
  } | null;

  if (!res.ok) {
    throw new Error(
      json?.error ?? json?.message ?? `WhatsApp API error (${res.status})`,
    );
  }

  const id = json?.data?.msgId ?? json?.data?.id;
  return id != null ? String(id) : "";
}

// Sends a document (e.g. an invoice PDF) via WaSenderApi. The provider fetches
// the file from `documentUrl`, so it must be a publicly reachable URL. Returns
// the provider message id; throws a descriptive Error on failure.
export async function sendDocumentViaWhatsApp(
  recipient: string,
  documentUrl: string,
  fileName: string,
  caption?: string,
): Promise<string> {
  const apiUrl = process.env.WASENDER_API_URL || WASENDER_DEFAULT_URL;
  const apiKey = process.env.WASENDER_API_KEY;
  if (!apiKey) {
    throw new Error("WhatsApp API is not configured. Set WASENDER_API_KEY.");
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: recipient,
      documentUrl,
      fileName,
      ...(caption ? { text: caption } : {}),
    }),
  });

  const json = (await res.json().catch(() => null)) as {
    data?: { msgId?: string | number; id?: string | number };
    message?: string;
    error?: string;
  } | null;

  if (!res.ok) {
    throw new Error(
      json?.error ?? json?.message ?? `WhatsApp API error (${res.status})`,
    );
  }

  const id = json?.data?.msgId ?? json?.data?.id;
  return id != null ? String(id) : "";
}

// ---- Lifecycle ----

// Attempts to deliver a notification through its channel and records the outcome
// on the row (Sent + sent_at, or Failed + error + retry_count++). Used by both
// the manual "send now" action and the cron worker. Send failures are captured
// on the row rather than thrown, so callers always get the updated state.
export async function dispatchNotification(
  notificationId: number,
): Promise<NotificationDTO> {
  const n = await prisma.notification.findUnique({
    where: { notificationId },
    include: notificationInclude,
  });
  if (!n) throw new ApiError(404, "Notification not found");
  if (n.status === "Sent" || n.status === "Delivered") {
    throw new ApiError(409, "Notification has already been sent");
  }

  try {
    if (n.channel === "WhatsApp") {
      await sendViaWhatsApp(n.recipient, n.body);
    } else {
      throw new Error(
        `${n.channel ?? "This channel"} sending is not implemented yet`,
      );
    }
    const updated = await prisma.notification.update({
      where: { notificationId },
      data: { status: "Sent", sentAt: new Date(), errorMessage: null },
      include: notificationInclude,
    });
    return toNotificationDTO(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    const updated = await prisma.notification.update({
      where: { notificationId },
      data: {
        status: "Failed",
        retryCount: { increment: 1 },
        errorMessage: message,
      },
      include: notificationInclude,
    });
    return toNotificationDTO(updated);
  }
}

// Cancels a still-pending notification. The schema's status CHECK has no
// 'Cancelled' value, so we record it as Failed with a clear reason rather than
// deleting the row, preserving the audit trail.
export async function cancelNotification(
  notificationId: number,
): Promise<NotificationDTO> {
  const n = await prisma.notification.findUnique({
    where: { notificationId },
    include: notificationInclude,
  });
  if (!n) throw new ApiError(404, "Notification not found");
  if (n.status !== "Pending") {
    throw new ApiError(409, "Only pending notifications can be cancelled");
  }
  const updated = await prisma.notification.update({
    where: { notificationId },
    data: { status: "Failed", errorMessage: "Cancelled" },
    include: notificationInclude,
  });
  return toNotificationDTO(updated);
}

// Cron worker: dispatch all due pending notifications (no schedule, or scheduled
// at/<= now), oldest first. Backed by idx_notif_worker (status, scheduled_at).
export async function processPendingNotifications(
  limit = 50,
): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date();
  const due = await prisma.notification.findMany({
    where: {
      status: "Pending",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { notificationId: true },
  });

  let sent = 0;
  let failed = 0;
  for (const d of due) {
    const result = await dispatchNotification(d.notificationId);
    if (result.status === "Sent") sent += 1;
    else failed += 1;
  }
  return { processed: due.length, sent, failed };
}

// ---- Compose ----

export interface ComposeInput {
  clientId: number;
  patientId?: number;
  bookingId?: number;
  templateId?: number;
  channel: NotificationChannel;
  body?: string;
  scheduledAt?: Date;
  dueDate?: string;
  // The recall's record title when following up from a recall tab; fills
  // {{service_name}}. Sent by the tab from the row rather than looked up
  // here, the same way dueDate travels.
  serviceName?: string;
}

// Validates the links, renders + freezes the body, resolves + freezes the
// recipient, and creates the notification in Pending status.
export async function composeNotification(
  input: ComposeInput,
): Promise<NotificationDTO> {
  const client = await prisma.client.findFirst({
    where: { clientId: input.clientId, deletedAt: null },
  });
  if (!client) throw new ApiError(404, "Client not found");

  let patient: { name: string } | null = null;
  if (input.patientId !== undefined) {
    const p = await prisma.patient.findFirst({
      where: { patientId: input.patientId, deletedAt: null },
    });
    if (!p) throw new ApiError(404, "Patient not found");
    if (p.clientId !== client.clientId) {
      throw new ApiError(400, "Patient does not belong to this client");
    }
    patient = { name: p.name };
  }

  let bookingStartsAt: Date | null = null;
  if (input.bookingId !== undefined) {
    const b = await prisma.booking.findUnique({
      where: { bookingId: input.bookingId },
    });
    if (!b) throw new ApiError(404, "Booking not found");
    if (b.clientId !== client.clientId) {
      throw new ApiError(400, "Booking does not belong to this client");
    }
    bookingStartsAt = b.startsAt;
  }

  let rawBody = input.body?.trim() ?? "";
  if (input.templateId !== undefined) {
    const template = await prisma.notificationTemplate.findUnique({
      where: { templateId: input.templateId },
    });
    if (!template) throw new ApiError(404, "Template not found");
    // A custom body overrides the template; otherwise use the template body.
    if (!rawBody) rawBody = template.body;
  }
  if (!rawBody) throw new ApiError(400, "Provide a template or a message body");

  const body = renderBody(rawBody, {
    clientFirstName: client.firstName,
    clientLastName: client.lastName,
    patientName: patient?.name,
    serviceName: input.serviceName,
    bookingStartsAt,
    dueDate: input.dueDate,
  });

  const recipient = resolveRecipient(input.channel, client);

  const created = await prisma.notification.create({
    data: {
      clientId: client.clientId,
      patientId: input.patientId ?? null,
      bookingId: input.bookingId ?? null,
      templateId: input.templateId ?? null,
      channel: input.channel,
      recipient,
      body,
      status: "Pending",
      scheduledAt: input.scheduledAt ?? null,
    },
    include: notificationInclude,
  });
  return toNotificationDTO(created);
}

// ---- Appointment reminders ----

// Returns the start (now) and end of the reminder window.
function reminderWindow(): { from: Date; to: Date } {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + BOOKING_REMINDER_LEAD_DAYS);
  return { from, to };
}

// ---- Reminder kinds ----
//
// A reminder kind is an active template carrying the booking-reminder trigger.
// A booking type names one as its default; a booking carries the one attached
// when it was taken. Resolution for a booking is attached, then the type's
// default, then the generic template (the lowest-id active kind, which is what
// every booking used before templates could be attached). Deactivating a
// template drops it out of the chain without touching the bookings that point
// at it: SET NULL is for a hard delete, deactivation simply stops resolving.

// Every reminder kind on offer, by name. A handful of rows; read once per
// request and resolved against in memory rather than joined per booking.
export async function listReminderTemplates(): Promise<TemplateRow[]> {
  return prisma.notificationTemplate.findMany({
    where: { isActive: true, triggerEvent: BOOKING_REMINDER_TRIGGER },
    orderBy: { name: "asc" },
  });
}

export function toReminderTemplateOption(
  t: Pick<TemplateRow, "templateId" | "name">,
): ReminderTemplateOption {
  return { templateId: t.templateId, name: t.name };
}

export interface ReminderKinds {
  /** Active booking-reminder templates by id. */
  templates: Map<number, TemplateRow>;
  /** typeId -> templateId, only for types whose default still resolves. */
  typeDefaults: Map<number, number>;
  /** The generic template, or null when the clinic has none. */
  generic: TemplateRow | null;
  // Every template that ever carried the trigger, active or not. A reminder
  // sent last month from a kind deactivated since is still a reminder sent, so
  // the "already sent" rule reads this list and not the live one.
  allIds: number[];
}

// Everything needed to resolve the template for any number of bookings, in two
// small queries (templates and the four-odd booking types). A page of the
// Upcoming tab and a bulk run both call this once, never per row.
export async function loadReminderKinds(): Promise<ReminderKinds> {
  const [templates, types] = await Promise.all([
    prisma.notificationTemplate.findMany({
      where: { triggerEvent: BOOKING_REMINDER_TRIGGER },
      orderBy: { templateId: "asc" },
    }),
    prisma.bookingType.findMany({
      where: { defaultTemplateId: { not: null } },
      select: { typeId: true, defaultTemplateId: true },
    }),
  ]);
  const active = templates.filter((t) => t.isActive);
  const byId = new Map(active.map((t) => [t.templateId, t]));
  const typeDefaults = new Map<number, number>();
  for (const t of types) {
    if (t.defaultTemplateId !== null && byId.has(t.defaultTemplateId)) {
      typeDefaults.set(t.typeId, t.defaultTemplateId);
    }
  }
  return {
    templates: byId,
    typeDefaults,
    // Ordered by id, so the first active one is the lowest.
    generic: active[0] ?? null,
    allIds: templates.map((t) => t.templateId),
  };
}

// 400 unless the id names a live reminder kind. Anything else would be
// attached, resolve to nothing at send time, and quietly send the generic
// text instead of what the person picked.
export async function assertReminderTemplate(
  templateId: number,
): Promise<void> {
  const template = await prisma.notificationTemplate.findUnique({
    where: { templateId },
    select: { isActive: true, triggerEvent: true },
  });
  if (
    !template ||
    !template.isActive ||
    template.triggerEvent !== BOOKING_REMINDER_TRIGGER
  ) {
    throw new ApiError(400, "Pick an active booking reminder template");
  }
}

// The template a new booking of this type starts with, or null when the type
// has no live default: a default that was deactivated since is not copied
// onto new bookings, they fall back to the generic reminder at send time.
export async function defaultReminderTemplateId(
  typeId: number | undefined,
): Promise<number | null> {
  if (typeId === undefined) return null;
  const type = await prisma.bookingType.findUnique({
    where: { typeId },
    select: {
      defaultTemplate: { select: { templateId: true, isActive: true } },
    },
  });
  const template = type?.defaultTemplate;
  return template && template.isActive ? template.templateId : null;
}

// The template a booking's reminder will use: attached, else the type's
// default, else the generic one. Null only when the clinic has no active
// booking-reminder template at all.
export function resolveReminderTemplate(
  kinds: ReminderKinds,
  booking: { reminderTemplateId: number | null; typeId: number | null },
): TemplateRow | null {
  if (booking.reminderTemplateId !== null) {
    const attached = kinds.templates.get(booking.reminderTemplateId);
    if (attached) return attached;
  }
  if (booking.typeId !== null) {
    const defaultId = kinds.typeDefaults.get(booking.typeId);
    if (defaultId !== undefined) {
      const byType = kinds.templates.get(defaultId);
      if (byType) return byType;
    }
  }
  return kinds.generic;
}

// ---- The Upcoming tab ----

export const UPCOMING_PAGE_SIZE = 25;
const MAX_UPCOMING_PAGE_SIZE = 100;

export interface UpcomingQuery {
  /** Free text over client and patient names. */
  q?: string;
  /** Only bookings whose reminder has not gone out (or only failed). */
  pendingOnly?: boolean;
  /** One-based, matching the API. */
  page?: number;
  pageSize?: number;
}

// Every booking the Upcoming tab is about: inside the reminder window, still
// expecting the client, and not belonging to an archived one.
function upcomingWhere(from: Date, to: Date): Prisma.BookingWhereInput {
  return {
    startsAt: { gte: from, lte: to },
    status: { in: REMINDER_BOOKING_STATUSES },
    client: { deletedAt: null },
  };
}

// A booking with no reminder that counts: none at all, or only failed ones,
// from any reminder kind there has ever been. The same rule the bulk send uses
// to decide what to send and sendBookingReminder uses to refuse a second one,
// expressed once so the three can never disagree. `in` on the nullable
// template_id is NULL for hand-composed notifications, which drops them:
// exactly right, they are not reminders.
function pendingReminderWhere(
  reminderTemplateIds: number[],
): Prisma.BookingWhereInput {
  return {
    notifications: {
      none: {
        templateId: { in: reminderTemplateIds },
        status: { not: "Failed" },
      },
    },
  };
}

// Each word has to match something, so "wissam kitten" narrows rather than
// widening: a full name typed out is the common search and it spans two
// columns. Capped so a pasted paragraph cannot turn into a 40-way join.
function nameSearchWhere(q: string | undefined): Prisma.BookingWhereInput {
  const terms = q?.trim().split(/\s+/).filter(Boolean).slice(0, 5) ?? [];
  if (terms.length === 0) return {};
  return {
    AND: terms.map((term) => ({
      OR: [
        { client: { firstName: { contains: term, mode: "insensitive" } } },
        { client: { lastName: { contains: term, mode: "insensitive" } } },
        { patient: { name: { contains: term, mode: "insensitive" } } },
      ],
    })) as Prisma.BookingWhereInput[],
  };
}

// What one Upcoming row is built from: the names it shows, the phone the
// preview is addressed to, and the latest reminder of any kind.
function upcomingInclude(reminderTemplateIds: number[]) {
  return {
    client: { select: { firstName: true, lastName: true, phone: true } },
    patient: { select: { name: true } },
    bookingType: { select: { name: true } },
    notifications: {
      where: { templateId: { in: reminderTemplateIds } },
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { notificationId: true, status: true },
    },
  };
}

type UpcomingRow = Prisma.BookingGetPayload<{
  include: ReturnType<typeof upcomingInclude>;
}>;

// The row as the tab shows it, template resolved and the message rendered
// here so nobody has to send blind: the preview is the exact text the Send
// button will dispatch, addressed to the number it will go to.
function toUpcomingDTO(
  b: UpcomingRow,
  kinds: ReminderKinds,
): UpcomingBookingDTO {
  const template = resolveReminderTemplate(kinds, b);
  // What the booking would have got with nothing attached, so the row can
  // say when someone chose differently.
  const byType = resolveReminderTemplate(kinds, {
    reminderTemplateId: null,
    typeId: b.typeId,
  });
  const reminder = b.notifications[0];

  let recipient: string | null = null;
  if (template) {
    try {
      recipient = resolveRecipient(
        (template.channel ?? "WhatsApp") as NotificationChannel,
        { phone: b.client.phone, email: null },
      );
    } catch {
      // No usable number: the row says so and Send will refuse.
    }
  }

  return {
    bookingId: b.bookingId,
    clientId: b.clientId,
    clientName: `${b.client.firstName} ${b.client.lastName}`,
    patientName: b.patient.name,
    startsAt: b.startsAt.toISOString(),
    bookingStatus: b.status as BookingStatus,
    typeName: b.bookingType?.name ?? null,
    reminderTemplateId: b.reminderTemplateId,
    templateId: template?.templateId ?? null,
    templateName: template?.name ?? null,
    // Attached by hand to something other than what the type would have said.
    isOverride:
      template !== null &&
      b.reminderTemplateId === template.templateId &&
      template.templateId !== byType?.templateId,
    preview: template
      ? renderBody(template.body, {
          clientFirstName: b.client.firstName,
          clientLastName: b.client.lastName,
          patientName: b.patient.name,
          serviceName: b.bookingType?.name,
          bookingStartsAt: b.startsAt,
        })
      : null,
    recipient,
    reminderStatus: reminder ? (reminder.status as NotificationStatus) : null,
    reminderNotificationId: reminder?.notificationId ?? null,
    notes: b.notes,
  };
}

// One page of eligible bookings inside the reminder window, each with the
// status of its most recent reminder. Used by the Upcoming tab.
//
// Paged in SQL. A week of bookings is small for one clinic and enormous for a
// busy one, and the tab used to ship every row in the window to the browser
// along with a notification lookup per row.
export async function listUpcomingBookings(
  query: UpcomingQuery = {},
): Promise<UpcomingPageDTO> {
  const { from, to } = reminderWindow();
  const kinds = await loadReminderKinds();
  const pageSize = Math.min(
    query.pageSize ?? UPCOMING_PAGE_SIZE,
    MAX_UPCOMING_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);

  const windowWhere = upcomingWhere(from, to);
  const pendingWhere = {
    ...windowWhere,
    ...pendingReminderWhere(kinds.allIds),
  };
  const searching = Boolean(query.q?.trim());
  const where: Prisma.BookingWhereInput = {
    ...(query.pendingOnly ? pendingWhere : windowWhere),
    ...nameSearchWhere(query.q),
  };

  const [bookings, windowTotal, windowPending, filtered, marked] =
    await Promise.all([
      prisma.booking.findMany({
        where,
        orderBy: { startsAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: upcomingInclude(kinds.allIds),
      }),
      prisma.booking.count({ where: windowWhere }),
      prisma.booking.count({ where: pendingWhere }),
      // With no search the filtered total is one of the two window counts
      // already being taken, so the third count only runs when it differs.
      searching ? prisma.booking.count({ where }) : null,
      // Narrowed to notes that could carry the marker before the exact rule is
      // applied in JS, so the precise test runs over a handful of rows instead
      // of the window. The two substrings are what SEND_AT_MARKER can match on.
      prisma.booking.findMany({
        where: {
          ...pendingWhere,
          OR: [
            { notes: { contains: "sendat", mode: "insensitive" } },
            { notes: { contains: "send at", mode: "insensitive" } },
          ],
        },
        select: { notes: true },
      }),
    ]);

  return {
    bookings: bookings.map((b) => toUpcomingDTO(b, kinds)),
    total: filtered ?? (query.pendingOnly ? windowPending : windowTotal),
    windowTotal,
    windowPending,
    pendingTimed: marked.filter((m) => hasSendAtNote(m.notes)).length,
  };
}

// Attaches a reminder kind to a booking from the Upcoming row. Returns the row
// re-resolved and re-rendered, so the preview on screen is the text that will
// now go out rather than the text that would have.
export async function attachReminderTemplate(
  bookingId: number,
  templateId: number,
): Promise<UpcomingBookingDTO> {
  await assertReminderTemplate(templateId);
  const kinds = await loadReminderKinds();
  const existing = await prisma.booking.findUnique({
    where: { bookingId },
    select: { bookingId: true },
  });
  if (!existing) throw new ApiError(404, "Booking not found");

  const updated = await prisma.booking.update({
    where: { bookingId },
    data: { reminderTemplateId: templateId },
    include: upcomingInclude(kinds.allIds),
  });
  return toUpcomingDTO(updated, kinds);
}

// Lists past bookings that were never completed (still Scheduled / Confirmed,
// or a recorded No Show), most recent first. Used by the Missed tab so staff
// can follow up. Bookings whose client has been archived are excluded.
export async function listMissedBookings(): Promise<MissedBookingDTO[]> {
  const now = new Date();

  const bookings = await prisma.booking.findMany({
    where: {
      endsAt: { lt: now },
      status: { in: MISSED_BOOKING_STATUSES },
      client: { deletedAt: null },
    },
    orderBy: { startsAt: "desc" },
    take: 200,
    include: {
      client: { select: { firstName: true, lastName: true } },
      patient: { select: { name: true } },
    },
  });

  return bookings.map((b) => ({
    bookingId: b.bookingId,
    clientId: b.clientId,
    clientName: `${b.client.firstName} ${b.client.lastName}`,
    patientId: b.patientId,
    patientName: b.patient.name,
    startsAt: b.startsAt.toISOString(),
    bookingStatus: b.status as BookingStatus,
  }));
}

// Creates (if needed) and sends the reminder for one booking, from the template
// resolved for it. Idempotent for already-handled bookings: if a non-failed
// reminder of any kind exists we return it instead of creating a duplicate, so
// switching the attached template after the send does not let a second message
// out. Pass the kinds when sending in bulk so they are read once, not per row.
export async function sendBookingReminder(
  bookingId: number,
  kinds?: ReminderKinds,
  bodyOverride?: string,
): Promise<NotificationDTO> {
  const resolved = kinds ?? (await loadReminderKinds());

  const booking = await prisma.booking.findUnique({
    where: { bookingId },
    include: {
      client: true,
      patient: { select: { name: true } },
      bookingType: { select: { name: true } },
    },
  });
  if (!booking) throw new ApiError(404, "Booking not found");
  if (booking.client.deletedAt) {
    throw new ApiError(400, "Booking client has been archived");
  }
  if (!REMINDER_BOOKING_STATUSES.includes(booking.status as BookingStatus)) {
    throw new ApiError(
      400,
      `Bookings with status "${booking.status}" do not get reminders`,
    );
  }

  // Idempotency: reuse an existing reminder unless it failed.
  const existing = await prisma.notification.findFirst({
    where: {
      bookingId,
      templateId: { in: resolved.allIds },
      status: { not: "Failed" },
    },
    orderBy: { createdAt: "desc" },
    include: notificationInclude,
  });
  if (existing) return toNotificationDTO(existing);

  const template = resolveReminderTemplate(resolved, booking);
  if (!template) {
    throw new ApiError(
      400,
      "No active booking reminder template. Create one on the Templates tab.",
    );
  }

  const channel = (template.channel ?? "WhatsApp") as NotificationChannel;
  // An edited text still goes through the placeholders, so a name typed as
  // {{patient_name}} in the preview box comes out as the pet's name.
  const body = renderBody(bodyOverride ?? template.body, {
    clientFirstName: booking.client.firstName,
    clientLastName: booking.client.lastName,
    patientName: booking.patient.name,
    serviceName: booking.bookingType?.name,
    bookingStartsAt: booking.startsAt,
  });
  const recipient = resolveRecipient(channel, booking.client);

  const created = await prisma.notification.create({
    data: {
      clientId: booking.clientId,
      patientId: booking.patientId,
      bookingId: booking.bookingId,
      templateId: template.templateId,
      channel,
      recipient,
      body,
      status: "Pending",
    },
  });

  // Send immediately: with manual-trigger-only there is no worker to pick it up.
  return dispatchNotification(created.notificationId);
}

export interface BulkReminderResult {
  sent: number;
  failed: number;
  /** Missing contact details or otherwise ineligible. */
  skipped: number;
  /** Left alone because the booking's note asks for a set send time. */
  held: number;
  /** Bookings still to send after this batch, for the caller to come back for. */
  remaining: number;
}

export interface BulkReminderOptions {
  /** Rows of the still-to-send list to step over: see the note below. */
  skip?: number;
  /** How many rows this call takes on. */
  limit?: number;
}

// Sends reminders for eligible bookings in the window that do not yet have a
// (non-failed) reminder, each from its own resolved template. Bookings missing
// contact details are skipped and counted rather than aborting the run;
// bookings whose note names a send time are held for the row's Send button,
// because sending them now is exactly what the note asked not to do.
//
// One call takes on `limit` rows and reports how many are left, so the tab
// runs a long list as a series of short requests, each inside the function's
// time budget, and counts up on screen between them. The still-to-send list
// is ordered by start time and only ever loses rows (the sent ones), so the
// rows a batch could not send stay at its front: the caller steps over them
// with `skip` = everything so far that was failed, skipped or held. A row
// that slips through twice is caught by the idempotency check in
// sendBookingReminder and costs nothing.
//
// Within a batch the provider round trip is the whole cost, so a few run at
// once: three, enough to turn a thirty-row morning from a minute into twenty
// seconds without leaning on the provider.
export async function generateBookingReminders(
  options: BulkReminderOptions = {},
): Promise<BulkReminderResult> {
  const { from, to } = reminderWindow();
  const kinds = await loadReminderKinds();
  const where = {
    ...upcomingWhere(from, to),
    ...pendingReminderWhere(kinds.allIds),
  };
  const skip = options.skip ?? 0;
  const limit = options.limit ?? BULK_REMINDER_BATCH;

  const [pendingTotal, due] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { bookingId: "asc" }],
      skip,
      take: limit,
      select: { bookingId: true, notes: true },
    }),
  ]);

  const result: BulkReminderResult = {
    sent: 0,
    failed: 0,
    skipped: 0,
    held: 0,
    remaining: Math.max(pendingTotal - skip - due.length, 0),
  };
  const toSend = due.filter((b) => {
    if (hasSendAtNote(b.notes)) {
      result.held += 1;
      return false;
    }
    return true;
  });

  await mapWithConcurrency(toSend, BULK_REMINDER_CONCURRENCY, async (b) => {
    try {
      const sent = await sendBookingReminder(b.bookingId, kinds);
      if (sent.status === "Sent" || sent.status === "Delivered") {
        result.sent += 1;
      } else {
        result.failed += 1;
      }
    } catch {
      // Missing contact / ineligible: skip and keep going.
      result.skipped += 1;
    }
  });
  return result;
}
