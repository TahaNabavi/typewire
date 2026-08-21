---
"@tahanabavi/typewire-cli": minor
---

`projects` — several API surfaces in one config.

A repo with a dashboard API, an admin API and a landing API can now declare them
in one file, each with its own contracts, client, middleware, transports and
base URL:

```ts
export default defineConfig({
  lint: { rules: { "path-params-declared": "error" } },   // shared default

  projects: {
    dashboard: { typefetch: { contracts, createClient: createDashboardClient } },
    admin: {
      typefetch: { contracts: adminContracts, createClient: createAdminClient },
      lint: { rules: { "duplicate-id": "off" } },   // merged over the shared rules
      diff: { baseline: "admin.lock.json" },        // its own snapshot
    },
    landing: { typefetch: { contracts: landingContracts } },  // no client needed
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
- Sections at the top level *alongside* `projects` are refused: which surface
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
