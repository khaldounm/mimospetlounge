<!-- GEMINI.md -->

---

name: File placement conventions
description: Where new code must live — enforced by the user
type: feedback

---

All code must go in these directories, no exceptions:

- `@/constants` — static constants and config values
- `@/types` — TypeScript types and interfaces
- `@/hooks` — React hooks and client-side business logic
- `@/lib` — server-side helper functions
- `@/utils` — helper functions
- `@/components/layout` — page-level layout sections
- `@/components/ui` — reusable UI components

**Why:** The user explicitly set this up and expects it to be followed without being reminded.

**How to apply:** Before creating any new file, pick the correct directory from this list. Never create files outside these paths (plus `app/` for routes/pages and `schemas/` for zod schemas, `prisma/` for DB schema). Do not drop files in the root.

---

name: Code review pattern
description: How the user wants code reviews structured — tech-lead persona, six axes, scored issues
type: feedback

---

When the user asks for a code review, act as a super-duper smart tech lead and evaluate across these six axes:

- Performance
- Security
- Optimisation
- Simplicity
- Maintainability
- Reusability

At the end, list the issues found and score each from 0 to 10.

**Why:** User wants consistent, high-signal reviews framed by an experienced tech-lead lens, with quantified severity so they can triage fast.

**How to apply:** Use this format whenever the user says "review", "code review", or asks for an assessment of a file/PR/change. Walk through each axis, surface concrete issues (not generic advice), then end with an overall score for each area.

---

name: Never use em dash character
description: User dislikes the em dash (—). Never use it in code, copy, comments, or chat output.
type: feedback

---

Never use the em dash character `—` (U+2014). This applies to:

- Code (string literals, JSX text)
- Copy in constants/content files
- Comments
- Commit messages
- Chat responses to the user
- Anywhere else

**Why:** Direct user instruction in 2026-04 audit pass: "remove this character — never use it again."

**How to apply:** Use commas, periods, colons, parentheses, or hyphens (`-`) instead. When rephrasing, prefer the punctuation that fits the clause relationship:

- Aside / parenthetical → commas or parens: `X, which is Y,` or `X (Y)`
- Sharp break / amplification → period or colon: `X. Y` or `X: Y`
- Range / compound modifier → hyphen: `2015-2020`, `world-class`

The en dash (`–`, U+2013) is also off the table by extension — same character family, same vibe the user is rejecting.

---

name: Use the graphify knowledge graph first
description: A code graph of this repo lives in graphify-out/; query it before grepping or reading files
type: feedback

---

This repo has a graphify knowledge graph at `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`): every file, symbol and call edge, clustered into communities.

- At the start of a session, run `graphify update .` so the graph matches the latest commit. It is AST-only: no LLM, no cost, a few seconds.
- For any codebase question, run `graphify query "<question>"` first. Use `graphify path "<A>" "<B>"` for how two things connect and `graphify explain "<concept>"` for one concept.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture reviews, or when query/path/explain do not surface enough.
- After modifying code, run `graphify update .` again.
- If `graphify-out/` is missing (it is gitignored), build it with `/graphify .`.

**Why:** The user asked on 2026-09-27 for the graph to be used by default, instead of re-exploring the codebase file by file every session.

**How to apply:** The graph is the map, the source files are the territory. Query first, then open only the files the graph names, and cite its `source_location` when saying where something lives.
