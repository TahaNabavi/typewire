import { z } from "zod";
import type { Contracts, EndpointDefZ, Method, RequestOptions } from "@/types";

export type ApiTestMode = "schema" | "mock" | "live" | "full";
export type ApiTestStatus = "passed" | "failed" | "skipped";
export type ApiTestReportFormat = "json" | "markdown" | "html";

export type AutoInputValue = unknown | ((path: string) => unknown);

export type AutoInputOptions = {
  /** Maximum recursive generation depth for nested schemas. */
  maxDepth?: number;
  /** Prefer optional object fields when generating inputs. Default: true. */
  includeOptional?: boolean;
  /** Generate one item for arrays by default. Default: true. */
  includeArrayItems?: boolean;
  /** Overrides by full dot path, field name, or request part path. */
  values?: Record<string, AutoInputValue>;
  /** Custom fallback for files. Defaults to Blob when available, otherwise string. */
  fileFactory?: () => unknown;
};

export type ApiTestRunnerOptions = {
  mode?: ApiTestMode;
  timeout?: number;
  concurrency?: number;
  stopOnFail?: boolean;
  includeDestructive?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  autoInput?: AutoInputOptions;
  requestOptions?: RequestOptions;
};

export type ApiTestRunnerConfig<C extends Contracts = Contracts> = {
  contracts: C;
  /** Initialized ApiClient instance or compatible object with modules. */
  client: {
    modules: Record<string, Record<string, (input: any, options?: RequestOptions) => Promise<any>>>;
  };
  options?: ApiTestRunnerOptions;
  context?: Record<string, unknown>;
};

export type ApiTestCaseMeta = {
  module: string;
  endpoint: string;
  caseName: string;
  phase: ApiTestMode | "schema" | "mock" | "live";
  method: Method;
  path: string;
  tags: string[];
  destructive: boolean;
};

export type ApiTestError = {
  name?: string;
  message: string;
  status?: number;
  code?: string;
  issues?: unknown;
  stack?: string;
};

export type ApiTestResult = ApiTestCaseMeta & {
  status: ApiTestStatus;
  durationMs: number;
  input?: unknown;
  response?: unknown;
  error?: ApiTestError;
  skipReason?: string;
};

export type ApiTestReportSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
};

export type ApiTestReport = {
  generatedAt: string;
  mode: ApiTestMode;
  summary: ApiTestReportSummary;
  results: ApiTestResult[];
};

export type DiscoveredEndpoint = {
  moduleName: string;
  endpointName: string;
  endpoint: EndpointDefZ;
};

export type SchemaLike = z.ZodTypeAny & {
  _def?: any;
  def?: any;
  shape?: any;
  unwrap?: () => z.ZodTypeAny;
};
