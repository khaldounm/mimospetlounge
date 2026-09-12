import type {
  BookingStatus,
  NotificationStatus,
  RecordType,
} from "@/types/enums";

// Clinical-record types that generate a recall reminder when a nextDueDate is
// set. All four types are supported; each surfaces in its own Notifications tab.
export const RECALL_RECORD_TYPES: RecordType[] = [
  "Consultation",
  "Vaccination",
  "Grooming",
  "Treatment",
];

// Canonical trigger_event label that marks a template as a booking reminder.
// Every active template carrying it is offered as a reminder kind: a booking
// type names one as its default, a booking carries the one attached to it.
export const BOOKING_REMINDER_TRIGGER = "booking_reminder";

// What the template form offers for trigger_event, instead of free text. The
// column is the routing key for reminders, so a typo there used to mean a
// template that silently never sent. "None" is a template picked by hand in
// the compose dialog, which is what every recall message is today.
export const TEMPLATE_TRIGGERS: { value: string; label: string }[] = [
  { value: "", label: "None (picked by hand)" },
  { value: BOOKING_REMINDER_TRIGGER, label: "Booking reminder" },
];

// Reads a stored trigger_event back as its label, falling through to the raw
// value for anything the select does not know (a label typed before the
// select existed still shows what it says rather than nothing).
export function templateTriggerLabel(trigger: string | null): string {
  if (!trigger) return "-";
  return TEMPLATE_TRIGGERS.find((t) => t.value === trigger)?.label ?? trigger;
}

// How far ahead a booking becomes eligible for a reminder. Bookings starting
// within this window (and not yet past) are listed in the Upcoming tab.
export const BOOKING_REMINDER_LEAD_DAYS = 7;

// How many reminders the bulk send keeps in flight at once. The provider round
// trip is the whole cost of a send; three at a time turns a thirty-row morning
// from a minute into twenty seconds without leaning on the provider.
export const BULK_REMINDER_CONCURRENCY = 3;

// How many bookings one bulk request takes on before answering. The tab keeps
// asking until nothing is left, so a long list is a series of short requests
// rather than one that outlives the function, and the button can count up as
// it goes. Three waves of three.
export const BULK_REMINDER_BATCH = 9;

// Booking statuses that should still receive a reminder. Cancelled / Completed
// / No Show / Checked In are excluded (no point reminding about them).
export const REMINDER_BOOKING_STATUSES: BookingStatus[] = [
  "Scheduled",
  "Confirmed",
];

// Booking statuses that count as "missed" once the booking is in the past:
// still expecting the client (Scheduled / Confirmed) or a recorded No Show.
// Checked In, Completed and Cancelled are intentionally excluded.
export const MISSED_BOOKING_STATUSES: BookingStatus[] = [
  "Scheduled",
  "Confirmed",
  "No Show",
];

// Per-type lead windows (days before dueDate a recall becomes visible in its
// tab). Consultations and vaccinations are booked at short notice, grooming and
// treatments need more warning. This is the single source of truth: the tab
// query and the sentence above each table both read it, so they cannot drift.
export const RECALL_LEAD_DAYS: Record<RecordType, number> = {
  Consultation: 7,
  Vaccination: 7,
  Grooming: 30,
  Treatment: 30,
};

// Default snooze length, in days, when staff snooze a recall from the tabs. The
// recall stays Open but is hidden until the snooze date passes.
export const RECALL_SNOOZE_DAYS = 30;

// Notification centre tabs. Each is its own route (/notifications/<slug>) so
// tabs deep-link, prefetch, and fetch only their own data.
export const NOTIFICATION_TABS = [
  { slug: "upcoming", label: "Upcoming Bookings" },
  { slug: "missed", label: "Missed" },
  { slug: "consultations", label: "Consultations" },
  { slug: "vaccinations", label: "Vaccinations" },
  { slug: "grooming", label: "Grooming" },
  { slug: "treatments", label: "Treatments" },
  { slug: "templates", label: "Templates" },
  { slug: "sent", label: "Sent Messages" },
] as const;

export type NotificationTabSlug = (typeof NOTIFICATION_TABS)[number]["slug"];

// MUI Chip colors for each notification status, used across the list view.
export const NOTIFICATION_STATUS_COLOR: Record<
  NotificationStatus,
  "default" | "info" | "warning" | "success" | "error"
> = {
  Pending: "warning",
  Sent: "info",
  Delivered: "success",
  Failed: "error",
};

// Tokens substituted into a template/message body when a notification is
// composed. Rendering happens server-side against the linked client / patient /
// booking, then the rendered text is frozen on the notification row.
export const NOTIFICATION_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: "{{client_name}}", label: "Client full name" },
  { token: "{{client_first_name}}", label: "Client first name" },
  { token: "{{patient_name}}", label: "Patient name" },
  { token: "{{booking_date}}", label: "Booking date" },
  { token: "{{booking_time}}", label: "Booking time" },
  { token: "{{clinic_name}}", label: "Clinic name" },
  { token: "{{consultation_due_date}}", label: "Consultation due date" },
  { token: "{{vaccination_due_date}}", label: "Vaccination due date" },
  { token: "{{grooming_due_date}}", label: "Grooming due date" },
  { token: "{{treatment_due_date}}", label: "Treatment due date" },
];
