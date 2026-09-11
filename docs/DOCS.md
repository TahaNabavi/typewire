# Documentation

Every package documents itself, in its own directory, and declares which version
of itself those pages describe. CI fails when those two facts disagree.

The website renders these pages directly — there is no second copy of the docs
anywhere, and nothing about a package is retyped on the site. Editing a package's
markdown is how the website changes.

---

## The shape

```txt
packages/<pkg>/
  README.md              the canonical overview — still the main text
  docs/
    docs.json            the manifest: version + page list
    <page>.md            additional pages
    releases/            release notes, historical (not part of the manifest)
    assets/              images (not part of the manifest)
```

`packages/<pkg>/docs/docs.json`:

```json
{
  "$schema": "../../../docs/docs.schema.json",
  "documentsVersion": "1.10.0",
  "summary": "One line for the docs index. Optional.",
  "pages": [
    { "slug": "overview", "title": "Overview", "readme": true },
    { "slug": "transports", "title": "Transports", "file": "TRANSPORTS.md" }
  ]
}
```

A page is **either**:

- `"readme": true` — renders the package's own `README.md`. For most packages
  here the README _is_ the documentation, and copying it into `docs/` would
  guarantee the two drift.
- `"file": "SOMETHING.md"` — a markdown file relative to `docs/`.

`slug` becomes a URL segment: `/docs/<package>/<slug>`. The order of `pages` is
the order of the sidebar.

---

## Splitting a README across pages

A README is one long document because that is the right shape for npm and for
GitHub, where a reader scrolls. It is the wrong shape for a docs site, where a
reader navigates: `typefetch`'s README is 2,000 lines, and rendering it as a
single page buries the one section someone came for.

So a page can name the `sections` it renders:

```json
{
  "pages": [
    {
      "slug": "overview",
      "title": "Overview",
      "readme": true,
      "intro": true,
      "sections": ["Features"]
    },
    {
      "slug": "quick-start",
      "title": "Quick start",
      "readme": true,
      "sections": ["Installation", "Quick Start"]
    },
    {
      "slug": "middleware",
      "title": "Middleware",
      "readme": true,
      "sections": [
        "Middleware System",
        "Built-in Middlewares",
        "Custom Middleware"
      ]
    }
  ]
}
```

- `sections` — H2 headings from the source file, **matched exactly**, rendered
  in the order listed. Omit it to render the whole file, as before.
- `intro` — also render everything above the first H2: the badges and opening
  paragraph. Use it on the page that opens the package, and nowhere else.
- `omit` — headings that deliberately never reach the site. There is one real
  use for this: a hand-written table of contents, which the sidebar already is.

Nothing is copied. The README stays the entire story, the manifest decides how
the website paginates it, and editing a section still changes exactly one file.

### The coverage rule

`scripts/check-docs.mjs` fails when a section of a sliced file appears on **no**
page:

```txt
✗ @tahanabavi/typesocket
  1 section(s) of packages/typesocket/README.md are on no page: "Table of contents"
```

This is the failure mode the whole feature would otherwise introduce. Add a
`## Retries` section to a README and, without this check, the website simply
never renders it — no error, no warning, and the README still reads correctly
everywhere else. Claiming a heading twice, or naming one that does not exist,
fails the same way.

The practical consequence: **adding an H2 to a sliced README means adding it to
a page.** That is one line of JSON, and it is the moment to decide where a
reader should find it.

---

## `documentsVersion` — the whole point

This is the package version the pages were last **read against**. Not the version
they were last edited in; the version someone checked them against.

`scripts/check-docs.mjs` compares it to `package.json`'s `version`:

| Situation                                 | Result            |
| ----------------------------------------- | ----------------- |
| equal                                     | pass              |
| package moved by a **patch** only         | pass, with a note |
| package moved by a **minor or major**     | **fail**          |
| docs claim a version ahead of the package | **fail**          |

### Why patch bumps are exempt

A patch is by semver's own definition a fix that changes no documented
behaviour. Failing on patches would force a no-op edit to `docs.json` on every
bug-fix release, and the thing everyone would learn is to bump the number without
opening the page — which is the exact failure this gate exists to prevent. Making
the check _ignorable_ is worse than making it narrower.

### Why "ahead" also fails

`documentsVersion: "2.0.0"` on a package still at `1.9.0` means someone
documented a release that has not happened, or a version bump was reverted and
the docs were not. Both are states a reader would be misled by.

---

## When you change a package

1. Change the code.
2. Add a changeset (`pnpm changeset`) — this is what moves the version.
3. If the bump is a minor or a major, update the pages under
   `packages/<pkg>/docs/` (or the README) and set `documentsVersion` to the new
   version.
4. `node scripts/check-docs.mjs` to confirm.

If step 3 feels like busywork for a change nobody needs documented, that is a
signal the bump should have been a patch — not a signal the gate should be
skipped.

---

## Running the gate

```bash
node scripts/check-docs.mjs
```

No install needed: it reads `package.json` and `docs.json` with `node:fs` and
nothing else, which is why the CI job runs on a bare checkout in seconds.

The workflow is [`.github/workflows/docs.yml`](../.github/workflows/docs.yml). It
runs on any change to a package manifest, a docs tree or a README — the two sides
of the comparison — and comments on the pull request when it fails.

---

## Adding a new package

`node scripts/init-docs.mjs` seeds a manifest for any package that has none. It
lists the README as the overview page, picks up any loose markdown already in
`docs/`, and sets `documentsVersion` to the current version.

It never overwrites an existing `docs.json`, because the value of
`documentsVersion` is entirely that a human set it after reading the page.

---

## What the website does with this

`apps/web/scripts/generate-registry.mjs` inlines each manifest and every page's
markdown into `src/generated/registry.json` at build time. The site renders from
that — it never reads outside its own directory at request time, so it builds the
same way on Vercel as it does locally.

The docs index shows each package's `documentsVersion` as a badge. When the docs
are behind by a minor or major — the state CI fails on — the badge turns amber and
says so rather than hiding it. A reader deserves to know a page may describe an
older release.
