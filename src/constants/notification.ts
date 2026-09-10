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

// Canonical trigger_event label that marks a template as the appointment
// reminder template. The reminder generator picks the active template whose
// triggerEvent equals this value.
export const BOOKING_REMINDER_TRIGGER = "booking_reminder";

// How far ahead a booking becomes eligible for a reminder. Bookings starting
// within this window (and not yet past) are listed in the Upcoming tab.
export const BOOKING_REMINDER_LEAD_DAYS = 7;

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
