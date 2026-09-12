// Backup and restore for moving the local database to a remote test instance,
// so the clinic can review the migrated data.
//
// Typical run, with the local DATABASE_URL active in .env:
//
//   npm run db:backup                 # dump local -> scratch file
//   (swap the commented DATABASE_URL / DIRECT_URL lines in .env)
//   npm run db:restore -- --yes       # load the newest dump into that target
//
// Restore targets whatever .env points at, so the swap is the switch. It uses
// the newest dump on disk rather than taking a fresh one, because by that point
// .env is aimed at the remote and a fresh dump would come from the wrong end.
//
// The dump contains real client PII (names, phone numbers, payment history), so
// it is written outside the repository and never committed.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CLINIC } from "@/constants/clinic";

// Dumps live in the repo for convenience, but they hold real client PII, so
// the directory must be git-ignored. assertIgnored() checks that on every run
// rather than trusting .gitignore to have stayed correct.
const DEFAULT_DIR = join(process.cwd(), "dumps");

/**
 * Refuses to write a dump anywhere git would track it.
 *
 * A dump of this database is 1,874 client names, 2,692 phone numbers and the
 * full payment history. Committing one would put that in the repo permanently
 * and in every clone, so this fails closed: if the check cannot be made, it
 * stops rather than assuming the path is safe.
 */
function assertIgnored(dir: string) {
  const probe = join(dir, ".probe.dump");
  try {
    execFileSync("git", ["check-ignore", "--quiet", probe], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `Refusing to write dumps to ${dir}: git does not ignore it.\n` +
        'Add "dumps/" and "*.dump" to .gitignore, or pass --out <dir> ' +
        "pointing somewhere outside the repository.",
    );
  }
}

/** Hide the password when a connection string has to be shown. */
export function redact(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");
}

/**
 * A password containing "@" splits the connection string in the wrong place.
 *
 * This has to be checked by hand because the two parsers disagree: JavaScript's
 * URL splits the authority on the LAST "@" and sees a valid host, while libpq
 * (psql, pg_dump) splits on the FIRST one. So Node reports a sensible hostname
 * while pg_dump fails on a host nobody recognises. Checking it libpq's way
 * turns that into an error that says what to fix.
 */
function assertParsable(url: string, label: string) {
  const after = url.split("://")[1];
  if (!after) throw new Error(`${label} is not a valid connection string.`);
  const firstAt = after.indexOf("@");
  if (firstAt === -1) return;
  const hostAsLibpqSeesIt = after.slice(firstAt + 1);
  if (hostAsLibpqSeesIt.includes("@")) {
    throw new Error(
      `${label} has an unencoded "@" in its password.\n` +
        `Postgres tools read the host as "${hostAsLibpqSeesIt.split("/")[0]}".\n` +
        "Percent-encode it: @ becomes %40, : becomes %3A, / becomes %2F.",
    );
  }
}

function describe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable connection string)";
  }
}

const isLocal = (url: string) =>
  /^(localhost|127\.0\.0\.1|::1)$/.test(new URL(url).hostname);

export function backup(sourceUrl: string, outDir = DEFAULT_DIR): string {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  assertIgnored(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(outDir, `${CLINIC.backupPrefix}-${stamp}.dump`);

  // Custom format: compressed, and restorable with --clean so a repeat restore
  // does not need the target wiped by hand first. Only the app's own schema is
  // dumped; `staging` is scratch space for the .mdb import and is not wanted on
  // a remote box holding PII it does not need.
  run(
    "pg_dump",
    [
      sourceUrl,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      `--file=${file}`,
    ],
    "pg_dump",
    true,
  );
  return file;
}

// Dumped with --schema=public, which leaves out extension creation, so the
// target needs them recreated. Without citext the restore dies on clients.email.
const REQUIRED_EXTENSIONS = ["citext", "btree_gist"];

// Tables kept from the target rather than overwritten by the dump, so the
// people testing on the remote keep their logins, roles and history.
//
// Listed in dependency order: permissions and roles before users, users before
// anything pointing at them. pg_restore restores in the archive's own order,
// which is not dependency order, so each is loaded separately.
//
// Services are deliberately NOT here. 2,845 invoice lines reference 25 services
// and every one of them is created by the .mdb import, so preserving the
// target's copy would leave those lines pointing at ids that may not exist.
const PRESERVED_TABLES = [
  "permissions",
  "roles",
  "users",
  "role_permissions",
  "audit_log",
] as const;

// Every child process here is passed a connection string. Node puts the full
// command line into the Error it throws, so any failure would print the
// password. Each call is wrapped to swallow that and raise a clean message.
function run(cmd: string, args: string[], label: string, inherit = false) {
  try {
    execFileSync(cmd, args, {
      stdio: ["ignore", inherit ? "inherit" : "ignore", "inherit"],
    });
  } catch {
    throw new Error(`${label} failed. See the output above.`);
  }
}

function psql(targetUrl: string, sql: string) {
  run("psql", [targetUrl, "-v", "ON_ERROR_STOP=1", "-tAc", sql], "psql");
}

/** Reads a single value, used to inspect the target before touching it. */
function psqlValue(targetUrl: string, sql: string): string {
  try {
    return execFileSync("psql", [targetUrl, "-tAc", sql], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error("Could not query the target database.");
  }
}

/**
 * Replaces the target's public schema with the contents of the dump.
 *
 * The schema is dropped and rebuilt explicitly rather than relying on
 * `pg_restore --clean`: that emits `DROP SCHEMA public`, which fails whenever an
 * extension (here btree_gist) is installed into it. Doing it in this order also
 * guarantees the extensions exist before any table that depends on their types.
 */
export function restore(dumpFile: string, targetUrl: string, preserve = true) {
  if (!existsSync(dumpFile)) throw new Error(`Dump not found: ${dumpFile}`);

  // Copy the target's own accounts and audit history aside first. This also
  // doubles as a safety net: the schema is dropped a few lines below, and that
  // drop is not part of the restore's transaction.
  // A target being restored into for the first time has none of these tables
  // yet, so there is nothing to keep and pg_dump would fail on the empty match.
  const existing = Number(
    psqlValue(
      targetUrl,
      `SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (${PRESERVED_TABLES.map((t) => `'${t}'`).join(",")})`,
    ),
  );
  if (preserve && existing === 0) {
    console.log("  target is empty, so there is nothing to preserve.");
  }

  let keptFile: string | null = null;
  if (preserve && existing > 0) {
    keptFile = `${dumpFile}.kept`;
    run(
      "pg_dump",
      [
        targetUrl,
        "--format=custom",
        "--data-only",
        "--no-owner",
        "--no-privileges",
        ...PRESERVED_TABLES.map((t) => `--table=public.${t}`),
        `--file=${keptFile}`,
      ],
      "pg_dump of the target's users and roles",
    );
  }

  psql(
    targetUrl,
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  // A managed host (Supabase) grants the public schema to its own roles by
  // default, and recreating the schema drops those grants. Put them back where
  // the roles exist, and stay quiet where they do not.
  psql(
    targetUrl,
    `DO $$
     DECLARE r text;
     BEGIN
       FOREACH r IN ARRAY ARRAY['postgres','anon','authenticated','service_role']
       LOOP
         IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
           EXECUTE format('GRANT ALL ON SCHEMA public TO %I', r);
         END IF;
       END LOOP;
     END $$;`,
  );
  for (const ext of REQUIRED_EXTENSIONS) {
    try {
      psql(targetUrl, `CREATE EXTENSION IF NOT EXISTS ${ext}`);
    } catch {
      throw new Error(
        `Could not create the "${ext}" extension on the target. A managed host ` +
          "may require enabling it from its dashboard first.",
      );
    }
  }

  // The dump also contains "CREATE SCHEMA public", which would collide with the
  // schema just recreated above. Rather than tolerate a partial restore, the
  // archive's table of contents is filtered to drop that one entry, so the
  // whole thing can still run inside a single transaction.
  const toc = execFileSync("pg_restore", ["--list", dumpFile], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const filtered = toc
    .split("\n")
    .filter((line) => !/\bSCHEMA - public\b/.test(line))
    .join("\n");
  const listFile = `${dumpFile}.toc`;
  writeFileSync(listFile, filtered, { mode: 0o600 });

  run(
    "pg_restore",
    [
      "--dbname",
      targetUrl,
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--use-list",
      listFile,
      dumpFile,
    ],
    "pg_restore",
    true,
  );

  if (keptFile) {
    // The dump has just overwritten these with the local copies. Clear them and
    // put the target's own back, one table at a time so foreign keys resolve in
    // the right order.
    for (const t of [...PRESERVED_TABLES].reverse()) {
      psql(targetUrl, `DELETE FROM "${t}"`);
    }
    for (const t of PRESERVED_TABLES) {
      run(
        "pg_restore",
        [
          "--dbname",
          targetUrl,
          "--data-only",
          "--no-owner",
          "--no-privileges",
          `--table=${t}`,
          keptFile,
        ],
        `pg_restore of ${t}`,
      );
    }
    // Sequences now trail the restored rows, so the next insert would collide.
    //
    // This has to be done in plpgsql rather than a single SELECT. The obvious
    // version filters information_schema by table_schema and calls
    // pg_get_serial_sequence in the same query, but Postgres may evaluate the
    // function before the filter. On a managed host that also has auth.users
    // (Supabase), it then asks for a column of auth.users against public.users
    // and dies with "column instance_id of relation users does not exist".
    // Resolving the sequence per table, inside a loop, removes the ordering
    // question entirely.
    psql(
      targetUrl,
      `DO $$
       DECLARE t text; col text; seq text; mx bigint;
       BEGIN
         FOREACH t IN ARRAY ARRAY[${PRESERVED_TABLES.map((x) => `'${x}'`).join(",")}]
         LOOP
           SELECT a.attname INTO col
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           WHERE c.relname = t
             AND c.relnamespace = 'public'::regnamespace
             AND a.attnum > 0
             AND pg_get_serial_sequence('public.' || t, a.attname) IS NOT NULL
           LIMIT 1;

           IF col IS NOT NULL THEN
             seq := pg_get_serial_sequence('public.' || t, col);
             EXECUTE format('SELECT COALESCE(max(%I), 0) FROM public.%I', col, t)
               INTO mx;
             PERFORM setval(seq, GREATEST(mx, 1), mx > 0);
           END IF;
           col := NULL;
         END LOOP;
       END $$;`,
    );
  }
}

/** Newest dump on disk, so a restore never re-dumps from the wrong database. */
function newestDump(dir = DEFAULT_DIR): string {
  const dumps = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".dump"))
        .sort()
    : [];
  const latest = dumps.at(-1);
  if (!latest) {
    throw new Error(
      `No dump found in ${dir}. Run "npm run db:backup" first, with the ` +
        "local DATABASE_URL active in .env.",
    );
  }
  return join(dir, latest);
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const mode = process.argv.includes("--restore") ? "restore" : "backup";
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is not set");
  assertParsable(source, "DATABASE_URL");
  if (process.env.DIRECT_URL)
    assertParsable(process.env.DIRECT_URL, "DIRECT_URL");

  if (mode === "backup") {
    console.log(`dumping  ${describe(source)}`);
    const file = backup(source, arg("--out"));
    const mb = (statSync(file).size / 1024 / 1024).toFixed(1);
    console.log(`\nwrote    ${file}  (${mb} MB)`);
    console.log("\nThis file contains real client data. Keep it off the repo");
    console.log("and delete it once the remote copy is confirmed.");
    console.log(
      "\nnext:  swap the DATABASE_URL / DIRECT_URL lines in .env, then\n" +
        "       npm run db:restore -- --yes",
    );
    return;
  }

  // The working pattern here is to comment/uncomment DATABASE_URL in .env, so
  // the target is simply whatever .env currently points at. DIRECT_URL wins when
  // present: a managed host's pooled port cannot run a restore (see below).
  const target =
    process.env.TEST_DATABASE_URL ??
    arg("--to") ??
    process.env.DIRECT_URL ??
    source;
  const file = arg("--file") ?? newestDump();

  // .env carries a commented remote pair and an active local pair, so it is easy
  // to uncomment one line and not its partner. Since the target is taken from
  // DIRECT_URL, that mistake would silently point a "remote" restore at the
  // local database and wipe it. Refuse when the two disagree.
  const direct = process.env.DIRECT_URL;
  if (
    !process.env.TEST_DATABASE_URL &&
    !arg("--to") &&
    direct &&
    source &&
    new URL(direct).hostname !== new URL(source).hostname
  ) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL point at different hosts:\n" +
        `  DATABASE_URL -> ${new URL(source).hostname}\n` +
        `  DIRECT_URL   -> ${new URL(direct).hostname}\n\n` +
        "Both lines need swapping together in .env. Restore uses DIRECT_URL, so " +
        "continuing could target the wrong database.",
    );
  }

  // Restoring through a transaction-mode pooler (Supabase's 6543) fails: it
  // multiplexes connections, which breaks the single transaction and the
  // session state pg_restore relies on. The direct port is the one to use.
  if (new URL(target).port === "6543") {
    throw new Error(
      "That target is the pooled port (6543), which cannot run a restore.\n" +
        "Use the direct connection (port 5432) via DIRECT_URL.",
    );
  }

  console.log(`restoring ${file}`);
  console.log(`      to  ${describe(target)}`);
  if (!process.argv.includes("--replace-everything")) {
    console.log(`      keeping ${PRESERVED_TABLES.join(", ")} from the target`);
  }
  if (isLocal(target)) {
    console.log(
      "\nNOTE: that target is LOCAL. If you meant the remote test database,\n" +
        "swap the commented DATABASE_URL / DIRECT_URL lines in .env first.",
    );
  }
  if (!process.argv.includes("--yes")) {
    console.error(
      "\nThis DROPS the public schema on that database and replaces it with the\n" +
        "dump. Everything currently in it is lost. Re-run with --yes to confirm.",
    );
    process.exit(1);
  }
  const preserve = !process.argv.includes("--replace-everything");
  restore(file, target, preserve);
  console.log(
    preserve
      ? `\nrestore complete. Kept the target's own ${PRESERVED_TABLES.join(", ")}.`
      : "\nrestore complete. Everything on the target was replaced.",
  );
}

if (process.argv[1]?.includes("db-transfer")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
