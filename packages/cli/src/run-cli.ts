import { basename, dirname, extname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parseCliArgs } from './parse-args'
import {
  loadTypeWireConfig,
  requireProjectTypeFetch,
  resolveTypeFetchClient,
  selectProjects,
} from './config'
import { runInit } from './init'
import { runReleaseDocCommand } from './release-doc'
import {
  printEndpointList,
  printHelp,
  printReleaseDoc,
  printReportSummary,
  printVersion,
} from './print-result'
import { createApiTestRunner } from '@tahanabavi/typefetch'
import { writeReportFiles } from './node-reporter'
import type { ResolvedProject, ResolvedTypeFetchSection } from './config'
import type { CliResolvedOptions, ParsedCliArgs } from './types'
import type {
  ApiTestReport,
  ApiTestReportFormat,
  ApiTestRunnerOptions,
} from '@tahanabavi/typefetch'

export async function runCli(argv = process.argv): Promise<void> {
  const parsed = parseCliArgs(argv.slice(2))

  switch (parsed.command) {
    case 'help': {
      printHelp()
      return
    }

    case 'version': {
      printVersion(await readPackageVersion())
      return
    }

    case 'init': {
      await runInit({
        force: getBooleanFlag(parsed, 'force'),
        yes: getBooleanFlag(parsed, 'yes'),
        dryRun: getBooleanFlag(parsed, 'dryRun'),
        features: getCsvFlag(parsed, 'features'),
        contractsPath: getStringFlag(parsed, 'contractsPath'),
        output: getStringFlag(parsed, 'output'),
      })
      return
    }

    case 'release-doc': {
      const { path, created } = await runReleaseDocCommand({
        // `typewire release-doc v2.0.0` and `--version v2.0.0` both work; the
        // help has advertised the positional form since 1.6.0.
        version: parsed.positionals[0] ?? getStringFlag(parsed, 'version'),
        title: getStringFlag(parsed, 'title'),
        outputDir: getStringFlag(parsed, 'outputDir'),
        force: getBooleanFlag(parsed, 'force'),
      })
      printReleaseDoc(path, created)
      return
    }

    case 'list': {
      // No client is constructed here — listing endpoints reads contracts only.
      const config = await loadConfigFor(parsed, 'list')

      for (const project of selectProjects(
        config,
        getCsvFlag(parsed, 'project')
      )) {
        const section = requireProjectTypeFetch(project, 'list', config.path)
        printEndpointList(section.contracts, section.transports ?? [], {
          ...(project.implicit ? {} : { project: project.name }),
        })
      }
      return
    }

    case 'test':
    default: {
      const config = await loadConfigFor(parsed, 'test')
      const resolved = resolveCliOptions(parsed)
      const projects = selectProjects(config, getCsvFlag(parsed, 'project'))

      // Every project runs, and one failure anywhere fails the command. A gate
      // that checked one of three API surfaces and reported green would be
      // worse than no gate at all.
      for (const project of projects) {
        const section = requireProjectTypeFetch(project, 'test', config.path)

        const client = await resolveTypeFetchClient(
          section,
          'test',
          { baseUrl: resolved.baseUrl, token: resolved.token },
          config.path,
          project
        )

        client.init?.()

        const options: ApiTestRunnerOptions = {
          ...(section.test.options ?? {}),
          ...compact({
            mode: resolved.mode,
            timeout: resolved.timeout,
            includeTags: resolved.includeTags,
            excludeTags: resolved.excludeTags,
            includeDestructive: resolved.includeDestructive,
            stopOnFail: resolved.stopOnFail,
          }),
        }

        const report = await createApiTestRunner({
          contracts: section.contracts,
          client,
          context: section.test.context,
          options,
        }).run()

        const reportPaths = await writeReports(
          report,
          section,
          resolved,
          project
        )
        printReportSummary(report, reportPaths, {
          ...(project.implicit ? {} : { project: project.name }),
        })

        if (report.summary.failed > 0) process.exitCode = 1
      }
    }
  }
}

function loadConfigFor(parsed: ParsedCliArgs, command: string) {
  return loadTypeWireConfig({
    configPath: getStringFlag(parsed, 'config'),
    mode: getStringFlag(parsed, 'mode'),
    command,
  })
}

function resolveCliOptions(parsed: ParsedCliArgs): CliResolvedOptions {
  return {
    config: getStringFlag(parsed, 'config'),
    mode: getStringFlag(parsed, 'mode') as CliResolvedOptions['mode'],
    baseUrl: getStringFlag(parsed, 'baseUrl') ?? process.env.API_BASE_URL,
    token: getStringFlag(parsed, 'token') ?? process.env.API_TOKEN,
    timeout: getNumberFlag(parsed, 'timeout'),
    includeTags: getCsvFlag(parsed, 'includeTags'),
    excludeTags: getCsvFlag(parsed, 'excludeTags'),
    includeDestructive: getOptionalBooleanFlag(parsed, 'includeDestructive'),
    stopOnFail: getOptionalBooleanFlag(parsed, 'stopOnFail'),
    output: getStringFlag(parsed, 'output'),
    formats: getFormatsFlag(parsed),
  }
}

async function writeReports(
  report: ApiTestReport,
  section: ResolvedTypeFetchSection,
  options: CliResolvedOptions,
  project: ResolvedProject
): Promise<string[]> {
  const configured =
    options.output ?? section.test.report?.output ?? './typewire-report/report'
  const formats = options.formats ??
    section.test.report?.formats ?? ['markdown']

  // Each project gets its own folder. Without this, two projects sharing the
  // default output path silently overwrite each other and the last one wins —
  // a report that looks complete and describes one API.
  const output = project.implicit
    ? configured
    : join(dirname(configured), project.name, basename(configured))

  const paths = formats.map((format) => getReportPath(output, format))
  for (const path of paths) await writeReportFiles(report, path)

  return paths
}

function getReportPath(output: string, format: ApiTestReportFormat): string {
  const extension = getExtension(format)
  const currentExtension = extname(output).toLowerCase()

  if (['.md', '.json', '.html'].includes(currentExtension)) {
    if (currentExtension === extension) return output

    const folder = dirname(output)
    const name = basename(output, currentExtension)
    return join(folder, `${name}${extension}`)
  }

  return `${output}${extension}`
}

function getExtension(format: ApiTestReportFormat): '.md' | '.json' | '.html' {
  switch (format) {
    case 'json':
      return '.json'
    case 'html':
      return '.html'
    case 'markdown':
    default:
      return '.md'
  }
}

function getFormatsFlag(
  parsed: ParsedCliArgs
): ApiTestReportFormat[] | undefined {
  const fromFormat = getCsvFlag(parsed, 'format')
  const fromFormats = getCsvFlag(parsed, 'formats')
  const values = fromFormat ?? fromFormats
  if (!values) return undefined

  const allowed = new Set(['markdown', 'json', 'html'])
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new Error(`Invalid report format: ${value}`)
    }
  }

  return values as ApiTestReportFormat[]
}

function getStringFlag(parsed: ParsedCliArgs, key: string): string | undefined {
  const value = parsed.flags[key]
  if (Array.isArray(value)) return value.at(-1)
  if (typeof value === 'boolean') return value ? 'true' : undefined
  return value
}

function getNumberFlag(parsed: ParsedCliArgs, key: string): number | undefined {
  const value = getStringFlag(parsed, key)
  if (value === undefined) return undefined

  const number = Number(value)
  if (!Number.isFinite(number))
    throw new Error(`Invalid number for --${key}: ${value}`)
  return number
}

function getCsvFlag(parsed: ParsedCliArgs, key: string): string[] | undefined {
  const value = parsed.flags[key]
  if (value === undefined) return undefined

  const values = Array.isArray(value) ? value : [String(value)]
  const parts = values.flatMap((item) => item.split(','))
  const cleaned = parts.map((item) => item.trim()).filter(Boolean)

  return cleaned.length ? cleaned : undefined
}

function getBooleanFlag(parsed: ParsedCliArgs, key: string): boolean {
  return getOptionalBooleanFlag(parsed, key) ?? false
}

function getOptionalBooleanFlag(
  parsed: ParsedCliArgs,
  key: string
): boolean | undefined {
  const value = parsed.flags[key]
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value

  const normalized = Array.isArray(value) ? value.at(-1) : value
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  if (normalized === '1') return true
  if (normalized === '0') return false

  return Boolean(normalized)
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Partial<T> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) (result as Record<string, unknown>)[key] = entry
  }
  return result
}

async function readPackageVersion(): Promise<string> {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version?: string
    }
    return packageJson.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
