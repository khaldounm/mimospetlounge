import { z } from "zod";
import { optionalDate, optionalString } from "./common";
import { NOTIFICATION_CHANNELS } from "@/types/enums";

const channel = z.enum(NOTIFICATION_CHANNELS);

// Treat blank/absent ids as undefined so optional links don't fail coercion.
const optionalId = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  channel,
  triggerEvent: optionalString(100),
  body: z.string().trim().min(1, "Message body is required").max(5000),
  isActive: z.coerce.boolean().optional(),
});

export const templateUpdateSchema = templateCreateSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

export const notificationCreateSchema = z
  .object({
    clientId: z.coerce.number().int().positive("Client is required"),
    patientId: optionalId,
    bookingId: optionalId,
    templateId: optionalId,
    channel,
    // A custom body overrides the template body when provided.
    body: optionalString(5000),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    scheduledAt: optionalDate,
  })
  .refine(
    (data) =>
      data.templateId !== undefined ||
      (data.body !== undefined && data.body.trim().length > 0),
    { message: "Provide a template or a message body", path: ["body"] },
  );

// Lifecycle actions on an existing notification.
export const notificationActionSchema = z.object({
  action: z.enum(["send", "retry", "cancel"]),
});

// A booking type's default reminder template. null clears it, which sends the
// type's bookings back to the generic template.
export const reminderDefaultSchema = z.object({
  templateId: z.number().int().positive().nullable(),
});

// The reminder kind attached to one booking from the Upcoming row.
export const reminderAttachSchema = z.object({
  templateId: z.number().int().positive(),
});

// Reminder trigger: send one booking's reminder, or generate for all eligible.
// `body` sends this one booking an edited text instead of the template's, for
// the "Edit once" in the row preview; the template stays as it was.
// `skip` and `limit` let the tab run a long list as a series of short
// requests (see generateBookingReminders), each one comfortably inside a
// serverless function's time budget.
export const reminderActionSchema = z
  .object({
    bookingId: z.coerce.number().int().positive().optional(),
    body: optionalString(5000),
    all: z.coerce.boolean().optional(),
    skip: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine((data) => data.all === true || data.bookingId !== undefined, {
    message: "Provide a bookingId or set all=true",
  });

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;
// Lifecycle action on a recall reminder. "snooze" requires a future date to
// hide the recall until; "dismiss" / "done" are terminal.
export const reminderUpdateSchema = z
  .object({
    action: z.enum(["dismiss", "done", "snooze", "followup"]),
    snoozedUntil: optionalDate,
  })
  .refine(
    (data) => data.action !== "snooze" || data.snoozedUntil !== undefined,
    { message: "A snooze date is required", path: ["snoozedUntil"] },
  );

export type NotificationCreateInput = z.infer<typeof notificationCreateSchema>;
export type NotificationActionInput = z.infer<typeof notificationActionSchema>;
export type ReminderActionInput = z.infer<typeof reminderActionSchema>;
export type ReminderDefaultInput = z.infer<typeof reminderDefaultSchema>;
export type ReminderAttachInput = z.infer<typeof reminderAttachSchema>;
export type ReminderUpdateInput = z.infer<typeof reminderUpdateSchema>;
