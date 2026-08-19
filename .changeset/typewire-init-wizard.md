---
"@tahanabavi/typewire-cli": minor
---

`typewire init` reads the project and wires it up.

It detects framework, language, package manager, `src/`, monorepo and which
`@tahanabavi/*` packages are already installed, then asks one question — what
does this project need? — with the answers preselected from what it found.
Everything detected is a default, shown and overridable, never a silent
decision. Options that cannot apply are not offered: no devtools panel in an
Express project, no NestJS adapter outside NestJS.

It then scaffolds a `typewire/` folder wired for the selection (client,
contracts, query cache, React provider, devtools bridge, permissions, socket),
prints the install command for the detected package manager, and lists the next
steps. Existing files are skipped unless `--force`.

The framework changes what is generated, not only where it goes:

- Next.js gets `"use client"` on the provider and the devtools panel, without
  which the App Router fails at build time.
- Env access follows the framework — `process.env.NEXT_PUBLIC_API_URL`,
  `import.meta.env.VITE_API_URL`, or `process.env.API_BASE_URL`.
- A project without TypeScript gets `.js`/`.mjs` files with no `as const`.

New flags: `--yes`, `--features <a,b>`, `--dry-run`, `--contracts-path`,
`--output`, `--force`. Without a TTY it takes the defaults and prints what it
chose rather than blocking on a prompt nobody can answer. An unknown
`--features` value is an error, not a silent no-op.

**`release-doc` now works.** It had been listed in `--help` since 1.6.0 with no
`case` in the command switch, so it fell through and silently ran the contract
test suite instead. It scaffolds `docs/releases/<version>.md`, accepts the
version as a positional or `--version`, and refuses to overwrite an existing
note without `--force`.

**Output respects `NO_COLOR`, `CI` and non-TTY stdout.** ANSI escapes in a piped
report or a CI log break `grep`.

**Bad usage exits `2`, not `1`.** Exit `1` is reserved for findings — the code a
CI gate is allowed to expect — so "you called this wrong" stays distinguishable
from "your tests failed".

`--package` is removed from `init`; the wizard knows the package names.
