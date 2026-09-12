import { prisma } from "@/lib/prisma";
import { DEFAULT_FX_USD_LBP } from "@/constants/clinic";

// Keys used by the app. Kept here so a typo is a compile error rather than a
// silently missing setting.
export const SETTING_KEYS = {
  fxUsdLbp: "fx.usd_lbp",
  // Which clinic this database belongs to. Read only by the scripts that can
  // destroy data (seeds, legacy import); see @/lib/clinic-guard.
  clinicId: "clinic.id",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  updatedBy: number | null,
): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, updatedBy },
    update: { value, updatedBy },
  });
}

// LBP per 1 USD. Falls back to the seeded default rather than throwing: a
// missing or corrupted row must not take the till down mid-sale, and a stale
// rate is visible on screen where a crash is not.
export async function getFxRate(): Promise<number> {
  const raw = await getSetting(SETTING_KEYS.fxUsdLbp);
  const parsed = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FX_USD_LBP;
  return parsed;
}
