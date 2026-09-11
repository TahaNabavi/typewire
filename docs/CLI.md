# TypeWire — CLI & config (design)

**Status:** design doc; steps 1–2 of §5 are built, the rest is still proposal.
Companion to [`TRANSPORTS.md`](../packages/typefetch/docs/TRANSPORTS.md).
The build order in §5 is the source of truth for what exists.

The CLI exists today inside `@tahanabavi/typefetch` with six commands (`test`,
`list`, `init`, `release-doc`, `help`, `version`) and a `typefetch.test.config.ts`
file. This is the plan for splitting it out, generalising the config, and growing
the command surface into the thing that actually makes contracts pay for
themselves.

---

## 1. Yes — the CLI becomes its own package, and it is a **TypeWire** CLI

Same rule as adapters: **anything that needs a dependency ships separately.**

```txt
@tahanabavi/typefetch      runtime. zero deps. no bin.
@tahanabavi/typewire-cli   devDependency. bin: `typewire`. deps allowed.
```

**Not `typefetch-cli`.** The config file is `typewire.config.ts` — one file for
the whole family — so the tool that reads it has to be a TypeWire tool. A
`typefetch` binary that also reads typesocket event contracts and permission flag
maps is lying about its scope, and splitting into one CLI per package would mean
three binaries, three configs and three copies of the loader.

The commands are namespaced by what they operate on, not by which package
implements them:

```bash
typewire lint                  # every contract in the config
typewire lint --scope typefetch
typewire diff --fail-on breaking
typewire doctor
```

That also means the growth path is free: typesocket event contracts and
`type-permission` flag maps get linted and diffed by the same commands, against
the same baseline, in the same CI step — which is only possible because every
package already keys on the same `"module.member"` id.

The precedent is well established and well understood by the teams we want:
`prisma` / `@prisma/client`, `drizzle-kit` / `drizzle-orm`, `@tailwindcss/cli` /
`tailwindcss`. Nobody ships a build tool in a runtime bundle.

### What it costs, honestly

Two packages can drift. A CLI expecting the v2 contract shape pointed at a v1.9
runtime must fail with a clear message, not a stack trace — so the CLI reads the
installed core's version and refuses mismatches up front. This is the known
annoyance of the Prisma split, and the only mitigation is to check loudly.

Existing users lose `npx typefetch` on a fresh install of the runtime alone.
That is a breaking change, and it is exactly what the migration codemod exists
to announce and fix.

### Free win available today

`jiti` sits in `dependencies`, but `load-config.ts` already imports it
dynamically inside a `try/catch` that prints _"Install jiti to use .ts config
files"_. **The code already treats it as optional.** Moving it to
`optionalDependencies` costs nothing and removes a third of the core's dependency
list before any of this work starts.

---

## 2. The config file

### The name is wrong today, twice over

`typefetch.test.config.ts` is scoped to one command _and_ to one package. Once
the CLI lints, diffs, generates and mocks, the config is not about testing — and
once typesocket and permission contracts are covered, it is not about typefetch
either.

```txt
typewire.config.ts         ← new, preferred
typewire.config.mts|js|mjs|cjs
typefetch.test.config.*    ← still loaded, warns, codemod rewrites it
```

Discovery walks up from `cwd` (monorepo packages inherit the root config),
`--config` overrides, first match wins.

### One file, one section per package

Sections are keyed by package so each one owns its own shape and nothing has to
be renamed when a package is added. A project that only uses typefetch writes
only that section.

```ts
// typewire.config.ts
import { defineConfig } from '@tahanabavi/typewire-cli'
import { contracts } from './src/contracts'
import { events } from './src/events'

export default defineConfig({
  // shared by every section
  lint: { rules: { 'path-params-declared': 'error' } },
  diff: { baseline: 'typewire.lock.json', failOn: 'breaking' },

  typefetch: {
    contracts,
    createClient: ({ baseUrl, token }) => makeClient(baseUrl, token),
    generate: { openapi: { out: './openapi.json' } },
    mock: { port: 4000, seed: 42 },
    test: {/* today's options/context/report */},
  },

  typesocket: { events },
  permission: { flags: './src/permissions.ts' },
})
```

Top-level keys are the cross-cutting ones; a section may override them. The
lockfile is `typewire.lock.json` for the same reason — one API-surface snapshot
covering every transport a project exposes, so a PR that changes an HTTP response
and a WebSocket payload shows both in one reviewable diff.

### Several API surfaces per repo

A repo commonly exposes more than one API — `dashboard`, `admin`, `landing` —
with different base URLs, different middleware and different auth. Sections are
keyed by _package_, which does not answer that: there is one `typefetch`
section, not three.

So a top-level `projects` block, each entry a full config body:

```ts
export default defineConfig({
  lint: { rules: { 'path-params-declared': 'error' } }, // shared default

  projects: {
    dashboard: {
      typefetch: { contracts, createClient: createDashboardClient },
    },
    admin: {
      typefetch: { contracts: adminContracts, createClient: createAdminClient },
      diff: { baseline: 'admin.lock.json' },
    },
  },
})
```

The shape is Playwright's `projects` and Vitest's workspace, for the same
reason both landed on it: the alternative is one config file per surface, one
`--config` flag per script, and CI steps that drift apart silently.

Three rules make it safe rather than merely possible:

1. **Every project runs by default**, and any failure fails the command. A gate
   that checked one of three surfaces and reported green is worse than no gate.
2. **Reports are written per project.** One shared output path means the last
   project overwrites the rest, and the report looks complete while describing
   a single API.
3. **A command needing exactly one project refuses to guess.** With several
   declared and no `--project`, the error names them.

Single-API configs omit the key entirely and resolve to one _implicit_ project,
so no command branches on which shape was written — the single case is a
length-1 instance of the multi case, not a separate path.

Per-project lockfiles fall out of this: `diff` compares each surface against its
own baseline, which is what makes a PR touching only the admin API show a diff
for only the admin API.

### The shape is wrong today, and this one matters more

`loadCliConfig` currently **requires `client` or `createClient`** — every command
must boot a live API client. But `lint`, `diff`, `generate` and `explain` only
need the contracts. Requiring a client to lint a contract file is the difference
between a check that runs on every commit and one that never gets wired up.

So: `contracts` is the only always-required key of the `typefetch` section.
`client`/`createClient` become required _by the commands that actually make
requests_ (`test`, `mock --proxy`), validated per command with a message naming
the command that needs it.

### Things "big packages" get right that we should copy

- **`defineConfig()` for inference.** Already half-built as
  `defineTypeFetchTestConfig`; generalise the name, keep the old export as a
  deprecated alias.
- **`extends`.** Large orgs are monorepos. A shared base config with per-package
  overrides is table stakes.
- **Config as a function** — `defineConfig(({ mode }) => ({ … }))` — so
  `--mode ci` can change the baseline or the report format without a second file.
- **tsconfig `paths` support in the loader.** This repo's own source imports
  `@/types`; a user's contract file importing `@/schemas` will fail to load
  unless the loader resolves aliases. jiti takes an `alias` option — read it out
  of the nearest `tsconfig.json`. This is a guaranteed day-one support ticket
  otherwise.
- **Validate the config and point at the offending key**, not "Invalid config".

---

## 3. Command surface

zod v4 ships `z.toJSONSchema()`, and the peer range is already `^4.0.0`. That is
the enabler for everything below: a contract can be serialised to a stable,
comparable, printable document without writing a schema walker.

| Command             | Status                  | What it does                                       |
| ------------------- | ----------------------- | -------------------------------------------------- |
| `test`              | exists                  | contract test runner + report                      |
| `list`              | exists                  | enumerate endpoints — no client required           |
| `init`              | **rebuilt**             | detect the project, ask what it needs, scaffold it |
| `release-doc`       | **implemented**         | release note scaffold — see the note below         |
| **`diff`**          | **new — highest value** | breaking-change detection against a baseline       |
| **`snapshot`**      | new                     | write `typewire.lock.json`                         |
| **`lint`**          | new                     | static contract validation                         |
| **`mock`**          | new                     | local mock server from contracts                   |
| **`explain <id>`**  | new                     | fully resolved route, including transport          |
| **`doctor`**        | new                     | environment + install diagnosis                    |
| `generate openapi`  | new                     | OpenAPI 3.1 from contracts                         |
| `import --from`     | later                   | proto / SDL / OpenAPI → contracts                  |
| `codemod <version>` | later                   | version migration (own package)                    |

### 3.0 `release-doc` was never implemented

Worth recording, because it is the exact failure mode this table exists to
prevent. `release-doc` has been in `--help`, in `KNOWN_COMMANDS`, and in the
`TypeFetchCliCommand` union since 1.6.0 — with **no `case` in `runCli`**. It
fell through to `default:`, so `typewire release-doc v2.0.0` silently ran the
contract test suite. Nothing failed; it just did the wrong thing.

Two lessons, both cheap: a documented command needs a test that _runs_ it, not
one that parses it (`cli.test.ts` asserted `parseCliArgs(["release-doc", …])`
and stopped there); and a `default:` case that means "test" will swallow every
future command the same way. It is now implemented, and the arm is explicit.

### 3.1 `diff` — the one that decides enterprise adoption

`buf breaking` is a large part of why buf won proto tooling. This is that, for
typefetch contracts.

```bash
typewire snapshot                      # writes typewire.lock.json
typewire diff --baseline origin/main   # or against the committed lock
typewire diff --fail-on breaking       # CI gate
```

Committing `typewire.lock.json` means **the API surface change shows up as a
readable diff in code review** — a reviewer sees "this PR removes `user.email`
from the response" without reading a zod file.

The classification is where the real thinking goes, because a client that
_validates_ responses breaks in ways a server-side differ never reports:

| Change                                                | Verdict                                    |
| ----------------------------------------------------- | ------------------------------------------ |
| endpoint removed, `path`/`method`/`transport` changed | breaking                                   |
| new required field in `request`                       | breaking                                   |
| field removed from `response`                         | breaking for readers                       |
| **new variant added to a response enum**              | **breaking — the client's zod rejects it** |
| response field made optional/nullable                 | breaking for readers                       |
| new optional field in `request`                       | safe                                       |
| new field added to `response`                         | safe                                       |
| `errors` entry added                                  | safe                                       |

That enum row is the sharp one. A server team adding an enum value considers it
backward-compatible; for a response-validating client it is a production outage.
Nothing else in the ecosystem catches that for them, and it is the single most
convincing demo this tool can give.

### 3.2 `lint` — catch at CI what otherwise fails in prod

Contracts are data, so they can be checked statically. Rules worth shipping:

- a `:param` in `path` with no matching key in the `request.path` schema
- duplicate `endpointId`
- `responseType: "blob"`/`"file"` without the matching `zBlob()`/`zFile()`
- `auth: true` with no `permission` (opt-in; some routes are legitimately open)
- gRPC route missing `service`/`rpc`; GraphQL `root` absent from the response schema
- `mockData` that does not satisfy its own `response` schema
- an endpoint whose `errors` map is empty on a route declaring `auth: true`

Each rule `off | warn | error`, configured in `lint.rules`.

### 3.3 `mock` — unblock the frontend

`modules/tester/generate-input.ts` already generates values from zod schemas.
Pointed at `response` instead of `request`, that is a mock server:

```bash
typewire mock --port 4000 --seed 42
```

Serves every http route from `mockData` when present and generated data
otherwise, validated against its own contract on the way out. `--seed` makes it
deterministic, which is what makes it usable in Playwright/Cypress runs.
gRPC and GraphQL routes are served by their adapters' own shapes.

### 3.4 `doctor` — the dual-zod detector

`AGENTS.md` already names the hazard: _"Schemas only compare correctly when every
package resolves one zod instance."_ When it goes wrong the symptom is a
validation failure that makes no sense, and the cause is invisible.

`doctor` reports: how many `zod` copies resolve and from where, core/CLI version
skew, registered adapters and their `apiVersion`, missing peers, and the runtime
capability matrix (`ReadableStream`? `XMLHttpRequest`?) for the current
environment. Cheap to build, saves hours per occurrence.

### 3.5 `explain` — because resolution is no longer obvious

With pluggable transports, "what does this route actually do" stops being
readable from the contract alone.

```bash
$ typewire explain user.getUser
user.getUser
  transport   grpc         (@tahanabavi/typefetch-grpc, apiVersion 1)
  target      user.v1.UserService/GetUser
  url         POST https://grpc.example.com/user.v1.UserService/GetUser
  auth        yes → Authorization: Bearer <tokenProvider>
  permission  require: ["user.read"]
  deadline    5000ms
  errors      5 NOT_FOUND · 7 PERMISSION_DENIED
```

This is `describe()` from the transport seam, rendered. It is the reason that
member exists.

---

## 4. CI ergonomics

Non-negotiable for the tier we are aiming at, and cheap if built in from the
start rather than retrofitted:

- `--json` on **every** command, with a stable documented schema
- exit codes that mean something: `0` ok, `1` findings, `2` misconfiguration
- `--reporter` for `lint`/`diff` including a GitHub-annotations format, so
  findings land inline on the PR diff
- no colour and no spinners when not a TTY or when `CI` is set
- `--dry-run` on everything that writes

---

## 5. Build order

1. ~~**Split the package.**~~ **Done.** `src/cli/**` moved to
   `@tahanabavi/typewire-cli`, `jiti` moved with it, every command working
   byte-for-byte.
2. ~~**Generalise the config.**~~ **Done.** `typewire.config.ts` +
   `defineConfig` + `extends` + function configs + tsconfig `paths` in the
   loader + per-command `client` requirement. The old filename and the old
   `defineTypeFetchTestConfig` export still work and warn.

   One correction to §2 above, found while building it: the merge guard cannot
   be `getPrototypeOf(v) === Object.prototype`. jiti evaluates a config file in
   its own realm, so every object literal in `typewire.config.ts` has a
   different `Object.prototype` than the CLI's — the identity check passes for
   hand-built fixtures and fails for every real file, silently turning
   `extends` into a wholesale replace. It is prototype-_depth_ that identifies
   an object literal, not prototype identity.

3. **`snapshot` + `diff`.** Built on `z.toJSONSchema()`. This is the feature that
   earns the split.
4. **`lint`**, sharing the diff's serialiser.
5. **`doctor`**, **`explain`** — small, high leverage, both need the transport
   seam from `TRANSPORTS.md` step 2.
6. **`mock`**, reusing `generate-input.ts`.
7. **`generate openapi`**, lifting `packages/nestjs/src/openapi/build-openapi.ts`.
8. **`import --from`** and **`codemod`** — separate packages, separate design pass.
