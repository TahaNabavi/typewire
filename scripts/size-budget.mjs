#!/usr/bin/env node
/**
 * Gzipped size budget
 * ===================
 * Fails the build when a package's published entry grows past its ceiling in
 * `size-budget.json`.
 *
 * Deliberately dependency-free — `zlib` and `fs` are enough, and a repo whose
 * headline claim is "zero runtime dependencies" should not need a toolchain to
 * check its own size.
 *
 * Run `node scripts/size-budget.mjs` after `pnpm -r build`.
 * Pass `--json` for machine-readable output, `--update` to rewrite the budgets
 * to current sizes plus headroom (review the diff — that is the point).
 */
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "size-budget.json");

const asJson = process.argv.includes("--json");
const update = process.argv.includes("--update");

/** Headroom applied by `--update`: enough to absorb noise, not a refactor. */
const HEADROOM = 1.12;

const config = JSON.parse(readFileSync(configPath, "utf8"));

const results = [];
let failed = false;
let missing = false;

for (const budget of config.budgets) {
  const entry = join(root, "packages", budget.package, budget.entry);

  if (!existsSync(entry)) {
    // A package that has not been built is a broken invocation, not a pass.
    results.push({ ...budget, built: false });
    missing = true;
    continue;
  }

  const gzip = gzipSync(readFileSync(entry)).length;
  const over = gzip > budget.maxGzip;
  if (over) failed = true;

  results.push({
    ...budget,
    built: true,
    gzip,
    over,
    pct: Math.round((gzip / budget.maxGzip) * 100),
  });
}

if (asJson) {
  console.log(JSON.stringify({ ok: !failed && !missing, results }, null, 2));
} else {
  const name = (s) => String(s).padEnd(16);
  const num = (s) => String(s).padStart(8);

  console.log("\nGzipped size budget\n");
  console.log(`  ${name("PACKAGE")}${num("GZIP")}${num("BUDGET")}${num("USED")}`);
  console.log(`  ${"-".repeat(40)}`);

  for (const r of results) {
    if (!r.built) {
      console.log(`  ${name(r.package)}${num("—")}${num(r.maxGzip)}   not built`);
      continue;
    }
    const flag = r.over ? "  OVER" : "";
    console.log(
      `  ${name(r.package)}${num(r.gzip)}${num(r.maxGzip)}${num(r.pct + "%")}${flag}`,
    );
  }
  console.log("");
}

if (update) {
  config.budgets = config.budgets.map((budget) => {
    const result = results.find((r) => r.package === budget.package);
    if (!result?.built) return budget;
    return { ...budget, maxGzip: Math.ceil((result.gzip * HEADROOM) / 100) * 100 };
  });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log("size-budget.json rewritten — review the diff before committing.\n");
  process.exit(0);
}

if (missing) {
  console.error("Some packages are not built. Run `pnpm -r build` first.\n");
  process.exit(2);
}

if (failed) {
  console.error(
    "A package exceeded its gzipped budget.\n\n" +
      "If the growth is intended, raise the ceiling in size-budget.json in the\n" +
      "same PR, so the increase is reviewed rather than absorbed silently.\n",
  );
  process.exit(1);
}
