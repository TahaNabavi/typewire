#!/usr/bin/env node
/**
 * The documentation gate.
 *
 * Every package in this repo carries its own docs, and every docs tree declares
 * which version of that package it describes. This script fails when those two
 * facts disagree — which is the moment documentation silently goes stale.
 *
 *   packages/<pkg>/package.json      version: the code
 *   packages/<pkg>/docs/docs.json    documentsVersion: what the docs describe
 *
 * A docs.json page is either `{ slug, title, readme: true }` — rendering the
 * package's own README, which for most of these packages is still the canonical
 * text — or `{ slug, title, file }` pointing at a markdown file under docs/.
 *
 * ## Why not require an exact match
 *
 * Requiring `documentsVersion === version` would force a docs edit on every
 * patch release, and a patch is by definition a fix that changes no documented
 * behaviour. The result would be a repo full of no-op version bumps in
 * docs.json, which teaches everyone to bump the number without reading the
 * page — the exact failure this gate exists to prevent.
 *
 * So the rule is semver-shaped:
 *
 *   MAJOR or MINOR moved past documentsVersion  ->  FAIL. New or changed
 *                                                   behaviour is undocumented.
 *   only PATCH moved                            ->  pass, with a note.
 *
 * ## What else it checks
 *
 *   - every package has a docs tree at all
 *   - every page listed in docs.json exists on disk
 *   - every markdown file on disk is listed in docs.json (no orphan pages that
 *     the website will never render)
 *   - slugs are unique and URL-safe, since they become website routes
 *   - the declared version is a version the package has actually reached
 *
 * Run: node scripts/check-docs.mjs [--fix-hint]
 * Exit: 0 clean, 1 one or more packages are out of date.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = join(ROOT, "packages");

/** Strips a BOM and normalises CRLF — both appear in this repo. */
function read(path) {
  const raw = readFileSync(path, "utf8");
  return (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n/g, "\n");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? ""));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** -1 a<b, 0 equal, 1 a>b. Prerelease tags are ignored on purpose. */
function compare(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** Every .md under a directory, repo-relative, excluding assets and releases. */
function markdownFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Release notes are historical records, not pages of the current docs,
      // and assets are images. Neither belongs in the page manifest.
      if (entry === "assets" || entry === "releases") continue;
      markdownFiles(full, base, out);
      continue;
    }
    if (entry.endsWith(".md")) out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `## Heading` text, skipping anything inside a fenced block — several of
 * these READMEs print `## ` inside example terminal output.
 */
function headingsOf(md) {
  const out = [];
  let fenced = false;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) out.push(match[1].replace(/`/g, "").trim());
  }
  return out;
}

/** Which sections each page claims, grouped by the file they are sliced from. */
function sectionClaims(pages, dir) {
  const byFile = new Map();
  for (const page of pages) {
    if (!page || !Array.isArray(page.sections)) continue;
    const source =
      page.readme === true
        ? join(PACKAGES, dir, "README.md")
        : join(PACKAGES, dir, "docs", String(page.file ?? ""));
    if (!existsSync(source)) continue;
    const claims = byFile.get(source) ?? [];
    for (const section of page.sections) {
      claims.push({ slug: page.slug, section: String(section).replace(/`/g, "").trim() });
    }
    // A deliberate omission still counts as claimed — the point of the check is
    // that nothing goes missing by accident, not that nothing goes missing.
    for (const section of page.omit ?? []) {
      claims.push({
        slug: page.slug,
        section: String(section).replace(/`/g, "").trim(),
        omitted: true,
      });
    }
    byFile.set(source, claims);
  }
  return byFile;
}

const problems = [];
const notes = [];
const rows = [];

const dirs = readdirSync(PACKAGES).filter((entry) =>
  existsSync(join(PACKAGES, entry, "package.json")),
);

for (const dir of dirs) {
  const pkgPath = join(PACKAGES, dir, "package.json");
  const pkg = readJson(pkgPath);
  const name = pkg.name ?? dir;

  if (pkg.private === true) {
    notes.push(`${name}: private, skipped`);
    continue;
  }

  const docsDir = join(PACKAGES, dir, "docs");
  const manifestPath = join(docsDir, "docs.json");

  if (!existsSync(manifestPath)) {
    problems.push(
      `${name}\n` +
        `    no docs manifest at packages/${dir}/docs/docs.json\n` +
        `    Every published package needs one — it is what the website renders and\n` +
        `    what this gate compares against. See docs/DOCS.md for the shape.`,
    );
    continue;
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    problems.push(`${name}\n    docs.json is not valid JSON: ${error.message}`);
    continue;
  }

  const code = parseVersion(pkg.version);
  const documented = parseVersion(manifest.documentsVersion);

  if (!code) {
    problems.push(`${name}\n    package.json version "${pkg.version}" is not semver`);
    continue;
  }
  if (!documented) {
    problems.push(
      `${name}\n    docs.json documentsVersion "${manifest.documentsVersion}" is not semver`,
    );
    continue;
  }

  // Pages: listed but missing, and present but unlisted.
  const listed = Array.isArray(manifest.pages) ? manifest.pages : [];
  const seenSlugs = new Set();
  const listedFiles = new Set();

  for (const page of listed) {
    if (!page || typeof page !== "object") {
      problems.push(`${name}\n    a docs.json page entry is not an object`);
      continue;
    }
    if (!SLUG.test(String(page.slug ?? ""))) {
      problems.push(
        `${name}\n    page slug "${page.slug}" is not URL-safe (lowercase, digits, single hyphens)`,
      );
    }
    if (seenSlugs.has(page.slug)) {
      problems.push(`${name}\n    duplicate page slug "${page.slug}"`);
    }
    seenSlugs.add(page.slug);

    if (!page.title) {
      problems.push(`${name}\n    page "${page.slug}" has no title`);
    }

    // A page is either the package README — still the canonical text for most
    // of these packages, and copying it into docs/ would guarantee the two
    // drift — or a markdown file inside docs/.
    if (page.readme === true) {
      if (page.file) {
        problems.push(
          `${name}\n    page "${page.slug}" sets both readme:true and file — pick one`,
        );
      }
      if (!existsSync(join(PACKAGES, dir, "README.md"))) {
        problems.push(
          `${name}\n    page "${page.slug}" is readme:true but packages/${dir}/README.md is missing`,
        );
      }
      continue;
    }

    const file = String(page.file ?? "");
    if (!file) {
      problems.push(`${name}\n    page "${page.slug}" has neither file nor readme:true`);
      continue;
    }
    listedFiles.add(file);
    if (!existsSync(join(docsDir, file))) {
      problems.push(
        `${name}\n    page "${page.slug}" points at packages/${dir}/docs/${file}, which does not exist`,
      );
    }
  }

  for (const file of markdownFiles(docsDir)) {
    if (!listedFiles.has(file)) {
      problems.push(
        `${name}\n` +
          `    packages/${dir}/docs/${file} is not listed in docs.json\n` +
          `    An unlisted page is never rendered by the website — list it or delete it.`,
      );
    }
  }

  // Sections: every heading of a sliced file has to land on exactly one page.
  //
  // Splitting a README across pages is the one way content can go missing
  // without anyone noticing: add a "## Retries" section to the README and the
  // website simply never renders it, because no page claims it. The README
  // still reads correctly on npm, so nothing else catches it. This does.
  for (const [source, claims] of sectionClaims(listed, dir).entries()) {
    const headings = headingsOf(read(source));
    if (headings.length === 0) continue;

    const known = new Set(headings);
    const seen = new Set();

    for (const { slug, section } of claims) {
      if (!known.has(section)) {
        problems.push(
          `${name}\n` +
            `    page "${slug}" lists section "${section}", which is not a heading in ${relative(ROOT, source).replace(/\\/g, "/")}\n` +
            `    Headings are matched exactly. Renaming one in the markdown means renaming it here.`,
        );
      }
      if (seen.has(section)) {
        problems.push(`${name}\n    section "${section}" is claimed by more than one page`);
      }
      seen.add(section);
    }

    const orphans = headings.filter((heading) => !seen.has(heading));
    if (orphans.length > 0) {
      problems.push(
        `${name}\n` +
          `    ${orphans.length} section(s) of ${relative(ROOT, source).replace(/\\/g, "/")} are on no page: ${orphans.map((h) => `"${h}"`).join(", ")}\n` +
          `    A section no page claims is never rendered by the website. Add it to a page's ` +
          `"sections", or drop it from the markdown.`,
      );
    }
  }

  if (listed.length === 0) {
    problems.push(`${name}\n    docs.json lists no pages`);
  }

  // The version comparison — the reason this gate exists.
  const order = compare(documented, code);

  if (order > 0) {
    problems.push(
      `${name}\n` +
        `    docs claim to document ${manifest.documentsVersion}, but the package is ${pkg.version}\n` +
        `    The docs are ahead of the code. Either the version bump was reverted, or\n` +
        `    documentsVersion was raised before the release landed.`,
    );
  } else if (order < 0) {
    const behindFeature = documented.major !== code.major || documented.minor !== code.minor;
    if (behindFeature) {
      problems.push(
        `${name}\n` +
          `    package is ${pkg.version}, docs document ${manifest.documentsVersion}\n` +
          `    A minor or major bump means behaviour was added or changed, and the docs\n` +
          `    have not been reviewed against it.\n` +
          `    Fix: update packages/${dir}/docs/, then set documentsVersion to "${pkg.version}".`,
      );
    } else {
      notes.push(
        `${name}: ${pkg.version} vs documented ${manifest.documentsVersion} — patch only, no docs change required`,
      );
    }
  }

  rows.push({
    name,
    version: pkg.version,
    documented: manifest.documentsVersion,
    pages: listed.length,
    status: order === 0 ? "current" : order < 0 ? "behind" : "ahead",
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const width = Math.max(...rows.map((r) => r.name.length), 8);
console.log("\nDocumentation coverage\n");
console.log(
  `  ${"package".padEnd(width)}  ${"version".padEnd(9)}  ${"documented".padEnd(11)}  pages  status`,
);
console.log(`  ${"-".repeat(width)}  ${"-".repeat(9)}  ${"-".repeat(11)}  -----  ------`);
for (const row of rows) {
  console.log(
    `  ${row.name.padEnd(width)}  ${String(row.version).padEnd(9)}  ${String(row.documented).padEnd(11)}  ${String(row.pages).padStart(5)}  ${row.status}`,
  );
}

if (notes.length > 0) {
  console.log("\nNotes");
  for (const note of notes) console.log(`  · ${note}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} documentation problem${problems.length === 1 ? "" : "s"}\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}\n`);
  console.error(
    "The website renders these docs directly from the packages, so a package that\n" +
      "ships undocumented behaviour ships a website that is wrong about it.\n",
  );
  process.exit(1);
}

console.log("\n✓ every package documents its current version\n");
