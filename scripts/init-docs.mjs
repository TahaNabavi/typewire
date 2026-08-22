#!/usr/bin/env node
/**
 * Bootstraps a docs manifest for any package that has none.
 *
 * This exists to seed the convention across twelve packages at once, and to
 * give a new package a correct starting point — not to be part of the release
 * flow. It never overwrites an existing docs.json, because the whole value of
 * `documentsVersion` is that a human set it after reading the page.
 *
 * Seeded manifests list the package README as the overview page and pick up any
 * loose markdown already sitting in docs/. Run `node scripts/check-docs.mjs`
 * afterwards to see what it produced.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = join(ROOT, "packages");

function read(path) {
  const raw = readFileSync(path, "utf8");
  return (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n/g, "\n");
}

function markdownFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "assets" || entry === "releases") continue;
      markdownFiles(full, base, out);
      continue;
    }
    if (entry.endsWith(".md")) out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

/** "TRANSPORTS.md" -> "transports", "getting-started.md" -> "getting-started". */
function slugify(file) {
  return basename(file, ".md")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** First `# Heading` in the file, or the slug turned back into words. */
function titleOf(path, slug) {
  const heading = /^#\s+(.+)$/m.exec(read(path));
  if (heading) return heading[1].trim();
  return slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

let created = 0;
let skipped = 0;

for (const dir of readdirSync(PACKAGES)) {
  const pkgPath = join(PACKAGES, dir, "package.json");
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(read(pkgPath));
  if (pkg.private === true) continue;

  const docsDir = join(PACKAGES, dir, "docs");
  const manifestPath = join(docsDir, "docs.json");

  if (existsSync(manifestPath)) {
    skipped += 1;
    continue;
  }

  mkdirSync(docsDir, { recursive: true });

  const pages = [{ slug: "overview", title: "Overview", readme: true }];
  for (const file of markdownFiles(docsDir)) {
    const slug = slugify(file);
    pages.push({ slug, title: titleOf(join(docsDir, file), slug), file });
  }

  const manifest = {
    $schema: "../../../docs/docs.schema.json",
    documentsVersion: pkg.version,
    pages,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`  + packages/${dir}/docs/docs.json  (${pages.length} page${pages.length === 1 ? "" : "s"})`);
  created += 1;
}

console.log(`\n${created} created, ${skipped} already had one\n`);
