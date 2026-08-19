---
"@tahanabavi/typewire-cli": minor
---

`typewire.config.ts` — one config file for every TypeWire package.

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
