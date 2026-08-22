#!/usr/bin/env node
/**
 * Released-version assertion
 * ==========================
 * A package's version here must never be lower than the one on npm.
 *
 * It exists because the release pipeline fails quietly in exactly that shape.
 * `changeset publish` asks the registry whether the version it computed is
 * already there, and skips the package if it is — a skip, not an error, so the
 * workflow stays green. Combine that with a version that went backwards (a
 * conflict resolved in favour of a stale branch, a bad revert) and changesets
 * recomputes from the lower number, lands on one it already published, skips,
 * and reports success. The release never shipped and nothing said so.
 *
 * That is not hypothetical: typewire-nestjs sat at 1.0.0 here while npm served
 * 3.0.0, and a release "succeeded" without publishing anything for a day.
 *
 * Being *ahead* of the registry is normal — that is every commit between a
 * version bump and its publish. Only being behind is the bug.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

/** changesets' marker for "this package has never been released". */
const UNRELEASED = "0.0.0";

/** Compare two semver strings. Prerelease sorts below its own release. */
function compare(a, b) {
  const [mainA, preA = ""] = a.split("-");
  const [mainB, preB = ""] = b.split("-");
  const partsA = mainA.split(".").map(Number);
  const partsB = mainB.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

/** The registry's `latest`, or null if the package was never published. */
async function latestOnRegistry(name) {
  const url = `${REGISTRY}/${encodeURIComponent(name)}/latest`;

  // A version published seconds ago may not have propagated yet, and the
  // registry is not above the occasional 5xx. Neither is a reason to fail.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (response.status === 404) return null;
    if (response.ok) return (await response.json()).version;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`${name}: registry unreachable after 3 attempts`);
}

let failed = false;

for (const dir of readdirSync(join(root, "packages"))) {
  const manifest = JSON.parse(
    readFileSync(join(root, "packages", dir, "package.json"), "utf8"),
  );
  if (manifest.private === true) continue;
  if (manifest.version === UNRELEASED) {
    console.log(`- ${manifest.name} — not released yet, skipped`);
    continue;
  }

  const latest = await latestOnRegistry(manifest.name);
  if (latest === null) {
    console.log(`- ${manifest.name} — awaiting its first publish`);
    continue;
  }

  if (compare(manifest.version, latest) < 0) {
    failed = true;
    console.error(
      `✗ ${manifest.name} is ${manifest.version} here but ${latest} on npm.\n` +
        `  The repo is behind its own release, so changesets will recompute\n` +
        `  from ${manifest.version}, hit a version it already published, and skip it.\n` +
        `  Set the version above ${latest} — do not add a changeset to climb there.\n`,
    );
  } else {
    console.log(`✓ ${manifest.name} — ${manifest.version} >= ${latest} on npm`);
  }
}

console.log("");
process.exit(failed ? 1 : 0);
