import type { PrismaClient } from "../src/generated/prisma/client";

// ── Permission catalogue ────────────────────────────────────
export const PERMISSIONS: Record<string, string> = {
  "patients:read": "View clients and patients",
  "patients:write": "Create/edit clients and patients",
  "clinical:read": "View clinical records",
  "clinical:write": "Create/edit clinical records",
  "bookings:read": "View bookings",
  "bookings:write": "Create/edit bookings",
  "inventory:read": "View inventory",
  "inventory:write": "Receive/adjust inventory",
  "invoices:read": "View invoices",
  "invoices:write": "Create/issue invoices",
  "payments:write": "Record payments",
  "notifications:read": "View notifications/templates",
  "notifications:write": "Manage notifications/templates",
  // Website contact form. Separate from notifications:* so a deployment without
  // a public website can switch the module off without losing reminders.
  "messages:read": "View website contact form messages",
  "users:read": "View staff/users",
  "users:write": "Manage staff/users",
  "audit:read": "View audit log",
  "analytics:read": "View the analytics dashboard",
  "costs:read": "View running costs and net profit",
  "costs:write": "Manage running costs",
  "partners:read": "View partners and consignment balances",
  "partners:write": "Manage partners and record payouts",
  // Purchasing. Deliberately separate from inventory:* so clinical staff can
  // see stock levels without seeing what the clinic pays for it.
  "orders:read": "View suppliers and purchase orders",
  "orders:write": "Manage suppliers and purchase orders",
  // Accounts payable. Separate from orders:* so someone can receive a delivery
  // and correct what it cost without seeing what the clinic owes the supplier,
  // what it has paid, or the statement.
  "payables:read": "View supplier balances, statements and payments",
  "payables:write": "Record supplier payments and credit notes",
};

// ── Role → permission grants ────────────────────────────────
export const ROLE_GRANTS: Record<string, string[]> = {
  Admin: Object.keys(PERMISSIONS), // everything
  Vet: [
    "patients:read",
    "clinical:read",
    "clinical:write",
    "bookings:read",
    "bookings:write",
    // Kept deliberately. On a deployment with inventory switched off this grant
    // clips inside hasPermission() and is simply invisible, so the catalogue and
    // the grants stay portable across clinics.
    "inventory:read",
    "invoices:read",
    // The vet builds the bill during the consult and closes it themselves, so
    // they need the same write grant reception has: hold, release, add lines
    // and issue. Payment stays with the front desk via payments:write.
    "invoices:write",
    "notifications:read",
    "messages:read",
  ],
  Receptionist: [
    "patients:read",
    "patients:write",
    "bookings:read",
    "bookings:write",
    "invoices:read",
    "invoices:write",
    "payments:write",
    "notifications:read",
    "notifications:write",
    "messages:read",
  ],
  Groomer: [
    "patients:read",
    "clinical:read",
    "clinical:write",
    "bookings:read",
    "bookings:write",
    "notifications:read",
    "messages:read",
  ],
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  Admin: "Full access to all modules and settings",
  Vet: "Veterinarian: clinical records, bookings, invoicing. No payments, stock or purchasing.",
  Receptionist: "Front desk, clients, bookings, invoicing and payments",
  Groomer: "Grooming bookings and grooming records",
};

// Reconciles the permission catalogue, the roles, and their default grants.
// Safe to run repeatedly. Shared by the seed, seed:rbac and the add-user script.
//
// Grants are ADDITIVE ONLY FOR WHAT IS NEW. A role that already exists keeps
// the matrix its Admin has shaped in Settings: only a permission this run just
// created gets its default grant. Before this rule, every run re-granted the
// whole catalogue and quietly undid removals, and add-user.ts (which calls
// this to work on a fresh database) was widening access every time someone
// joined. A role created here gets its full default set, as a fresh database
// always did.
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  const createdPermissions = new Set<string>();
  for (const [name, description] of Object.entries(PERMISSIONS)) {
    const existing = await prisma.permission.findUnique({ where: { name } });
    if (existing) {
      await prisma.permission.update({
        where: { name },
        data: { description },
      });
    } else {
      await prisma.permission.create({ data: { name, description } });
      createdPermissions.add(name);
    }
  }

  for (const [roleName, grants] of Object.entries(ROLE_GRANTS)) {
    const existingRole = await prisma.role.findUnique({
      where: { name: roleName },
    });
    const role = existingRole
      ? await prisma.role.update({
          where: { name: roleName },
          data: { description: ROLE_DESCRIPTIONS[roleName] },
        })
      : await prisma.role.create({
          data: { name: roleName, description: ROLE_DESCRIPTIONS[roleName] },
        });

    for (const permName of grants) {
      if (existingRole && !createdPermissions.has(permName)) continue;
      const perm = await prisma.permission.findUniqueOrThrow({
        where: { name: permName },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.roleId,
            permissionId: perm.permissionId,
          },
        },
        update: {},
        create: { roleId: role.roleId, permissionId: perm.permissionId },
      });
    }
  }
}
