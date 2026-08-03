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
  ResponseType,
  TransferProgress,
} from "./types";
import { isXhrAvailable, xhrRequest } from "./transport/xhr";
import { safeProgress } from "./utils/progress";
import {
  decodeResponse,
  readErrorBody,
  withDownloadProgress,
} from "./utils/response-body";

/**
 * Response types whose bodies belong to the caller. Download progress and the
 * wrapper/transform pipeline both stay off these — counting bytes would mean
 * draining the stream the caller asked to own.
 */
const UNDRAINED_RESPONSE_TYPES = new Set<ResponseType>(["stream", "response"]);

/** Response types the `responseWrapper` / `responseTransform` pipeline applies to. */
const ENVELOPE_RESPONSE_TYPES = new Set<ResponseType>(["json", "text"]);

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

/** The correlation state one in-flight request carries for instrumentation. */
type RequestTrace = {
  requestId: string;
  endpointId: string;
  startedAt: number;
};

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
  /** Latches the one-time "no XMLHttpRequest here" warning. */
  private warnedNoXhr = false;

  /**
   * Errors already handed to `onError`.
   *
   * A `WeakSet` rather than a flag on the error, so nothing is added to an
   * object the caller inspects and a discarded error is still collectable. It
   * makes `report` idempotent per error instance, which keeps a rethrow through
   * an outer catch from producing a second call.
   */
  private readonly reportedErrors = new WeakSet<object>();

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
        throw this.report(
          this.createError({
            message:
              override.error.message ??
              `Forced error for ${endpointId || activeEndpoint.path}`,
            status: override.error.status,
            code: override.error.code ?? "OVERRIDE_ERROR",
            data: override.error.body,
            dataParsed: false,
          }),
        );
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
        trace,
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
  ): RequestTrace | null {
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
    trace: RequestTrace | null,
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
    trace: RequestTrace | null,
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
    trace?: RequestTrace | null,
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
        // Thrown before the request is under way, so it never reaches the catch
        // below and is reported here instead.
        throw this.report(
          this.createError({
            message: `Missing token for ${endpoint.path}`,
            status: 401,
            code: "NO_TOKEN",
          }),
        );
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

    const responseType: ResponseType =
      (endpoint as EndpointDefZ).responseType ?? "json";

    // Progress handlers are wired only when the caller asked for them — never
    // merely because instrumentation is attached. Opening devtools must not
    // change which transport a request uses or whether its body is re-streamed.
    const onUpload = this.withProgressEvents(options?.onUploadProgress, trace);
    const onDownload = this.withProgressEvents(
      options?.onDownloadProgress,
      trace,
    );

    const useXhr = Boolean(onUpload) && isXhrAvailable();
    if (onUpload && !useXhr) this.warnUploadProgressUnavailable();

    const runner = this.middlewares.reduceRight(
      (next, mw) => () => mw.fn(ctx, next, mw.options),
      useXhr
        ? () => xhrRequest(ctx.url, ctx.init, { onUploadProgress: onUpload })
        : () => fetch(ctx.url, ctx.init),
    );

    const execute = async () => {
      let res = await runner();

      // Failure is handled before any decoding. The declared `responseType`
      // describes the *success* body only — an endpoint returning a Blob still
      // reports its 404 as JSON — and reading the error body defensively is what
      // keeps a non-JSON failure (an HTML 502, an empty 401) reporting its
      // status instead of surfacing as a bare SyntaxError.
      if (!res.ok) {
        const { body: errorBody, wasJson } = await readErrorBody(res);

        // An envelope API answering `{ success: false, message }` alongside a
        // 4xx put its message here before this reordering, and that message is
        // the useful one. Consulted with `safeParse`, so a failure body that
        // doesn't fit the envelope falls through to the status-based error
        // instead of throwing a validation error over it.
        if (
          wasJson &&
          this.responseWrapper &&
          ENVELOPE_RESPONSE_TYPES.has(responseType)
        ) {
          const enveloped = this.responseWrapper(endpoint.response).safeParse(
            errorBody,
          );
          if (enveloped.success && (enveloped.data as any)?.success === false) {
            throw this.buildEnvelopeFailure(enveloped.data as any, res.status);
          }
        }

        throw this.buildFailure(endpoint as EndpointDefZ, res, errorBody);
      }

      if (onDownload && !UNDRAINED_RESPONSE_TYPES.has(responseType)) {
        res = withDownloadProgress(res, onDownload);
      }

      const decoded = await decodeResponse(res, responseType);

      // Envelopes and the global response transform are JSON/text concepts.
      // Unwrapping a Blob, or handing one to a transform written for records,
      // would corrupt exactly the payloads that motivated these response types.
      if (!ENVELOPE_RESPONSE_TYPES.has(responseType)) {
        return endpoint.response.parse(decoded);
      }

      let responseData = decoded;

      if (this.responseWrapper) {
        const wrappedSchema = this.responseWrapper(endpoint.response);
        const parsedWrapped = wrappedSchema.parse(decoded) as any;

        if (parsedWrapped.success === false) {
          throw this.buildEnvelopeFailure(parsedWrapped, res.status);
        }

        responseData = parsedWrapped.data;
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
      // The single reporting point for anything that fails once the request is
      // under way: HTTP failures, envelope failures, schema failures, network
      // errors, timeouts, and retry exhaustion.
      throw this.report(this.normalizeError(err));
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

  /**
   * Build the error for a non-2xx response.
   *
   * `errorBody` has already been read defensively — it is the parsed JSON when
   * the server sent JSON, and `{ detail: <raw text> }` when it sent anything
   * else — so every field read here is safe on an HTML or empty body.
   *
   * Fail open on typing: when a schema is declared for this status, parse and
   * attach the typed body; otherwise keep the raw body. Error-typing must never
   * throw and mask the real error.
   */
  private buildFailure(
    endpoint: EndpointDefZ,
    res: Response,
    errorBody: any,
  ): RichError {
    const errorSchema = endpoint.errors?.[res.status];
    const parsed = errorSchema?.safeParse(errorBody);

    const error = this.createError({
      message: errorBody.message || res.statusText || `HTTP ${res.status}`,
      status: res.status,
      code: errorBody.code,
      title: errorBody.title,
      detail: errorBody.detail,
      errors: errorBody.errors,
      data: parsed?.success ? parsed.data : errorBody,
      dataParsed: parsed?.success === true,
    });

    // Not reported here: this runs inside the retry loop, so an endpoint
    // configured with `maxRetries: 2` would fire `onError` three times for one
    // failed request. `performRequestLogic`'s catch reports it once, after
    // retries are exhausted.
    return error;
  }

  /** The error for an envelope that reports `success: false`. */
  private buildEnvelopeFailure(
    parsedWrapped: any,
    fallbackStatus: number,
  ): RichError {
    const error = this.createError({
      message: parsedWrapped.message || parsedWrapped.error || "Request failed",
      status: parsedWrapped.code || fallbackStatus,
      code: parsedWrapped.code ? `API_ERROR_${parsedWrapped.code}` : "API_ERROR",
    });

    // Reported by the catch in `performRequestLogic`; see `buildFailure`.
    return error;
  }

  /**
   * Wrap a caller's progress handler so each tick also reaches instrumentation.
   *
   * Returns `undefined` when the caller passed nothing — that absence is what
   * keeps the fetch path and the un-restreamed body in place, so a request
   * without progress behaves exactly as it did before this feature.
   */
  private withProgressEvents(
    handler: RequestOptions["onUploadProgress"],
    trace: RequestTrace | null | undefined,
  ) {
    if (!handler) return undefined;

    return (progress: TransferProgress) => {
      safeProgress(handler, progress);

      if (!trace || !this.instrumentations.length) return;
      this.emit({
        type: "progress",
        requestId: trace.requestId,
        endpointId: trace.endpointId,
        phase: progress.phase,
        loaded: progress.loaded,
        total: progress.total,
        percent: progress.percent,
        lengthComputable: progress.lengthComputable,
        durationMs: this.nowMs() - trace.startedAt,
      });
    };
  }

  /**
   * Warn once when upload progress was asked for somewhere it cannot work.
   *
   * Silently never calling the handler is the worst outcome: a progress bar
   * that sits at zero for a request that is in fact uploading fine reads as a
   * hung app. Warning once — not per request — keeps an SSR render or a test
   * suite from flooding the log.
   */
  private warnUploadProgressUnavailable() {
    if (this.warnedNoXhr) return;
    this.warnedNoXhr = true;
    console.warn(
      "[typefetch] onUploadProgress was provided, but XMLHttpRequest is not " +
        "available in this environment (Node/SSR). The request still runs over " +
        "fetch, which cannot report upload progress, so the handler will not be " +
        "called.",
    );
  }

  /**
   * Hand an error to `onError`, at most once per error instance.
   *
   * Every failure path routes through here rather than calling `errorHandler`
   * directly. `onError` is a global handler — the thing that fires a toast or
   * redirects on a 401 — so it must fire exactly once per failed request, not
   * once per layer that happens to see the error on its way out.
   *
   * Returns the error so call sites can `throw this.report(...)`.
   */
  private report(error: RichError): RichError {
    if (!this.errorHandler) return error;
    if (this.reportedErrors.has(error)) return error;

    this.reportedErrors.add(error);
    this.errorHandler(error as any);
    return error;
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
