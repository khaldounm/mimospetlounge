// Entry point for the legacy migration.
//
//   npx tsx src/lib/legacy-import/run.ts --mdb <path> [--work <dir>] [--stage-only]
//
// Re-runnable by design: staging is rebuilt each run and the transform upserts
// on legacyId, so the cutover import is this same command against a fresh backup.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAll } from "./extract";
import { loadStaging } from "./staging";
import { prisma } from "@/lib/prisma";
import { assertClinicDatabase } from "@/lib/clinic-guard";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const mdb = arg("--mdb");
  if (!mdb) throw new Error("--mdb <path to GT_Data*.mdb> is required");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  // The .mdb is Mimo's old system: refuses any other clinic's database before
  // a single staging table is written.
  await assertClinicDatabase(prisma, { expected: "mimo" });

  // Defaults to an OS temp dir, never the repo: this data is real client PII.
  const workDir =
    arg("--work") ?? mkdtempSync(join(tmpdir(), "legacy-import-"));

  console.log(`source   ${mdb}`);
  console.log(`work dir ${workDir}\n`);

  const extracts = extractAll(mdb, workDir);
  for (const e of extracts)
    console.log(`  extracted ${e.table.padEnd(20)} ~${e.rows}`);

  console.log("");
  const loaded = loadStaging(databaseUrl, extracts);
  for (const l of loaded)
    console.log(`  staged    ${l.table.padEnd(20)} ${l.loaded}`);

  if (process.argv.includes("--stage-only")) {
    console.log("\n--stage-only: stopping before the transform.");
    return;
  }
  const { transform } = await import("./transform");
  await transform();
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
