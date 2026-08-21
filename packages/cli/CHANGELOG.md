# @tahanabavi/typewire-cli

## 0.1.0

### Minor Changes

- 905a1e5: `typefetch.transports` — adapters for the commands that never build a client.

  `method` and `path` exist only on http endpoints, so anything that prints a
  route has to ask the adapter through `describe()` — and `list` has no client to
  ask. Every gRPC and GraphQL row printed as `?`.

  ```ts
  typefetch: {
    contracts,
    transports: [graphqlTransport(), grpcTransport()],
  }
  ```

  `list` now resolves them without constructing a client, so it still runs against
  an API that is not up. The listing also gained `Transport` and `Operation`
  columns, and when a transport _cannot_ be described it now says so and names it
  — a silent `?` reads as a complete listing when it is not.

  Passing the factory instead of its result (`[grpcTransport]` rather than
  `[grpcTransport()]`) is caught at load time with a message saying to call it.

- 4079eb1: Pluggable transports, and a core with zero runtime dependencies.

  TypeFetch spoke one wire: `fetch`, swapped for `XMLHttpRequest` when a request
  asked for upload progress. The wire is now **pluggable**, so gRPC and GraphQL
  ship as separate installable packages that feed the same contract, the same
  middleware chain, the same `onError`, the same retry policy, the same mock mode
  and the same devtools timeline. Application code stops caring which wire it is
  on.

  **New packages**

  - `@tahanabavi/typefetch-graphql` — GraphQL over HTTP, with the selection set
    generated from the Zod `response` schema so the shape that requests the data
    and the shape that validates it cannot drift.
  - `@tahanabavi/typefetch-grpc` — Connect unary JSON out of the box, binary
    grpc-web behind a codec seam. No protobuf runtime.
  - `@tahanabavi/typefetch-encryption` — the encryption middleware, moved out of
    core along with `crypto-js` and `node-forge`.
  - `@tahanabavi/typewire-cli` — the CLI binary (renamed `typefetch` → `typewire`),
    moved out of core along
    with `jiti`.

  **`@tahanabavi/typefetch` now declares zero runtime dependencies.** `zod` remains
  the single peer dependency.

  **New in core**

  - `TransportRegistry`, an augmentable interface third-party transports merge into
    — `transport: "grpc"` does not compile until the package is installed.
  - `TransportAdapter`, the public, versioned seam (`TRANSPORT_API_VERSION`).
  - `RichError.kind`, a normalised failure taxonomy shared by every transport, so
    one `onError` handler covers HTTP 401, gRPC `UNAUTHENTICATED` and GraphQL
    `extensions.code` alike.
  - `describeEndpoint()`, so tooling identifies a route without reading
    transport-specific fields.

  **Fixed**

  - A request input that failed its own `request` schema escaped as a raw
    `ZodError`: no `RichError`, no `kind`, never passed to `onError`, and invisible
    to instrumentation — while a bad _response_ one line later did all four. Both
    ends of the contract now fail identically, with Zod's field errors carried into
    `RichError.errors`.

  **Breaking**

  | Before                                                              | After                                                                     |
  | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | `import { encryptionMiddleware } from "@tahanabavi/typefetch"`      | `from "@tahanabavi/typefetch-encryption"`                                 |
  | `npx typewire` (bin in core)                                        | `npm i -D @tahanabavi/typewire-cli`                                       |
  | `import { defineTypeFetchTestConfig } from "@tahanabavi/typefetch"` | `from "@tahanabavi/typewire-cli"`                                         |
  | `ErrorResponsesMap = Record<number, …>`                             | `Record<number \| string, …>` (widened; the old form is still assignable) |
  | A bad request input threw `ZodError`                                | It now throws `RichError` with `kind: "validation"`                       |

  Endpoints without a `transport` key keep defaulting to `"http"`, so every
  existing contract compiles and behaves exactly as before.

- 905a1e5: `projects` — several API surfaces in one config.

  A repo with a dashboard API, an admin API and a landing API can now declare them
  in one file, each with its own contracts, client, middleware, transports and
  base URL:

  ```ts
  export default defineConfig({
    lint: { rules: { "path-params-declared": "error" } }, // shared default

    projects: {
      dashboard: {
        typefetch: { contracts, createClient: createDashboardClient },
      },
      admin: {
        typefetch: {
          contracts: adminContracts,
          createClient: createAdminClient,
        },
        lint: { rules: { "duplicate-id": "off" } }, // merged over the shared rules
        diff: { baseline: "admin.lock.json" }, // its own snapshot
      },
      landing: { typefetch: { contracts: landingContracts } }, // no client needed
    },
  });
  ```

  One file rather than three, because the alternative is three configs, three
  `--config` flags in every script, and three CI steps that drift.

  - **`--project <a,b>`** narrows any command; **every project runs by default**,
    and any failure fails the run. A gate that silently checked one of three API
    surfaces and reported green is worse than no gate.
  - **Reports go to a per-project folder.** Sharing one output path means the last
    project overwrites the others and the report looks complete while describing
    one API.
  - **Commands that need exactly one project refuse to guess** — with several
    declared and no `--project`, the error names them.
  - **Top-level `lint`/`diff` are defaults** each project merges over, key by key.
  - Sections at the top level _alongside_ `projects` are refused: which surface
    would those contracts belong to?
  - `projects` cannot nest, and every validation error names the project —
    `projects.admin.typefetch.contracts — expected an object of contract modules`.

  Omit `projects` for the single-API case; it costs nothing and resolves to one
  implicit project internally, so no command branches on which shape you wrote.

  Also fixed: a **UTF-8 BOM** in `package.json` or `tsconfig.json` — which Windows
  editors and PowerShell's `Out-File -Encoding utf8` write routinely — made
  `JSON.parse` throw. `typewire init` silently fell back to "an unrecognised
  project" and scaffolded the wrong framework's files, and tsconfig path aliases
  were silently dropped.

- 905a1e5: `typewire.config.ts` — one config file for every TypeWire package.

  - **`defineConfig()`** replaces `defineTypeFetchTestConfig()`, which still works
    and is now deprecated. Sections are keyed by package (`typefetch`,
    `typesocket`, `permission`) so nothing has to be renamed when a package is
    added, with `lint` and `diff` shared at the top level.
  - **A client is no longer required to load a config.** `contracts` is the only
    always-required key; `client`/`createClient` are demanded by the commands that
    actually make requests, with an error naming the command. `typewire list` now
    runs against a contract file with no API reachable.
  - **`extends`** — a path or a package name, merged key by key with the extending
    file winning. Arrays are replaced, not concatenated, so a base's report
    formats can be narrowed.
  - **A config may be a function** — `defineConfig(({ mode, command, ci }) => …)`.
  - **tsconfig `paths` are resolved by the loader**, following the `extends` chain,
    so a contract file that imports `@/schemas` loads.
  - **Discovery walks up from the working directory**, so a package inside a
    monorepo inherits the root config.
  - **Validation names the offending key** — `typewire.config.ts ›
typefetch.contracts — expected an object of contract modules, received
undefined` — and a mistyped section suggests the right spelling.
  - **Exit code `2` for misconfiguration**, distinct from `1` for findings.

  `typefetch.test.config.*` still loads: its flat shape is lifted into the
  `typefetch` section, and the loader warns once with the new name. `options`,
  `context` and `report` at the top of the section move under `test`, and are
  still accepted with a warning.

  `typewire init` now writes `typewire.config.ts`, `typewire.env.example` and
  `typewire-report/`, and the default report path is `./typewire-report/report`.

- 905a1e5: `typewire init` reads the project and wires it up.

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

### Patch Changes

- Updated dependencies [4079eb1]
- Updated dependencies [3683319]
  - @tahanabavi/typefetch@2.0.0
