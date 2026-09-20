import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Session } from "next-auth";
import { AUDIT_RETENTION_DAYS } from "@/constants/audit";
import type { AuditAction, AuditEntity } from "@/constants/audit";
import type { AuditLogDTO } from "@/types/entities";

export const auditInclude = {
  user: { select: { firstName: true, lastName: true } },
} as const;

type AuditRow = Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>;

export function toAuditDTO(a: AuditRow): AuditLogDTO {
  return {
    auditId: a.auditId.toString(),
    userId: a.userId,
    userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    changes: a.changes,
    createdAt: a.createdAt.toISOString(),
  };
}

interface AuditEntry {
  action: AuditAction;
  entity: AuditEntity;
  entityId: number;
  // Any JSON-serializable snapshot of what changed. Dates / Decimals are
  // normalized to strings before storage; undefined keys are dropped.
  changes?: unknown;
}

// Normalizes arbitrary input into a Prisma JSON value: Dates -> ISO strings,
// Prisma Decimals -> strings, undefined keys removed.
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// Records an audit_log row for a mutation. Best-effort by design: a logging
// failure must never break the user's operation, so errors are swallowed and
// logged. Pass the Session returned by requirePermission to capture the actor.
export async function writeAudit(
  // Usually the Session from requirePermission. The enrollment page has no
  // session yet, only the user the link belongs to, so a bare actor is
  // accepted too: what the log needs is the user id.
  session: Session | { user: { userId: number } } | null | undefined,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: session?.user?.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        changes:
          entry.changes === undefined ? undefined : toJson(entry.changes),
      },
    });
  } catch (err) {
    console.error("Failed to write audit log", err);
  }
}

// How many entries are old enough to be pruned, and the cutoff they are measured
// against. Read before the confirmation dialog opens so the figure on the button
// is the figure that will actually go.
export async function auditPrunePreview(
  olderThanDays: number = AUDIT_RETENTION_DAYS,
): Promise<{ prunable: number; cutoff: string; olderThanDays: number }> {
  const cutoff = cutoffFor(olderThanDays);
  const prunable = await prisma.auditLog.count({
    where: { createdAt: { lt: cutoff } },
  });
  return { prunable, cutoff: cutoff.toISOString(), olderThanDays };
}

// Deletes audit entries older than the cutoff. Irreversible: there is no soft
// delete on audit_log, and nothing else in the app records what it recorded.
//
// Returns the number of rows removed. The caller writes an audit entry for the
// prune afterwards, which is why that entry survives its own operation.
export async function pruneAuditLog(
  olderThanDays: number = AUDIT_RETENTION_DAYS,
): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = cutoffFor(olderThanDays);
  const { count } = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: count, cutoff: cutoff.toISOString() };
}

function cutoffFor(olderThanDays: number): Date {
  // Guarded rather than trusted: a zero or negative window would mean "delete
  // everything, including what just happened".
  const days = Math.max(Math.floor(olderThanDays), 1);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}
