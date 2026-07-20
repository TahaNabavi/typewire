import { basename, dirname, extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { parseCliArgs } from "./parse-args";
import { loadCliConfig } from "./load-config";
import { runInitCommand } from "./init";
import {
  printCreatedFiles,
  printEndpointList,
  printHelp,
  printReleaseDoc,
  printReportSummary,
  printVersion,
} from "./print-result";
import { createApiTestRunner } from "@/modules/tester";
import { writeReportFiles } from "@/modules/tester/node-reporter";
import type {
  CliResolvedOptions,
  ParsedCliArgs,
  TypeFetchCliTestConfig,
  TypeFetchClientLike,
} from "./types";
import type {
  ApiTestReport,
  ApiTestReportFormat,
  ApiTestRunnerOptions,
} from "@/modules/tester";

export async function runCli(argv = process.argv): Promise<void> {
  const parsed = parseCliArgs(argv.slice(2));

  switch (parsed.command) {
    case "help": {
      printHelp();
      return;
    }

    case "version": {
      printVersion(await readPackageVersion());
      return;
    }

    case "init": {
      const created = await runInitCommand({
        force: getBooleanFlag(parsed, "force"),
        packageName: getStringFlag(parsed, "package"),
        contractsPath: getStringFlag(parsed, "contractsPath"),
        output: getStringFlag(parsed, "output"),
      });
      printCreatedFiles(created);
      return;
    }

    case "list": {
      const config = await loadCliConfig(getStringFlag(parsed, "config"));
      printEndpointList(config.contracts);
      return;
    }

    case "test":
    default: {
      const config = await loadCliConfig(getStringFlag(parsed, "config"));
      const resolved = resolveCliOptions(parsed);
      const client = await resolveClient(config, resolved);

      client.init?.();

      const options: ApiTestRunnerOptions = {
        ...(config.options ?? {}),
        ...compact({
          mode: resolved.mode,
          timeout: resolved.timeout,
          includeTags: resolved.includeTags,
          excludeTags: resolved.excludeTags,
          includeDestructive: resolved.includeDestructive,
          stopOnFail: resolved.stopOnFail,
        }),
      };

      const report = await createApiTestRunner({
        contracts: config.contracts,
        client,
        context: config.context,
        options,
      }).run();

      const reportPaths = await writeReports(report, config, resolved);
      printReportSummary(report, reportPaths);

      if (report.summary.failed > 0) process.exitCode = 1;
    }
  }
}

async function resolveClient(
  config: TypeFetchCliTestConfig,
  options: CliResolvedOptions,
): Promise<TypeFetchClientLike> {
  if (config.createClient) {
    return config.createClient({
      baseUrl: options.baseUrl,
      token: options.token,
    });
  }

  if (config.client) return config.client;

  throw new Error("TypeFetch config must provide client or createClient");
}

function resolveCliOptions(parsed: ParsedCliArgs): CliResolvedOptions {
  return {
    config: getStringFlag(parsed, "config"),
    mode: getStringFlag(parsed, "mode") as CliResolvedOptions["mode"],
    baseUrl: getStringFlag(parsed, "baseUrl") ?? process.env.API_BASE_URL,
    token: getStringFlag(parsed, "token") ?? process.env.API_TOKEN,
    timeout: getNumberFlag(parsed, "timeout"),
    includeTags: getCsvFlag(parsed, "includeTags"),
    excludeTags: getCsvFlag(parsed, "excludeTags"),
    includeDestructive: getOptionalBooleanFlag(parsed, "includeDestructive"),
    stopOnFail: getOptionalBooleanFlag(parsed, "stopOnFail"),
    output: getStringFlag(parsed, "output"),
    formats: getFormatsFlag(parsed),
  };
}

async function writeReports(
  report: ApiTestReport,
  config: TypeFetchCliTestConfig,
  options: CliResolvedOptions,
): Promise<string[]> {
  const output =
    options.output ?? config.report?.output ?? "./typefetch-report/report";
  const formats = options.formats ?? config.report?.formats ?? ["markdown"];

  const paths = formats.map((format) => getReportPath(output, format));
  for (const path of paths) await writeReportFiles(report, path);

  return paths;
}

function getReportPath(output: string, format: ApiTestReportFormat): string {
  const extension = getExtension(format);
  const currentExtension = extname(output).toLowerCase();

  if ([".md", ".json", ".html"].includes(currentExtension)) {
    if (currentExtension === extension) return output;

    const folder = dirname(output);
    const name = basename(output, currentExtension);
    return join(folder, `${name}${extension}`);
  }

  return `${output}${extension}`;
}

function getExtension(format: ApiTestReportFormat): ".md" | ".json" | ".html" {
  switch (format) {
    case "json":
      return ".json";
    case "html":
      return ".html";
    case "markdown":
    default:
      return ".md";
  }
}

function getFormatsFlag(
  parsed: ParsedCliArgs,
): ApiTestReportFormat[] | undefined {
  const fromFormat = getCsvFlag(parsed, "format");
  const fromFormats = getCsvFlag(parsed, "formats");
  const values = fromFormat ?? fromFormats;
  if (!values) return undefined;

  const allowed = new Set(["markdown", "json", "html"]);
  for (const value of values) {
    if (!allowed.has(value)) {
      throw new Error(`Invalid report format: ${value}`);
    }
  }

  return values as ApiTestReportFormat[];
}

function getStringFlag(parsed: ParsedCliArgs, key: string): string | undefined {
  const value = parsed.flags[key];
  if (Array.isArray(value)) return value.at(-1);
  if (typeof value === "boolean") return value ? "true" : undefined;
  return value;
}

function getNumberFlag(parsed: ParsedCliArgs, key: string): number | undefined {
  const value = getStringFlag(parsed, key);
  if (value === undefined) return undefined;

  const number = Number(value);
  if (!Number.isFinite(number))
    throw new Error(`Invalid number for --${key}: ${value}`);
  return number;
}

function getCsvFlag(parsed: ParsedCliArgs, key: string): string[] | undefined {
  const value = parsed.flags[key];
  if (value === undefined) return undefined;

  const values = Array.isArray(value) ? value : [String(value)];
  const parts = values.flatMap((item) => item.split(","));
  const cleaned = parts.map((item) => item.trim()).filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}

function getBooleanFlag(parsed: ParsedCliArgs, key: string): boolean {
  return getOptionalBooleanFlag(parsed, key) ?? false;
}

function getOptionalBooleanFlag(
  parsed: ParsedCliArgs,
  key: string,
): boolean | undefined {
  const value = parsed.flags[key];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;

  const normalized = Array.isArray(value) ? value.at(-1) : value;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "1") return true;
  if (normalized === "0") return false;

  return Boolean(normalized);
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) (result as Record<string, unknown>)[key] = entry;
  }
  return result;
}

async function readPackageVersion(): Promise<string> {
  try {
    const packageJsonPath = join(process.cwd(), "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      version?: string;
    };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
