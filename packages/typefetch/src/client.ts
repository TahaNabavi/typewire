import { z } from "zod";
import {
  Contracts,
  EndpointDef,
  EndpointDefZ,
  Middleware,
  ErrorLike,
  EndpointMethods,
  TokenProvider,
  RequestOptions,
  MiddlewareContext,
  InferError,
  Instrumentation,
  Override,
  RequestEvent,
} from "./types";

export class RichError extends Error implements ErrorLike {
  status?: number;
  code?: string;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
  /**
   * Parsed error body. When the failed request's status matches a schema in
   * the endpoint's `errors` map, this holds the parsed/typed body; otherwise
   * it falls back to the raw JSON body.
   */
  data?: unknown;
  /**
   * Whether `data` was validated against the endpoint's declared schema for
   * this status. `true` only when a schema existed for `status` and the body
   * passed it — i.e. `data` is guaranteed to match the declared error type.
   * Absent/`false` when no schema was declared or the body failed validation
   * (fail-open: `data` then holds the raw JSON). `isContractError` requires
   * this to be `true`, so it never narrows to a type the body doesn't match.
   */
  dataParsed?: boolean;

  constructor(error: Partial<ErrorLike> & { message: string }) {
    super(error.message);
    Object.assign(this, error);
  }
}

/**
 * isContractError
 * ===============
 * Typed guard that narrows a caught error to a `RichError` of a specific
 * declared status, resolving the error body type from the endpoint's `errors`
 * map so `error.data` becomes fully typed at the point of use.
 *
 * TypeScript `catch` clauses are `unknown` and can't be narrowed by control
 * flow alone, so the guard references the endpoint to recover the body type
 * from the status literal.
 *
 * It narrows only when the error is a `RichError`, its `status` matches, AND
 * the body actually validated against the declared schema (`dataParsed`). The
 * last check keeps the narrowed type honest: if the server returns that status
 * with a body that doesn't match the contract, parsing fails open and this
 * returns `false` rather than claiming `data` has a shape it doesn't.
 *
 * @example
 * try {
 *   await api.user.createUser({ body });
 * } catch (e) {
 *   if (isContractError(contracts.user.createUser, e, 409)) {
 *     e.data.conflictField; // fully typed from the 409 schema
 *   }
 * }
 */
export function isContractError<
  E extends EndpointDefZ,
  S extends keyof NonNullable<E["errors"]> & number,
>(
  endpoint: E,
  error: unknown,
  status: S,
): error is RichError & { status: S; data: InferError<E, S> } {
  return (
    error instanceof RichError &&
    error.status === status &&
    error.dataParsed === true
  );
}

type ParsedRequestParts = {
  path?: Record<string, any>;
  query?: Record<string, any>;
  body?: any;
  headers: Record<string, string>;
  isStructured: boolean;
};

const REQUEST_PART_KEYS = new Set([
  "path",
  "query",
  "body",
  "headers",
  "header",
]);

export class ApiClient<C extends Contracts, E extends ErrorLike = RichError> {
  private middlewares: Array<{ fn: Middleware; options?: any }> = [];
  private errorHandler?: (error: E) => void;
  private responseTransform: (data: any) => any = (d) => d;
  private useMockData = false;
  private mockDelay = { min: 100, max: 1000 };
  private responseWrapper?: (successResponse: z.ZodTypeAny) => z.ZodTypeAny;
  private tokenProvider?: TokenProvider;
  private instrumentations: Instrumentation[] = [];
  private requestCounter = 0;

  private retryConfig?: {
    maxRetries: number;
    backoff: "fixed" | "linear" | "exponential";
    retryCondition?: (error: RichError, attempt: number) => boolean;
  };

  private _modules!: { [M in keyof C]: EndpointMethods<C[M]> };

  constructor(
    private config: {
      baseUrl: string;
      token?: string;
      tokenProvider?: TokenProvider;
      useMockData?: boolean;
      mockDelay?: { min: number; max: number };
    },
    private contracts: C,
  ) {
    this.useMockData = config.useMockData || false;
    this.mockDelay = config.mockDelay || { min: 100, max: 1000 };
    this.tokenProvider = config.tokenProvider;
  }

  init() {
    const modules = {} as { [M in keyof C]: EndpointMethods<C[M]> };

    for (const moduleName in this.contracts) {
      const module = this.contracts[moduleName];
      (modules as any)[moduleName] = {} as EndpointMethods<typeof module>;

      for (const endpointName in module) {
        const endpoint = module[endpointName] as EndpointDefZ;
        const endpointId = `${moduleName}.${endpointName}`;

        const method = (input: any, options?: RequestOptions) =>
          this.request(endpoint as any, input, options, endpointId);
        // Attach stable, additive metadata used by higher layers (query
        // engines, devtools) to key cache/events and read the contract schemas.
        (method as any).endpointId = endpointId;
        (method as any).endpoint = endpoint;

        (modules as any)[moduleName][endpointName] = method;
      }
    }

    this._modules = modules;
  }

  get modules() {
    return this._modules;
  }

  use<T>(middleware: Middleware<any, any, T>, options?: T) {
    this.middlewares.push({ fn: middleware, options });
  }

  /**
   * Register an instrumentation hook. Returns an unsubscribe function.
   *
   * Instrumentation is the single additive extension point for observing and
   * (optionally) overriding requests at runtime — used by the framework-agnostic
   * query engine and the devtools bridge. When no hook is registered, request
   * handling is identical to the un-instrumented path.
   */
  instrument(hook: Instrumentation): () => void {
    this.instrumentations.push(hook);
    return () => {
      const index = this.instrumentations.indexOf(hook);
      if (index >= 0) this.instrumentations.splice(index, 1);
    };
  }

  onError(handler: (error: E) => void) {
    this.errorHandler = handler;
  }

  useResponseTransform(fn: (data: any) => any) {
    this.responseTransform = fn;
  }

  setRetryConfig(config: ApiClient<C>["retryConfig"]) {
    this.retryConfig = config;
  }

  setTokenProvider(provider: TokenProvider) {
    this.tokenProvider = provider;
  }

  setMockMode(enabled: boolean, delay?: { min: number; max: number }) {
    this.useMockData = enabled;
    if (delay) this.mockDelay = delay;
  }

  setResponseWrapper(wrapper: (successResponse: z.ZodTypeAny) => z.ZodTypeAny) {
    this.responseWrapper = wrapper;
  }

  async getCurrentToken(): Promise<string | undefined> {
    if (this.tokenProvider) return await this.tokenProvider();
    return this.config.token;
  }

  private async request<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, TRes>,
    input: z.infer<TReq>,
    options?: RequestOptions,
    endpointId = "",
  ): Promise<z.infer<TRes>> {
    // Resolve a runtime override (devtools) without mutating the contract.
    const override = this.resolveOverride(endpointId, input);
    const activeEndpoint = this.applyOverrideSchemas(endpoint, override);

    const parsedInput = activeEndpoint.request.parse(input);

    const trace = this.startTrace(endpointId, activeEndpoint, parsedInput);

    try {
      if (override?.latencyMs) {
        await new Promise((r) => setTimeout(r, override.latencyMs));
      }

      // Forced error: behave like a real failing endpoint (errorHandler fires).
      if (override?.error) {
        const error = this.createError({
          message:
            override.error.message ??
            `Forced error for ${endpointId || activeEndpoint.path}`,
          status: override.error.status,
          code: override.error.code ?? "OVERRIDE_ERROR",
          data: override.error.body,
          dataParsed: false,
        });
        this.errorHandler?.(error as any);
        throw error;
      }

      // Forced mock (devtools): bypass the network regardless of mock mode.
      if (override && override.mock !== undefined) {
        const raw =
          typeof override.mock === "function"
            ? (override.mock as (i: unknown) => unknown)(parsedInput)
            : override.mock;
        const data = this.responseTransform(activeEndpoint.response.parse(raw));
        this.finishTrace(trace, data, true);
        return data;
      }

      // Configured mock mode — unchanged behavior.
      if (this.useMockData && activeEndpoint.mockData) {
        const data = await this.handleMockRequest(activeEndpoint);
        this.finishTrace(trace, data, true);
        return data;
      }

      const built = this.buildUrlAndBody(
        activeEndpoint as EndpointDefZ,
        parsedInput,
      );

      const data = await this.performRequestLogic(
        activeEndpoint,
        parsedInput,
        built.url,
        built.body,
        built.headers,
        built.parts,
        options,
      );
      this.finishTrace(trace, data, false);
      return data;
    } catch (err) {
      this.failTrace(trace, err);
      throw err;
    }
  }

  private resolveOverride(
    endpointId: string,
    input: unknown,
  ): Override | undefined {
    if (!this.instrumentations.length) return undefined;
    for (const hook of this.instrumentations) {
      const override = hook.resolveOverride?.(endpointId, input);
      if (override) return override;
    }
    return undefined;
  }

  private applyOverrideSchemas<
    TReq extends z.ZodTypeAny,
    TRes extends z.ZodTypeAny,
  >(
    endpoint: EndpointDef<TReq, TRes>,
    override: Override | undefined,
  ): EndpointDef<TReq, TRes> {
    if (!override || (!override.request && !override.response)) return endpoint;
    return {
      ...endpoint,
      request: (override.request ?? endpoint.request) as TReq,
      response: (override.response ?? endpoint.response) as TRes,
    };
  }

  private nowMs(): number {
    return typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  }

  private emit(event: RequestEvent) {
    for (const hook of this.instrumentations) hook.on?.(event);
  }

  private startTrace(
    endpointId: string,
    endpoint: EndpointDefZ,
    input: unknown,
  ): { requestId: string; endpointId: string; startedAt: number } | null {
    if (!this.instrumentations.length) return null;
    const requestId = `tf_${++this.requestCounter}`;
    const startedAt = this.nowMs();
    this.emit({
      type: "start",
      requestId,
      endpointId,
      method: endpoint.method,
      url: this.config.baseUrl + endpoint.path,
      input,
      timestamp: startedAt,
    });
    return { requestId, endpointId, startedAt };
  }

  private finishTrace(
    trace: { requestId: string; endpointId: string; startedAt: number } | null,
    data: unknown,
    fromMock: boolean,
  ) {
    if (!trace) return;
    this.emit({
      type: "success",
      requestId: trace.requestId,
      endpointId: trace.endpointId,
      data,
      durationMs: this.nowMs() - trace.startedAt,
      fromMock,
    });
  }

  private failTrace(
    trace: { requestId: string; endpointId: string; startedAt: number } | null,
    err: unknown,
  ) {
    if (!trace) return;
    const error = err instanceof RichError ? err : this.normalizeError(err);
    this.emit({
      type: "error",
      requestId: trace.requestId,
      endpointId: trace.endpointId,
      status: error.status,
      error,
      durationMs: this.nowMs() - trace.startedAt,
    });
  }

  private async performRequestLogic<
    TReq extends z.ZodTypeAny,
    TRes extends z.ZodTypeAny,
  >(
    endpoint: EndpointDef<TReq, TRes>,
    parsedInput: z.infer<TReq>,
    url: string,
    body: BodyInit | undefined,
    requestHeaders: Record<string, string>,
    requestParts: ParsedRequestParts,
    options?: RequestOptions,
  ): Promise<z.infer<TRes>> {
    const headers: Record<string, string> = {};

    if (endpoint.bodyType !== "form-data") {
      headers["Content-Type"] = "application/json";
    }

    const endpointHeaders =
      typeof endpoint.headers === "function"
        ? endpoint.headers(parsedInput)
        : endpoint.headers;

    Object.assign(
      headers,
      this.normalizeHeaders(endpointHeaders),
      requestHeaders,
    );

    if (endpoint.auth) {
      const token = await this.getCurrentToken();

      if (!token) {
        const error = this.createError({
          message: `Missing token for ${endpoint.path}`,
          status: 401,
          code: "NO_TOKEN",
        });
        this.errorHandler?.(error as any);
        throw error;
      }

      headers["Authorization"] = `Bearer ${token}`;
    }

    const ctx = {
      url,
      init: { method: endpoint.method, headers, body } as RequestInit,
      endpoint: endpoint as never,
      request: {
        ...requestParts,
        rawInput: parsedInput,
      },
    } satisfies MiddlewareContext;

    let controller: AbortController | undefined;
    let timeoutId: any;

    if (options?.timeout) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), options.timeout);
    }

    if (options?.signal || controller) {
      ctx.init.signal = options?.signal || controller?.signal;
    }

    const runner = this.middlewares.reduceRight(
      (next, mw) => () => mw.fn(ctx, next, mw.options),
      () => fetch(ctx.url, ctx.init),
    );

    const execute = async () => {
      const res = await runner();
      const json = await res.json();
      let responseData = json;

      if (this.responseWrapper) {
        const wrappedSchema = this.responseWrapper(endpoint.response);
        const parsedWrapped = wrappedSchema.parse(json) as any;

        if (parsedWrapped.success === false) {
          const error = this.createError({
            message:
              parsedWrapped.message || parsedWrapped.error || "Request failed",
            status: parsedWrapped.code || res.status,
            code: parsedWrapped.code
              ? `API_ERROR_${parsedWrapped.code}`
              : "API_ERROR",
          });

          this.errorHandler?.(error as any);
          throw error;
        }

        responseData = parsedWrapped.data;
      }

      if (!res.ok) {
        // Fail open: if a schema is declared for this status, parse and attach
        // the typed body; otherwise (no schema or parse failure) keep the raw
        // json. Error-typing must never throw and mask the real error.
        const errorSchema = (endpoint as EndpointDefZ).errors?.[res.status];
        const parsed = errorSchema?.safeParse(json);
        const error = this.createError({
          message: json.message || res.statusText,
          status: res.status,
          code: json.code,
          title: json.title,
          detail: json.detail,
          errors: json.errors,
          data: parsed?.success ? parsed.data : json,
          dataParsed: parsed?.success === true,
        });
        this.errorHandler?.(error as any);
        throw error;
      }

      const parsed = endpoint.response.parse(responseData);
      return this.responseTransform(parsed);
    };

    try {
      const result = await this.executeWithRetry(execute);
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      const error = this.normalizeError(err);
      this.errorHandler?.(error as any);
      throw error;
    }
  }

  private async executeWithRetry(fn: () => Promise<any>): Promise<any> {
    if (!this.retryConfig) return fn();

    const { maxRetries, backoff, retryCondition } = this.retryConfig;
    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        attempt++;
        const error = this.normalizeError(err);

        const shouldRetry =
          attempt <= maxRetries &&
          (retryCondition?.(error, attempt) ??
            (error.status !== undefined && error.status >= 500));

        if (!shouldRetry) throw error;

        const delay = this.getBackoffDelay(backoff, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private getBackoffDelay(
    type: "fixed" | "linear" | "exponential",
    attempt: number,
  ) {
    const base = 300;
    switch (type) {
      case "fixed":
        return base;
      case "linear":
        return base * attempt;
      case "exponential":
        return base * Math.pow(2, attempt - 1);
    }
  }

  private buildUrlAndBody(endpoint: EndpointDefZ, input: any) {
    const parts = this.extractRequestParts(input);

    let url = this.config.baseUrl + endpoint.path;
    url = this.applyPathParams(url, parts.path);
    url = this.appendQueryParams(url, parts.query);

    let body: BodyInit | undefined;
    const payload = parts.isStructured ? parts.body : input;

    if (endpoint.method !== "GET" && payload !== undefined) {
      if (endpoint.bodyType === "form-data") {
        if (typeof FormData !== "undefined" && payload instanceof FormData) {
          body = payload;
        } else {
          const form = new FormData();

          if (this.isObjectRecord(payload)) {
            for (const [key, value] of Object.entries(payload)) {
              this.appendFormValue(form, key, value);
            }
          } else if (payload != null) {
            form.append("value", String(payload));
          }

          body = form;
        }
      } else {
        body = JSON.stringify(payload);
      }
    }

    return { url, body, headers: parts.headers, parts };
  }

  private extractRequestParts(input: any): ParsedRequestParts {
    if (this.isStructuredRequestInput(input)) {
      return {
        path: this.isObjectRecord(input.path) ? input.path : undefined,
        query: this.isObjectRecord(input.query) ? input.query : undefined,
        body: input.body,
        headers: this.normalizeHeaders(input.headers ?? input.header),
        isStructured: true,
      };
    }

    return {
      body: input,
      headers: {},
      isStructured: false,
    };
  }

  private isStructuredRequestInput(
    input: unknown,
  ): input is Record<string, any> {
    if (!this.isObjectRecord(input)) return false;

    const keys = Object.keys(input);
    if (keys.length === 0) return false;

    return (
      keys.some((key) => REQUEST_PART_KEYS.has(key)) &&
      keys.every((key) => REQUEST_PART_KEYS.has(key))
    );
  }

  private isObjectRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private applyPathParams(
    fullUrl: string,
    pathParams?: Record<string, any>,
  ): string {
    const url = new URL(fullUrl);

    const replacedPathname = url.pathname.replace(
      /:([A-Za-z0-9_]+)/g,
      (_, key: string) => {
        const value = pathParams?.[key];

        if (value === undefined || value === null) {
          throw this.createError({
            message: `Missing path param "${key}"`,
            code: "MISSING_PATH_PARAM",
          });
        }

        return encodeURIComponent(String(value));
      },
    );

    return `${url.origin}${replacedPathname}${url.search}${url.hash}`;
  }

  private appendQueryParams(url: string, query?: Record<string, any>): string {
    if (!query) return url;

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      this.appendQueryValue(params, key, value);
    }

    const queryString = params.toString();
    if (!queryString) return url;

    return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
  }

  private appendQueryValue(params: URLSearchParams, key: string, value: any) {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      for (const item of value) this.appendQueryValue(params, key, item);
      return;
    }

    if (value instanceof Date) {
      params.append(key, value.toISOString());
      return;
    }

    if (typeof value === "object") {
      params.append(key, JSON.stringify(value));
      return;
    }

    params.append(key, String(value));
  }

  private appendFormValue(form: FormData, key: string, value: any) {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      for (const item of value) this.appendFormValue(form, key, item);
      return;
    }

    if (value instanceof Date) {
      form.append(key, value.toISOString());
      return;
    }

    const isBlob = typeof Blob !== "undefined" && value instanceof Blob;

    if (typeof value === "object" && !isBlob) {
      form.append(key, JSON.stringify(value));
      return;
    }

    form.append(key, value as any);
  }

  private normalizeHeaders(headers: unknown): Record<string, string> {
    if (!this.isObjectRecord(headers)) return {};

    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) continue;
      normalized[key] = String(value);
    }

    return normalized;
  }

  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError(error);
  }

  private normalizeError(err: any) {
    if (err instanceof RichError) return err;
    if (err instanceof z.ZodError) {
      return this.createError({
        message: `Validation error: ${err.issues.map((e) => e.message).join(", ")}`,
        code: "VALIDATION_ERROR",
      });
    }
    return this.createError({ message: err.message || "Unknown error" });
  }

  private async handleMockRequest(endpoint: any) {
    const delay =
      Math.floor(
        Math.random() * (this.mockDelay.max - this.mockDelay.min + 1),
      ) + this.mockDelay.min;

    await new Promise((r) => setTimeout(r, delay));

    const data =
      typeof endpoint.mockData === "function"
        ? endpoint.mockData()
        : endpoint.mockData;

    return this.responseTransform(endpoint.response.parse(data));
  }
}
