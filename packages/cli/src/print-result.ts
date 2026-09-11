import type { ApiTestReport, ApiTestResult } from '@tahanabavi/typefetch'
import type {
  Contracts,
  EndpointDefZ,
  TransportAdapter,
} from '@tahanabavi/typefetch'
import { describeEndpoint, httpTransport } from '@tahanabavi/typefetch'

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

const PLAIN: typeof ANSI = {
  reset: '',
  dim: '',
  red: '',
  green: '',
  yellow: '',
  cyan: '',
  bold: '',
}

/**
 * Escape codes only where they will be rendered.
 *
 * `docs/CLI.md` §4 makes this non-negotiable: piped into a file, or read back
 * out of a CI log, `\x1b[32m✓` is noise that breaks grep. Read per access
 * rather than once at import so a long-lived process — and a test — sees the
 * current environment.
 */
function colors(): typeof ANSI {
  const disabled =
    Boolean(process.env.NO_COLOR) ||
    Boolean(process.env.CI) ||
    !process.stdout.isTTY

  return disabled ? PLAIN : ANSI
}

export function printHelp() {
  console.log(`TypeWire CLI

Usage:
  typewire test [options]
  typewire list [options]
  typewire init [options]
  typewire release-doc --version v1.6.0 [options]

Commands:
  test          Run contract-driven API tests and generate reports
  list          List discovered endpoints from the TypeWire config
  init          Detect the project, ask what it needs, and wire it up
  release-doc   Create a release documentation template in docs/releases

Test options:
  -c, --config <path>              Config file path
      --project <a,b>              Only these projects (default: all)
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
  -o, --output <path>              Example: ./typewire-report/report

Init options:
      --yes                        Take every detected default, ask nothing
      --features <a,b>             Skip the question: typefetch, query, typesocket,
                                   devtools, graphql, grpc, permission, encryption, nestjs
      --contracts-path <path>      Use contracts you already have
      --output <dir>               Scaffold somewhere other than the project root
      --dry-run                    Print the plan, write nothing
      --force                      Replace existing files instead of skipping them

Release doc options:
      --version <version>          Example: v1.6.0
      --title <title>
      --output-dir <path>          Default: ./docs/releases
      --force

Exit codes:
  0  success        1  findings        2  misconfiguration

Examples:
  typewire init
  typewire init --yes --features query,devtools
  typewire test --mode full --output ./typewire-report/report --format markdown,json,html
  typewire list --config ./typewire.config.ts
  typewire list --project admin
  typewire test --project dashboard,admin
  typewire release-doc --version v1.6.0 --title "Testing Feature"
`)
}

export function printVersion(version: string) {
  console.log(version)
}

export function printEndpointList(
  contracts: Contracts,
  transports: TransportAdapter[] = [],
  options: { project?: string } = {}
) {
  const COLOR = colors()
  const rows: Array<[string, string, string, string, string]> = []
  const adapters = [httpTransport as TransportAdapter, ...transports]
  const unresolved = new Set<string>()

  for (const moduleName of Object.keys(contracts)) {
    const module = contracts[moduleName]
    if (!module) continue
    for (const endpointName of Object.keys(module)) {
      const endpoint = module[endpointName] as EndpointDefZ
      // Asked of the transport rather than read off the endpoint: `method` and
      // `path` exist only on http routes once other transports are installed.
      const route = describeEndpoint(endpoint, adapters)

      if (route.target === '?') {
        unresolved.add((endpoint as { transport?: string }).transport ?? '?')
      }

      rows.push([
        `${moduleName}.${endpointName}`,
        route.protocol,
        route.operation,
        route.target,
        endpoint.test?.enabled === false
          ? 'disabled'
          : endpoint.test?.destructive
            ? 'destructive'
            : 'enabled',
      ])
    }
  }

  console.log(
    `\n${COLOR.bold}TypeFetch endpoints${COLOR.reset}` +
      (options.project
        ? ` ${COLOR.dim}· project ${options.project}${COLOR.reset}`
        : '') +
      '\n'
  )
  printTable(['Endpoint', 'Transport', 'Operation', 'Target', 'State'], rows)
  console.log(`\nTotal: ${rows.length}`)

  // A silent `?` is the worst outcome here: the listing looks complete and is
  // not. Name the transport and how to resolve it.
  if (unresolved.size) {
    console.log(
      `\n${COLOR.yellow}${unresolved.size} transport(s) could not be described: ` +
        `${[...unresolved].join(', ')}.${COLOR.reset}\n` +
        `${COLOR.dim}Add their adapters to the typefetch section so contracts-only ` +
        `commands can resolve them:\n` +
        `  typefetch: { contracts, transports: [grpcTransport()] }${COLOR.reset}`
    )
  }
}

export function printReportSummary(
  report: ApiTestReport,
  reportPaths: string[],
  options: { project?: string } = {}
) {
  const COLOR = colors()
  console.log(
    `\n${COLOR.bold}TypeFetch Test Runner${COLOR.reset}` +
      (options.project
        ? ` ${COLOR.dim}· project ${options.project}${COLOR.reset}`
        : '')
  )
  console.log(`${COLOR.dim}Mode:${COLOR.reset} ${report.mode}`)
  console.log(`${COLOR.dim}Generated:${COLOR.reset} ${report.generatedAt}\n`)

  for (const item of report.results) {
    printResultLine(item)
  }

  console.log(`\n${COLOR.bold}Summary${COLOR.reset}`)
  console.log(`Total:   ${report.summary.total}`)
  console.log(`${COLOR.green}Passed:${COLOR.reset}  ${report.summary.passed}`)
  console.log(`${COLOR.red}Failed:${COLOR.reset}  ${report.summary.failed}`)
  console.log(`${COLOR.yellow}Skipped:${COLOR.reset} ${report.summary.skipped}`)
  console.log(`Duration: ${formatMs(report.summary.durationMs)}`)

  if (reportPaths.length) {
    console.log(`\n${COLOR.bold}Reports${COLOR.reset}`)
    for (const path of reportPaths) console.log(`- ${path}`)
  }
}

export function printReleaseDoc(path: string, created: boolean) {
  const COLOR = colors()
  const status = created
    ? `${COLOR.green}created${COLOR.reset}`
    : `${COLOR.yellow}skipped${COLOR.reset}`

  console.log(`${status} ${path}`)
  if (!created) {
    console.log(
      `${COLOR.dim}It already exists. Pass --force to replace it.${COLOR.reset}`
    )
  }
}

function printResultLine(item: ApiTestResult) {
  const COLOR = colors()
  const status = getStatusDisplay(item.status)
  const endpoint = `${item.module}.${item.endpoint}`.padEnd(32)
  const method = item.method.padEnd(6)
  const phase = String(item.phase).padEnd(6)
  const duration = formatMs(item.durationMs).padStart(7)
  const suffix =
    item.status === 'skipped'
      ? ` ${COLOR.dim}${item.skipReason ?? 'skipped'}${COLOR.reset}`
      : item.status === 'failed'
        ? ` ${COLOR.red}${item.error?.message ?? 'failed'}${COLOR.reset}`
        : ''

  console.log(
    `${status} ${endpoint} ${phase} ${method} ${item.path} ${duration}${suffix}`
  )
}

function getStatusDisplay(status: ApiTestResult['status']): string {
  const COLOR = colors()
  switch (status) {
    case 'passed':
      return `${COLOR.green}✓${COLOR.reset}`
    case 'failed':
      return `${COLOR.red}✕${COLOR.reset}`
    case 'skipped':
      return `${COLOR.yellow}-${COLOR.reset}`
  }
}

function printTable(headers: string[], rows: string[][]) {
  const COLOR = colors()
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
  )
  const headerLine = headers
    .map((header, index) => header.padEnd(widths[index] ?? 0))
    .join('  ')
  console.log(`${COLOR.cyan}${headerLine}${COLOR.reset}`)
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))

  for (const row of rows) {
    console.log(
      row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ')
    )
  }
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
}
