# Contributing to TypeWire

Thanks for taking the time to contribute! TypeWire is a [pnpm workspaces](https://pnpm.io/workspaces)
monorepo of strongly-typed, contract-first packages published under the
`@tahanabavi/*` npm scope. This guide covers everything you need to get a change
merged.

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- 🐛 **Report a bug** — open a [bug report](https://github.com/TahaNabavi/typewire/issues/new/choose).
- 💡 **Request a feature** — open a [feature request](https://github.com/TahaNabavi/typewire/issues/new/choose).
- 📖 **Improve docs** — typos, clarifications, and examples are always welcome.
- 🔧 **Send a pull request** — see the flow below.

For anything non-trivial, please **open an issue first** so we can agree on the
approach before you invest time in a PR.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | **≥ 22.13** | Required by pnpm 11. Check with `node -v`; use `nvm use 22` or install Node 22 LTS. |
| **pnpm** | 11.6.0 | Pinned via the `packageManager` field. Run `corepack enable` and pnpm is provisioned automatically. |

## Local setup

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/typewire.git
cd typewire

# 2. Install every workspace package
pnpm install

# 3. Verify a clean baseline before you change anything
pnpm -r build       # build all packages in topological order
pnpm -r typecheck   # typecheck everything
pnpm -r test        # run all test suites
```

## Working in the monorepo

- Packages live under [`packages/`](./packages). Each is independently versioned
  and published.
- Cross-package dependencies use the `workspace:*` protocol locally and are
  rewritten to real semver ranges at publish time — so a change to one package's
  types is immediately visible to its dependents when you rebuild.
- Run a script in a single package with a filter:

  ```bash
  pnpm --filter @tahanabavi/typefetch build
  pnpm --filter @tahanabavi/typefetch test
  ```

## Every source change needs a changeset

Releases are managed with [Changesets](https://github.com/changesets/changesets).
**If your PR changes a package's source (anything that affects published output),
you must include a changeset** describing it:

```bash
pnpm changeset
```

This prompts you to:

1. select which package(s) changed,
2. pick a bump level — `patch` (fixes), `minor` (backwards-compatible features),
   or `major` (breaking changes), and
3. write a short summary that becomes the changelog entry.

Commit the generated file in `.changeset/`. Docs-only, CI-only, or test-only
changes don't need one — CI's `changeset status` step is informational and won't
block those.

## Pull request flow

1. Create a branch off the default branch: `git checkout -b fix/short-description`.
2. Make your change. Keep the public API minimal and match the surrounding code's
   style.
3. Add or update tests, and make sure the full gate passes locally:

   ```bash
   pnpm -r build && pnpm -r typecheck && pnpm -r test
   ```

4. Add a changeset (see above) if you touched package source.
5. Push to your fork and open a PR against **`main`**. Fill out the PR template.
6. CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs
   `build → typecheck → test` in topological order across all packages — a change
   that breaks a dependent turns the check red. First-time contributors' runs need
   a maintainer's approval to start.
7. A maintainer reviews and merges. Publishing is fully automated from `main` via
   Changesets — you don't publish anything yourself.

## Coding guidelines

- **TypeScript strict** — no `any` escape hatches without a clear reason.
- **Contracts stay untouched.** Features are additive modules layered around the
  core clients, never changes to the contract shape. See
  [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the three design laws.
- **Keep the daily API tiny.** Prefer composition over new top-level surface.
- Match existing formatting, naming, and comment density in the file you're
  editing.

## Questions?

Open a [discussion or issue](https://github.com/TahaNabavi/typewire/issues) — we're
happy to help you land your first contribution.
