// Single source of truth for RBAC checks, route gating, and nav visibility.

import { isPermissionEnabled } from "@/constants/features";

export interface PermissionHolder {
  permissions?: string[] | null;
  // Read live from the database by liveSession() on every server-side call, so
  // it is the role the user holds now, not the one frozen into the cookie.
  roleName?: string | null;
}

export function hasPermission(
  user: PermissionHolder | null | undefined,
  permission: string,
): boolean {
  // Deployment gate first. A permission belonging to a module this clinic does
  // not run is denied even when the role grants it, so dead grants (the Vet's
  // inventory:read, Admin's everything) clip harmlessly and nothing has to be
  // removed from the catalogue in prisma/rbac.ts. This is the single chokepoint:
  // requirePermission() delegates here, and nav visibility plus proxy.ts route
  // gating both flow through it.
  if (!isPermissionEnabled(permission)) return false;
  return Boolean(user?.permissions?.includes(permission));
}

// Cost visibility has one gate across the whole app: `orders:read`, which only
// Admin holds. Named rather than repeated so the answer to "who may see what an
// item cost" lives in one place and moving it is one edit.
export const COST_PERMISSION = "orders:read";

export const ADMIN_ROLE = "Admin";

export function isAdminRole(
  user: PermissionHolder | null | undefined,
): boolean {
  return user?.roleName === ADMIN_ROLE;
}

// Cost is Admin-only, and this is a HARD check on the role, not only on the
// permission.
//
// The permission on its own was not enough. `orders:read` is a Settings toggle,
// and Purchasing write cascades to read (see applyPermissionToggle), so one
// tick meant to let the front desk receive a delivery also handed reception
// every supplier price in the app. Margin is the owner's, and no toggle in the
// UI is allowed to give it away by accident.
//
// Both halves are required: the role says who, the permission says the module
// is on for this deployment. Anyone who genuinely needs cost without being an
// Admin needs a role change, made deliberately, not a checkbox.
export function canSeeCost(user: PermissionHolder | null | undefined): boolean {
  return isAdminRole(user) && hasPermission(user, COST_PERMISSION);
}

// Who may see a partner's cut. The rates ARE the clinic's margin on a service
// (a 60% profit share says what the other 40% is), so they follow the same rule
// as item cost: named in one place, stripped server-side, Admin only. Reusing
// partners:read rather than minting a permission keeps it the same answer as
// "may this person open the Partners module".
export const PARTNER_DEAL_PERMISSION = "partners:read";

export function canSeePartnerDeal(
  user: PermissionHolder | null | undefined,
): boolean {
  return hasPermission(user, PARTNER_DEAL_PERMISSION);
}

// Who may see what the clinic owes its suppliers: balances, the statement, what
// has been paid and credited. Deliberately NOT orders:read, so someone can be
// given purchasing (receive a delivery, correct what it cost) without being
// handed the accounts payable picture that sits behind it.
export const PAYABLES_PERMISSION = "payables:read";

export function canSeePayables(
  user: PermissionHolder | null | undefined,
): boolean {
  return hasPermission(user, PAYABLES_PERMISSION);
}

export function hasAnyPermission(
  user: PermissionHolder | null | undefined,
  permissions: string[],
): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

// Module navigation — each entry requires its `read` permission to be visible
// and to access the page/API under its path prefix.
export interface NavModule {
  href: string;
  label: string;
  icon: string; // MUI icon name, resolved in the nav component
  permission: string;
}

export const NAV_MODULES: NavModule[] = [
  {
    href: "/patients",
    label: "Patients",
    icon: "Pets",
    permission: "patients:read",
  },
  {
    href: "/bookings",
    label: "Bookings",
    icon: "Event",
    permission: "bookings:read",
  },
  {
    href: "/inventory",
    label: "Inventory",
    icon: "Inventory2",
    permission: "inventory:read",
  },
  {
    href: "/orders",
    label: "Orders",
    icon: "ShoppingCart",
    permission: "orders:read",
  },
  {
    href: "/suppliers",
    label: "Suppliers",
    icon: "LocalShipping",
    permission: "orders:read",
  },
  {
    href: "/invoices",
    label: "Invoices",
    icon: "Receipt",
    permission: "invoices:read",
  },
  {
    href: "/notifications",
    label: "Reminders",
    icon: "Notifications",
    permission: "notifications:read",
  },
  {
    href: "/services",
    label: "Services",
    icon: "MedicalServices",
    permission: "invoices:read",
  },
  {
    // Its own permission rather than notifications:read, so the website contact
    // form can be switched off per deployment independently of reminders.
    href: "/messages",
    label: "Web Contact Form",
    icon: "Email",
    permission: "messages:read",
  },
  { href: "/users", label: "Staff", icon: "Group", permission: "users:read" },
  {
    href: "/running-costs",
    label: "Running costs",
    icon: "Payments",
    permission: "costs:read",
  },
  {
    href: "/partners",
    label: "Partners",
    icon: "Handshake",
    permission: "partners:read",
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: "Insights",
    permission: "analytics:read",
  },
  {
    href: "/audit",
    label: "Audit log",
    icon: "History",
    permission: "audit:read",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "Settings",
    permission: "users:write",
  },
];

// Maps a request path prefix to the permission required to access it.
// Covers both the dashboard pages and their matching /api/* routes.
const ROUTE_RULES: { prefix: string; permission: string }[] = [
  { prefix: "/analytics", permission: "analytics:read" },
  { prefix: "/api/analytics", permission: "analytics:read" },
  { prefix: "/running-costs", permission: "costs:read" },
  { prefix: "/api/running-costs", permission: "costs:read" },
  { prefix: "/partners", permission: "partners:read" },
  { prefix: "/api/partners", permission: "partners:read" },
  // Purchasing sits behind its own permission, not inventory:read, so clinical
  // staff never see purchase costs.
  { prefix: "/suppliers", permission: "orders:read" },
  { prefix: "/api/suppliers", permission: "orders:read" },
  // Accounts payable rather than purchasing, so it has its own gate. MUST stay
  // above /orders: requiredPermissionForPath() returns the first prefix that
  // matches, and /orders would otherwise swallow it.
  { prefix: "/orders/statement", permission: "payables:read" },
  { prefix: "/orders", permission: "orders:read" },
  { prefix: "/api/orders", permission: "orders:read" },
  { prefix: "/patients", permission: "patients:read" },
  // Clients are part of the Patients module, gated by the same permission.
  { prefix: "/clients", permission: "patients:read" },
  { prefix: "/api/clients", permission: "patients:read" },
  { prefix: "/bookings", permission: "bookings:read" },
  { prefix: "/inventory", permission: "inventory:read" },
  { prefix: "/invoices", permission: "invoices:read" },
  // Services are the billable catalog behind invoicing, gated the same way.
  { prefix: "/services", permission: "invoices:read" },
  { prefix: "/notifications", permission: "notifications:read" },
  // Website contact messages have their own permission so the module can be
  // gated per deployment. The proxy checks these rules before any handler runs,
  // which is what makes the page and its API unreachable when the flag is off.
  { prefix: "/messages", permission: "messages:read" },
  { prefix: "/api/messages", permission: "messages:read" },
  // Clinic settings (the exchange rate) are administrative, so they ride on
  // the same permission as user management rather than adding a new one.
  { prefix: "/settings", permission: "users:write" },
  { prefix: "/api/settings", permission: "users:write" },
  { prefix: "/users", permission: "users:read" },
  { prefix: "/api/users", permission: "users:read" },
  { prefix: "/audit", permission: "audit:read" },
  { prefix: "/api/audit", permission: "audit:read" },
  { prefix: "/api/patients", permission: "patients:read" },
  { prefix: "/api/bookings", permission: "bookings:read" },
  { prefix: "/api/inventory", permission: "inventory:read" },
  { prefix: "/api/invoices", permission: "invoices:read" },
  { prefix: "/api/services", permission: "invoices:read" },
  // Offers are a discount decision, so they ride on the invoicing permissions
  // rather than minting their own. Reading the catalogue follows invoices:read;
  // granting and redeeming are checked in the handlers.
  { prefix: "/api/offers", permission: "invoices:read" },
  { prefix: "/api/notifications", permission: "notifications:read" },
];

// Returns the permission required for a path, or null if the path is not gated.
export function requiredPermissionForPath(pathname: string): string | null {
  const rule = ROUTE_RULES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  return rule ? rule.permission : null;
}

// First module the user is allowed to see — used as a post-login landing page.
export function firstAllowedHref(
  user: PermissionHolder | null | undefined,
): string | null {
  const mod = NAV_MODULES.find((m) => hasPermission(user, m.permission));
  return mod ? mod.href : null;
}
