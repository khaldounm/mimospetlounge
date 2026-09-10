import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { toDateOnly } from "@/utils/format";
import {
  RECALL_LEAD_DAYS,
  RECALL_RECORD_TYPES,
} from "@/constants/notification";
import type { DueRecordDTO } from "@/types/entities";
import type { RecordType } from "@/types/enums";
import type { ReminderUpdateInput } from "@/schemas/notification";

// Recall reminders materialise the "who is due" list from clinical records into
// a small, indexed table. The time bucket (due / upcoming / overdue) is derived
// from due_date on read, so it never goes stale and needs no cron. status holds
// only the lifecycle (Open / Done / Dismissed) that can't be derived.

function isRecallType(recordType: string): recordType is RecordType {
  return (RECALL_RECORD_TYPES as string[]).includes(recordType);
}

// Local midnight today, used as the overdue / window boundary.
function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export interface UpsertRecallInput {
  patientId: number;
  recordType: RecordType;
  title: string;
  dueDate: Date;
  sourceRecordId: number;
}

// Keeps the single Open recall for a (patient, recordType) in sync with the
// latest due-bearing clinical record. Called inside the same transaction that
// creates the record, so the reminder can never silently diverge from its
// source. No-op for non-recall types or records without a due date (a later
// record with no nextDueDate does not clear an existing recall, matching the
// previous "latest due-bearing record wins" behaviour).
//
// The DB partial-unique index uq_reminders_open guarantees at most one Open row
// per (patient, recordType); the find-then-write here runs in the caller's
// transaction so concurrent writes for the same patient can't duplicate it.
export async function upsertRecallReminder(
  tx: Prisma.TransactionClient,
  input: UpsertRecallInput,
): Promise<void> {
  if (!isRecallType(input.recordType)) return;

  // Each clinical record owns its reminder row, looked up by sourceRecordId.
  const existing = await tx.reminder.findFirst({
    where: { sourceRecordId: input.sourceRecordId, status: "Open" },
    select: { reminderId: true },
  });

  if (existing) {
    await tx.reminder.update({
      where: { reminderId: existing.reminderId },
      data: {
        title: input.title,
        dueDate: input.dueDate,
        snoozedUntil: null,
      },
    });
    return;
  }

  await tx.reminder.create({
    data: {
      patientId: input.patientId,
      recordType: input.recordType,
      title: input.title,
      dueDate: input.dueDate,
      sourceRecordId: input.sourceRecordId,
      status: "Open",
    },
  });
}

// Lists open recalls of one type (Vaccination / Grooming) due within the lead
// window or already overdue, oldest first. Snoozed recalls (snoozedUntil in the
// future) and recalls for archived patients/clients are excluded. Backed by the
// partial index idx_reminders_due. Used by the Vaccinations / Grooming tabs.
export async function listDueReminders(
  recordType: RecordType,
): Promise<DueRecordDTO[]> {
  const today = startOfToday();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + RECALL_LEAD_DAYS[recordType]);

  const reminders = await prisma.reminder.findMany({
    where: {
      recordType,
      status: "Open",
      dueDate: { lte: cutoff },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: today } }],
      patient: { deletedAt: null, client: { deletedAt: null } },
    },
    orderBy: { dueDate: "asc" },
    select: {
      reminderId: true,
      recordType: true,
      title: true,
      dueDate: true,
      followUpSentAt: true,
      patient: {
        select: {
          patientId: true,
          name: true,
          clientId: true,
          client: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  return reminders.map((r) => ({
    reminderId: r.reminderId,
    recordType: r.recordType as RecordType,
    title: r.title,
    patientId: r.patient.patientId,
    patientName: r.patient.name,
    clientId: r.patient.clientId,
    clientName: `${r.patient.client.firstName} ${r.patient.client.lastName}`,
    nextDueDate: toDateOnly(r.dueDate) ?? "",
    isOverdue: r.dueDate.getTime() < today.getTime(),
    followUpSentAt: r.followUpSentAt?.toISOString() ?? null,
  }));
}

// Applies a lifecycle action to a recall reminder: dismiss / done (terminal) or
// snooze (stays Open, hidden until snoozedUntil). Only Open reminders can be
// acted on. Returns the new status for the audit trail.
export async function setReminderStatus(
  reminderId: number,
  input: ReminderUpdateInput,
): Promise<{ reminderId: number; status: string }> {
  const existing = await prisma.reminder.findUnique({
    where: { reminderId },
    select: { reminderId: true, status: true },
  });
  if (!existing) throw new ApiError(404, "Reminder not found");
  if (existing.status !== "Open") {
    throw new ApiError(409, "Only open reminders can be updated");
  }

  const data: Prisma.ReminderUpdateInput =
    input.action === "dismiss"
      ? { status: "Dismissed" }
      : input.action === "done"
        ? { status: "Done" }
        : input.action === "followup"
          ? { followUpSentAt: new Date() }
          : { snoozedUntil: input.snoozedUntil }; // snooze keeps status Open

  const updated = await prisma.reminder.update({
    where: { reminderId },
    data,
    select: { reminderId: true, status: true },
  });
  return updated;
}
