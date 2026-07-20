import type { Contracts, RequestOptions } from "../types";
import type {
  ApiTestMode,
  ApiTestReportFormat,
  ApiTestRunnerOptions,
} from "@/modules/tester";

export type TypeFetchCliCommand =
  | "test"
  | "list"
  | "init"
  | "release-doc"
  | "help"
  | "version";

export type ParsedCliArgs = {
  command: TypeFetchCliCommand;
  flags: Record<string, string | boolean | string[]>;
  positionals: string[];
  raw: string[];
};

export type TypeFetchClientLike = {
  init?: () => void;
  modules: Record<
    string,
    Record<string, (input: any, options?: RequestOptions) => Promise<any>>
  >;
};

export type TypeFetchCreateClientOptions = {
  baseUrl?: string;
  token?: string;
};

export type TypeFetchReportConfig = {
  /** Path base or full file path. Examples: ./typefetch-report/report or ./typefetch-report/report.md */
  output?: string;
  formats?: ApiTestReportFormat[];
};

export type TypeFetchCliTestConfig<C extends Contracts = Contracts> = {
  contracts: C;

  /** Use client for simple projects. */
  client?: TypeFetchClientLike;

  /** Prefer createClient when you want CLI flags like --base-url and --token to work. */
  createClient?: (
    options: TypeFetchCreateClientOptions,
  ) => TypeFetchClientLike | Promise<TypeFetchClientLike>;

  options?: ApiTestRunnerOptions;
  context?: Record<string, unknown>;
  report?: TypeFetchReportConfig;
};

export type CliResolvedOptions = {
  mode?: ApiTestMode;
  baseUrl?: string;
  token?: string;
  timeout?: number;
  includeTags?: string[];
  excludeTags?: string[];
  includeDestructive?: boolean;
  stopOnFail?: boolean;
  output?: string;
  formats?: ApiTestReportFormat[];
  config?: string;
};

export type InitCommandOptions = {
  force?: boolean;
  packageName?: string;
  contractsPath?: string;
  output?: string;
};

export type ReleaseDocCommandOptions = {
  force?: boolean;
  version?: string;
  outputDir?: string;
  title?: string;
};
