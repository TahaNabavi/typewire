import type { ApiTestReport, ApiTestResult } from "@/modules/tester";
import type { Contracts, EndpointDefZ } from "../types";

const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

export function printHelp() {
  console.log(`TypeFetch CLI

Usage:
  typefetch test [options]
  typefetch list [options]
  typefetch init [options]
  typefetch release-doc --version v1.6.0 [options]

Commands:
  test          Run contract-driven API tests and generate reports
  list          List discovered endpoints from the TypeFetch config
  init          Create config, report folder, docs/releases folder, and fixture folder
  release-doc   Create a release documentation template in docs/releases

Test options:
  -c, --config <path>              Config file path
  -m, --mode <schema|mock|live|full>
      --base-url <url>             Passed to config.createClient({ baseUrl })
      --token <token>              Passed to config.createClient({ token })
      --timeout <ms>
      --include-tags <a,b>
      --exclude-tags <a,b>
      --include-destructive
      --no-include-destructive
      --stop-on-fail
      --no-stop-on-fail
  -f, --format <markdown,json,html>
  -o, --output <path>              Example: ./typefetch-report/report

Init options:
      --force                      Overwrite existing generated files
      --package <name>             Package import name, default: @tahanabavi/typefetch
      --contracts-path <path>      Default: ./src/contracts

Release doc options:
      --version <version>          Example: v1.6.0
      --title <title>
      --output-dir <path>          Default: ./docs/releases
      --force

Examples:
  typefetch init
  typefetch test --mode full --output ./typefetch-report/report --format markdown,json,html
  typefetch list --config ./typefetch.test.config.ts
  typefetch release-doc --version v1.6.0 --title "Testing Feature"
`);
}

export function printVersion(version: string) {
  console.log(version);
}

export function printEndpointList(contracts: Contracts) {
  const rows: Array<[string, string, string, string]> = [];

  for (const moduleName of Object.keys(contracts)) {
    const module = contracts[moduleName];
    for (const endpointName of Object.keys(module)) {
      const endpoint = module[endpointName] as EndpointDefZ;
      rows.push([
        `${moduleName}.${endpointName}`,
        endpoint.method,
        endpoint.path,
        endpoint.test?.enabled === false ? "disabled" : endpoint.test?.destructive ? "destructive" : "enabled",
      ]);
    }
  }

  console.log(`${COLOR.bold}TypeFetch endpoints${COLOR.reset}\n`);
  printTable(["Endpoint", "Method", "Path", "State"], rows);
  console.log(`\nTotal: ${rows.length}`);
}

export function printReportSummary(report: ApiTestReport, reportPaths: string[]) {
  console.log(`\n${COLOR.bold}TypeFetch Test Runner${COLOR.reset}`);
  console.log(`${COLOR.dim}Mode:${COLOR.reset} ${report.mode}`);
  console.log(`${COLOR.dim}Generated:${COLOR.reset} ${report.generatedAt}\n`);

  for (const item of report.results) {
    printResultLine(item);
  }

  console.log(`\n${COLOR.bold}Summary${COLOR.reset}`);
  console.log(`Total:   ${report.summary.total}`);
  console.log(`${COLOR.green}Passed:${COLOR.reset}  ${report.summary.passed}`);
  console.log(`${COLOR.red}Failed:${COLOR.reset}  ${report.summary.failed}`);
  console.log(`${COLOR.yellow}Skipped:${COLOR.reset} ${report.summary.skipped}`);
  console.log(`Duration: ${formatMs(report.summary.durationMs)}`);

  if (reportPaths.length) {
    console.log(`\n${COLOR.bold}Reports${COLOR.reset}`);
    for (const path of reportPaths) console.log(`- ${path}`);
  }
}

export function printCreatedFiles(files: Array<{ path: string; status: string }>) {
  console.log(`${COLOR.bold}TypeFetch init${COLOR.reset}\n`);
  for (const file of files) {
    const symbol = file.status === "created" ? `${COLOR.green}created${COLOR.reset}` : `${COLOR.yellow}${file.status}${COLOR.reset}`;
    console.log(`${symbol} ${file.path}`);
  }
}

export function printReleaseDoc(path: string, created: boolean) {
  const status = created ? `${COLOR.green}created${COLOR.reset}` : `${COLOR.yellow}skipped${COLOR.reset}`;
  console.log(`${status} ${path}`);
}

function printResultLine(item: ApiTestResult) {
  const status = getStatusDisplay(item.status);
  const endpoint = `${item.module}.${item.endpoint}`.padEnd(32);
  const method = item.method.padEnd(6);
  const phase = String(item.phase).padEnd(6);
  const duration = formatMs(item.durationMs).padStart(7);
  const suffix = item.status === "skipped"
    ? ` ${COLOR.dim}${item.skipReason ?? "skipped"}${COLOR.reset}`
    : item.status === "failed"
      ? ` ${COLOR.red}${item.error?.message ?? "failed"}${COLOR.reset}`
      : "";

  console.log(`${status} ${endpoint} ${phase} ${method} ${item.path} ${duration}${suffix}`);
}

function getStatusDisplay(status: ApiTestResult["status"]): string {
  switch (status) {
    case "passed":
      return `${COLOR.green}✓${COLOR.reset}`;
    case "failed":
      return `${COLOR.red}✕${COLOR.reset}`;
    case "skipped":
      return `${COLOR.yellow}-${COLOR.reset}`;
  }
}

function printTable(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const headerLine = headers.map((header, index) => header.padEnd(widths[index])).join("  ");
  console.log(`${COLOR.cyan}${headerLine}${COLOR.reset}`);
  console.log(widths.map((width) => "-".repeat(width)).join("  "));

  for (const row of rows) {
    console.log(row.map((cell, index) => cell.padEnd(widths[index])).join("  "));
  }
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}
