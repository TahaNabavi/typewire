# Working in this repo

TypeWire is a pnpm-workspaces monorepo of contract-first packages under the
`@tahanabavi/*` scope. Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
before changing anything structural — the three design laws there are binding.

## Layout

```txt
packages/*      published packages (typefetch, typesocket, nestjs, …)
examples/*      runnable demos — private, never published
docs/           monorepo-level docs (architecture, shared assets)
.changeset/     pending release notes
```

Both `packages/*` and `examples/*` are workspace globs, so **everything in
either runs under `pnpm -r`**. An example without a `typecheck` script is an
example that can silently rot.

## Definition of done for a package change

Every one of these, every time:

1. **Code** — matches the surrounding style. Comments explain *why*, not what.
2. **Tests** — a regression test per fixed bug, named after the old behaviour so
   the reason it exists survives the fix.
3. **`README.md`** in the package — updated, including a migration table when
   anything breaks.
4. **`docs/releases/vX.Y.Z.md`** in the package — see below. Required for every
   minor and major; optional for a patch.
5. **`docs/assets/<pkg>-vX.Y.Z-banner.html`** + rendered `.png` — required for
   every **major** and for a minor that adds a headline feature.
6. **Changeset** — `pnpm changeset`, with the correct bump. CI reports its absence.
7. **Verify** — `pnpm -r build && pnpm -r typecheck && pnpm -r test` all green.
   Never report a change as done without running these.

### Per-package docs layout

Mirror `packages/typefetch/` exactly:

```txt
packages/<name>/
  README.md                                   the daily reference
  docs/
    releases/
      v1.7.0.md                               one file per released version
    assets/
      <name>-v1.7.0-banner.html               1600x850 source
      <name>-v1.7.0-banner.png                rendered, committed
```

**Release docs** are narrative, not a changelog dump: what the release adds, why
it exists, the semantics of each new field, an API-additions table, and an
explicit backward-compatibility section. For a major, add a migration table
mapping every old call site to the new one, and a "behaviour changes to plan
for" list — a silent behaviour change is worse than a compile error.

**Banners** are authored at 1600×850 and rendered at **2×** (3200×1700). Copy
the newest existing banner as the template and change the content, not the
design system — the family should look like one family.

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless --disable-gpu --no-sandbox --force-device-scale-factor=2 \
  --window-size=1600,850 --hide-scrollbars \
  --screenshot="<ABSOLUTE>\out.png" "file:///<ABSOLUTE>/in.html"
```

Both paths must be **absolute** — headless Chrome resolves relative output
paths against its own working directory and fails with "Access is denied".
Commit the `.html` and the `.png`, then open the PNG to confirm it rendered
before calling it done.

## Conventions

- **Contracts are untouched.** Cache, devtools and query concerns never add
  parameters to a transport contract. New capability goes to the setup site as
  an independent optional key.
- **The `"module.endpoint"` id is the cross-package key.** typefetch calls it
  `endpointId`, typesocket calls it `eventId`; both mean the same thing and must
  stay format-compatible, because query-core and devtools key on them.
- **`instrument({ on, resolveOverride })` is the one extension seam.** It is
  additive and zero-cost when unused. Higher layers subscribe; they never fork
  the transport pipeline.
- **Peer dependencies for `zod`.** Schemas only compare correctly when every
  package resolves one `zod` instance. Never make it a regular dependency.
- **`strict: true`** in every package tsconfig, plus `noUncheckedIndexedAccess`.

## Commands

```bash
pnpm install
pnpm -r build           # topological — dependents build against fresh types
pnpm -r typecheck
pnpm -r test
pnpm changeset          # record the release note
pnpm --filter <name> <script>
```

## Things that are not done

Do not commit, push, or publish unless asked. Do not add a dependency to a
published package without saying so explicitly — every one is a cost the
package's consumers pay.
