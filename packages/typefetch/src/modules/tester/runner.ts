import { z } from "zod";
import type {
  Contracts,
  EndpointDefZ,
  EndpointTestCase,
  EndpointTestConfig,
  RequestOptions,
} from "@/types";
import { TypeFetchTestContext } from "./context";
import { generateInput } from "./generate-input";
import type {
  ApiTestMode,
  ApiTestReport,
  ApiTestResult,
  ApiTestRunnerConfig,
  ApiTestRunnerOptions,
  DiscoveredEndpoint,
} from "./types";

const DEFAULT_OPTIONS: Required<Pick<ApiTestRunnerOptions, "mode" | "timeout" | "concurrency" | "stopOnFail" | "includeDestructive">> = {
  mode: "live",
  timeout: 10_000,
  concurrency: 1,
  stopOnFail: false,
  includeDestructive: false,
};

export function createApiTestRunner<C extends Contracts>(
  config: ApiTestRunnerConfig<C>,
): ApiTestRunner<C> {
  return new ApiTestRunner(config);
}

export class ApiTestRunner<C extends Contracts> {
  private readonly ctx: TypeFetchTestContext;
  private readonly options: ApiTestRunnerOptions & typeof DEFAULT_OPTIONS;

  constructor(private readonly config: ApiTestRunnerConfig<C>) {
    this.ctx = new TypeFetchTestContext(config.context);
    this.options = {
      ...DEFAULT_OPTIONS,
      ...(config.options ?? {}),
    };
  }

  async run(): Promise<ApiTestReport> {
    const startedAt = Date.now();
    const endpoints = this.discoverEndpoints();
    const results: ApiTestResult[] = [];

    for (const item of endpoints) {
      const endpointResults = await this.runEndpoint(item);
      results.push(...endpointResults);

      if (this.options.stopOnFail && endpointResults.some((result) => result.status === "failed")) {
        break;
      }
    }

    const durationMs = Date.now() - startedAt;
    return {
      generatedAt: new Date().toISOString(),
      mode: this.options.mode,
      summary: {
        total: results.length,
        passed: results.filter((item) => item.status === "passed").length,
        failed: results.filter((item) => item.status === "failed").length,
        skipped: results.filter((item) => item.status === "skipped").length,
        durationMs,
      },
      results,
    };
  }

  private discoverEndpoints(): DiscoveredEndpoint[] {
    const endpoints: DiscoveredEndpoint[] = [];

    for (const moduleName of Object.keys(this.config.contracts)) {
      const module = this.config.contracts[moduleName];
      for (const endpointName of Object.keys(module)) {
        endpoints.push({
          moduleName,
          endpointName,
          endpoint: module[endpointName] as EndpointDefZ,
        });
      }
    }

    return endpoints;
  }

  private async runEndpoint(item: DiscoveredEndpoint): Promise<ApiTestResult[]> {
    const { endpoint } = item;
    const testConfig = endpoint.test as EndpointTestConfig<any, any> | undefined;
    const tags = [...(testConfig?.tags ?? [])];
    const destructive = Boolean(testConfig?.destructive);

    const baseMeta = {
      module: item.moduleName,
      endpoint: item.endpointName,
      method: endpoint.method,
      path: endpoint.path,
      tags,
      destructive,
    };

    const skipReason = this.getEndpointSkipReason(testConfig);
    if (skipReason) {
      return [
        {
          ...baseMeta,
          caseName: "default",
          phase: this.options.mode,
          status: "skipped",
          durationMs: 0,
          skipReason,
        },
      ];
    }

    try {
      await testConfig?.setup?.(this.ctx);
    } catch (error) {
      return [
        {
          ...baseMeta,
          caseName: "setup",
          phase: this.options.mode,
          status: "failed",
          durationMs: 0,
          error: normalizeError(error),
        },
      ];
    }

    const cases = this.getCases(endpoint, testConfig);
    const results: ApiTestResult[] = [];

    for (let index = 0; index < cases.length; index++) {
      const testCase = cases[index];
      const caseName = testCase.name ?? `case-${index + 1}`;

      if (testCase.skip) {
        results.push({
          ...baseMeta,
          caseName,
          phase: this.options.mode,
          status: "skipped",
          durationMs: 0,
          skipReason: typeof testCase.skip === "string" ? testCase.skip : "Case skipped",
        });
        continue;
      }

      const phases = this.getPhases(endpoint);
      for (const phase of phases) {
        const result = await this.runCasePhase(item, testCase, caseName, phase);
        results.push(result);

        if (this.options.stopOnFail && result.status === "failed") break;
      }
    }

    try {
      await testConfig?.teardown?.(this.ctx);
    } catch (error) {
      results.push({
        ...baseMeta,
        caseName: "teardown",
        phase: this.options.mode,
        status: "failed",
        durationMs: 0,
        error: normalizeError(error),
      });
    }

    return results;
  }

  private getEndpointSkipReason(testConfig?: EndpointTestConfig<any, any>): string | undefined {
    if (testConfig?.enabled === false) return "Endpoint tests disabled";
    if (testConfig?.destructive && !this.options.includeDestructive) return "Destructive endpoint skipped";

    const tags = testConfig?.tags ?? [];
    if (this.options.includeTags?.length && !tags.some((tag) => this.options.includeTags!.includes(tag))) {
      return "Endpoint does not match includeTags";
    }

    if (this.options.excludeTags?.length && tags.some((tag) => this.options.excludeTags!.includes(tag))) {
      return "Endpoint matches excludeTags";
    }

    return undefined;
  }

  private getCases(
    endpoint: EndpointDefZ,
    testConfig?: EndpointTestConfig<any, any>,
  ): Array<EndpointTestCase<any, any>> {
    if (testConfig?.cases?.length) return testConfig.cases;
    if (testConfig?.input) return [{ name: "default", input: testConfig.input }];

    return [
      {
        name: "auto-generated",
        input: generateInput(endpoint.request, this.options.autoInput),
      },
    ];
  }

  private getPhases(endpoint: EndpointDefZ): Array<"schema" | "mock" | "live"> {
    switch (this.options.mode as ApiTestMode) {
      case "schema":
        return ["schema"];
      case "mock":
        return ["mock"];
      case "full":
        return endpoint.mockData ? ["schema", "mock", "live"] : ["schema", "live"];
      case "live":
      default:
        return ["live"];
    }
  }

  private async runCasePhase(
    item: DiscoveredEndpoint,
    testCase: EndpointTestCase<any, any>,
    caseName: string,
    phase: "schema" | "mock" | "live",
  ): Promise<ApiTestResult> {
    const { endpoint, moduleName, endpointName } = item;
    const startedAt = Date.now();
    let input: unknown;

    const meta = {
      module: moduleName,
      endpoint: endpointName,
      caseName,
      phase,
      method: endpoint.method,
      path: endpoint.path,
      tags: endpoint.test?.tags ?? [],
      destructive: Boolean(endpoint.test?.destructive),
    };

    try {
      input = await resolveInput(endpoint, testCase, this.ctx, this.options.autoInput);
      const parsedInput = endpoint.request.parse(input);

      if (phase === "schema") {
        return {
          ...meta,
          status: "passed",
          durationMs: Date.now() - startedAt,
          input: parsedInput,
        };
      }

      if (phase === "mock") {
        if (!endpoint.mockData) {
          return {
            ...meta,
            status: "skipped",
            durationMs: Date.now() - startedAt,
            input: parsedInput,
            skipReason: "No mockData configured for endpoint",
          };
        }

        const mockResponse = typeof endpoint.mockData === "function" ? endpoint.mockData() : endpoint.mockData;
        const parsedResponse = endpoint.response.parse(mockResponse);
        await testCase.expect?.({ input: parsedInput, response: parsedResponse, ctx: this.ctx });

        return {
          ...meta,
          status: "passed",
          durationMs: Date.now() - startedAt,
          input: parsedInput,
          response: parsedResponse,
        };
      }

      const response = await this.callClient(moduleName, endpointName, parsedInput, testCase);
      await testCase.expect?.({ input: parsedInput, response, ctx: this.ctx });

      return {
        ...meta,
        status: "passed",
        durationMs: Date.now() - startedAt,
        input: parsedInput,
        response,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      const expectedStatuses = toStatusList(testCase.expectStatus);
      const expectedErrorStatus = normalized.status && expectedStatuses.includes(normalized.status);

      if (expectedErrorStatus) {
        return {
          ...meta,
          status: "passed",
          durationMs: Date.now() - startedAt,
          input,
          error: normalized,
        };
      }

      return {
        ...meta,
        status: "failed",
        durationMs: Date.now() - startedAt,
        input,
        error: normalized,
      };
    }
  }

  private async callClient(
    moduleName: string,
    endpointName: string,
    input: unknown,
    testCase: EndpointTestCase<any, any>,
  ): Promise<unknown> {
    const fn = this.config.client.modules[moduleName]?.[endpointName];
    if (!fn) throw new Error(`Client method not found: ${moduleName}.${endpointName}`);

    const requestOptions: RequestOptions = {
      ...(this.options.requestOptions ?? {}),
      timeout: testCase.timeout ?? this.options.timeout,
    };

    return fn(input, requestOptions);
  }
}

async function resolveInput(
  endpoint: EndpointDefZ,
  testCase: EndpointTestCase<any, any>,
  ctx: TypeFetchTestContext,
  autoInputOptions: ApiTestRunnerOptions["autoInput"],
): Promise<unknown> {
  if (typeof testCase.input === "function") return testCase.input(ctx);
  if (testCase.input !== undefined) return testCase.input;
  return generateInput(endpoint.request, autoInputOptions);
}

function normalizeError(error: unknown) {
  if (error instanceof z.ZodError) {
    const zodError = error as z.ZodError;
    return {
      name: zodError.name,
      message: `Validation error: ${zodError.issues.map((issue) => issue.message).join(", ")}`,
      code: "VALIDATION_ERROR",
      issues: zodError.issues,
      stack: zodError.stack,
    };
  }

  if (error instanceof Error) {
    const anyError = error as any;
    return {
      name: error.name,
      message: error.message,
      status: anyError.status,
      code: anyError.code,
      issues: anyError.issues ?? anyError.errors,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

function toStatusList(status?: number | number[]): number[] {
  if (status === undefined) return [];
  return Array.isArray(status) ? status : [status];
}
