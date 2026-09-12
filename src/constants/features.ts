// Which product modules this deployment exposes.
//
// The list belongs to the clinic profile (see @/constants/clinics): one
// codebase serves several clinics and each switches on a different set. No
// module code is deleted and the permission catalogue in prisma/rbac.ts stays
// complete, so a module can be switched on for a clinic later without
// restoring code. Anything missing from a clinic's list is denied.
//
// The gate is applied in one place: hasPermission() in src/lib/permissions.ts.
// requirePermission() in src/lib/api.ts delegates to hasPermission(), and both
// the proxy.ts route gating and DashboardShell's nav filtering flow through it,
// so clipping there covers nav, pages and every API route at once.
import { CLINIC } from "@/constants/clinic";

// Optional override for demos: FEATURES="patients,invoices,analytics".
//
// A set value REPLACES the clinic's list wholesale rather than adding to it,
// so a stale or partial value can never silently widen access beyond what it
// names. Unset, empty, or all-whitespace falls back to the profile, never to
// all-on. Read once at module load, so changing it needs a server restart.
function resolveEnabledModules(): ReadonlySet<string> {
  const raw = process.env.FEATURES;
  if (raw) {
    const parsed = raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (parsed.length > 0) return new Set(parsed);
  }
  return new Set<string>(CLINIC.modules.map((m) => m.toLowerCase()));
}

const enabledModules = resolveEnabledModules();

// "invoices:write" -> "invoices". A permission with no colon is its own module.
export function moduleOf(permission: string): string {
  const separator = permission.indexOf(":");
  const name = separator === -1 ? permission : permission.slice(0, separator);
  return name.toLowerCase();
}

export function isModuleEnabled(module: string): boolean {
  return enabledModules.has(module.toLowerCase());
}

export function isPermissionEnabled(permission: string): boolean {
  return isModuleEnabled(moduleOf(permission));
}
