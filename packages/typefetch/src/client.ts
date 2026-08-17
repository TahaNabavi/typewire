import { z } from "zod";
import {
  Contracts,
  EndpointDef,
  EndpointDefZ,
  AnyEndpointDefZ,
  HttpDriver,
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
  Method,
  TransferProgress,
  ErrorKind,
} from "./types";
import { isXhrAvailable, xhrRequest } from "./transport/xhr";
import { kindFromHttpStatus, kindFromThrown } from "./utils/error-kind";
import { safeProgress } from "./utils/progress";
import { withDownloadProgress } from "./utils/response-body";
import { RichError, isContractError } from "./errors";
import { allowsDownloadProgress, httpTransport } from "./transport/http";
import {
  TRANSPORT_API_VERSION,
  type TransportAdapter,
  type TransportContext,
} from "./transport/adapter";

// Re-exported so `import { RichError } from "@tahanabavi/typefetch"` and every
// existing deep import keep resolving; the definitions moved to `errors.ts` only
// because transport adapters construct them and would otherwise close a cycle.
export { RichError, isContractError };

/** The correlation state one in-flight request carries for instrumentation. */
type RequestTrace = {
  requestId: string;
  endpointId: string;
  startedAt: number;
};

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
  /** Latches the one-time `driver: "xhr"` fallback warning. */
  private warnedNoXhrDriver = false;
  /** Latches per-transport capability warnings, keyed `"kind:phase"`. */
  private readonly warnedTransportCapability = new Set<string>();

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

  /**
   * Registered transports, keyed by their `transport` value.
   *
   * `http` is always present because it is what this client already was.
   * Everything else is passed in at the setup site, which is what keeps a
   * REST-only app from paying for a transport it never uses — an unregistered
   * adapter is never imported, so it tree-shakes out.
   */
  private readonly transports = new Map<string, TransportAdapter>();

  constructor(
    private config: {
      baseUrl: string;
      token?: string;
      tokenProvider?: TokenProvider;
      useMockData?: boolean;
      mockDelay?: { min: number; max: number };
      /** Default transport for endpoints that do not declare one. */
      transport?: string;
      /** Additional transports, from their adapter packages. */
      transports?: TransportAdapter<any>[];
    },
    private contracts: C,
  ) {
    this.useMockData = config.useMockData || false;
    this.mockDelay = config.mockDelay || { min: 100, max: 1000 };
    this.tokenProvider = config.tokenProvider;

    this.register(httpTransport as TransportAdapter);
    for (const adapter of config.transports ?? []) {
      this.register(adapter as TransportAdapter);
    }
  }

  /**
   * Add a transport.
   *
   * The version check is not ceremony: adapters are separate packages compiled
   * against a published interface, so a stale one would otherwise fail somewhere
   * deep in a request with a missing-method error rather than here, at
   * construction, naming the package.
   */
  private register(adapter: TransportAdapter) {
    if (adapter.apiVersion !== TRANSPORT_API_VERSION) {
      throw new Error(
        `[typefetch] Transport "${adapter.kind}" was built against transport ` +
          `API version ${adapter.apiVersion}, but this client speaks ` +
          `${TRANSPORT_API_VERSION}. Update the transport package.`,
      );
    }

    this.transports.set(adapter.kind, adapter);
  }

  /**
   * The adapter serving an endpoint: its own `transport`, else the client
   * default, else `http`.
   */
  private adapterFor(endpoint: AnyEndpointDefZ, endpointId: string) {
    const kind =
      (endpoint as { transport?: string }).transport ??
      this.config.transport ??
      "http";

    const adapter = this.transports.get(kind);

    if (!adapter) {
      throw new Error(
        `[typefetch] Endpoint "${endpointId}" uses transport "${kind}", which ` +
          `is not registered. Install its package and pass it in ` +
          `\`transports\` when constructing the client.`,
      );
    }

    return adapter;
  }

  init() {
    const modules = {} as { [M in keyof C]: EndpointMethods<C[M]> };

    for (const moduleName in this.contracts) {
      const module = this.contracts[moduleName];
      (modules as any)[moduleName] = {} as EndpointMethods<typeof module>;

      for (const endpointName in module) {
        const endpoint = module[endpointName] as EndpointDefZ;
        const endpointId = `${moduleName}.${endpointName}`;

        // Resolve and check the contract once, here — a route pointing at an
        // unregistered transport, or missing a field its transport requires,
        // should fail at client construction with its id in the message rather
        // than on the first call in production.
        this.adapterFor(endpoint, endpointId).validate?.(endpoint, endpointId);

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

  /**
   * How a route identifies itself, asked of its transport.
   *
   * The transport registry is open, so `endpoint.method` and `endpoint.path` do
   * not exist on every endpoint. Tooling that needs to name a route calls this
   * and keeps working for transports written after it shipped.
   */
  describe(endpoint: AnyEndpointDefZ, endpointId = "") {
    return this.adapterFor(endpoint, endpointId).describe(endpoint);
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
    const adapter = this.adapterFor(activeEndpoint as AnyEndpointDefZ, endpointId);

    const parsedInput = this.parseInput(
      activeEndpoint,
      adapter,
      input,
      endpointId,
    );

    const trace = this.startTrace(
      endpointId,
      activeEndpoint as AnyEndpointDefZ,
      adapter,
      parsedInput,
    );

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
              `Forced error for ${
                endpointId ||
                adapter.describe(activeEndpoint as AnyEndpointDefZ).target
              }`,
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

      const data = await this.performRequestLogic(
        activeEndpoint,
        adapter,
        parsedInput,
        endpointId,
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

  /**
   * Validate a request input, failing the same way everything else fails.
   *
   * A bad **input** used to escape as a raw `ZodError`: it never became a
   * `RichError`, never carried a `kind`, never reached `onError`, and never
   * appeared in an inspector — while a bad **output**, one line further down the
   * same request, did all four. That asymmetry meant a global error handler
   * silently missed an entire class of failure, and the fix is to give both ends
   * of the contract the same treatment.
   *
   * Zod's field errors are carried across into `RichError.errors`, which already
   * exists for exactly this shape, so nothing the `ZodError` knew is lost by
   * normalising it.
   */
  private parseInput<TReq extends z.ZodTypeAny>(
    endpoint: EndpointDef<TReq, z.ZodTypeAny>,
    adapter: TransportAdapter,
    input: unknown,
    endpointId: string,
  ): z.infer<TReq> {
    try {
      return endpoint.request.parse(input);
    } catch (err) {
      const error = this.report(this.normalizeError(err));

      // The request never reaches the wire, so there is no trace yet — but it
      // is still a failed request from the caller's side. Emitting the pair
      // keeps an inspector's timeline complete instead of showing a toast with
      // no row behind it. The raw input is what is reported because there is no
      // parsed one; that is the whole reason this failed.
      this.failTrace(
        this.startTrace(
          endpointId,
          endpoint as AnyEndpointDefZ,
          adapter,
          input,
        ),
        error,
      );

      throw error;
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
    endpoint: AnyEndpointDefZ,
    adapter: TransportAdapter,
    input: unknown,
  ): RequestTrace | null {
    if (!this.instrumentations.length) return null;
    const requestId = `tf_${++this.requestCounter}`;
    const startedAt = this.nowMs();
    // Asked of the transport rather than read off the endpoint: `method` and
    // `path` do not exist on every variant once a second transport is
    // registered, and an inspector still needs a label for the row.
    const described = adapter.describe(endpoint);
    this.emit({
      type: "start",
      requestId,
      endpointId,
      method: described.operation as Method,
      url: this.config.baseUrl + described.target,
      transport: adapter.kind,
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
    adapter: TransportAdapter,
    parsedInput: z.infer<TReq>,
    endpointId: string,
    options?: RequestOptions,
    trace?: RequestTrace | null,
  ): Promise<z.infer<TRes>> {
    const anyEndpoint = endpoint as AnyEndpointDefZ;

    // Resolved here rather than in the adapter so token providers behave
    // identically on every wire; *applying* it is the transport's job, because
    // "an Authorization header" is not universal.
    let token: string | undefined;

    if (endpoint.auth) {
      token = await this.getCurrentToken();

      if (!token) {
        // Thrown before the request is under way, so it never reaches the catch
        // below and is reported here instead.
        throw this.report(
          this.createError({
            message: `Missing token for ${adapter.describe(anyEndpoint).target}`,
            status: 401,
            code: "NO_TOKEN",
          }),
        );
      }
    }

    const transportCtx: TransportContext = {
      endpoint: anyEndpoint,
      endpointId,
      input: parsedInput,
      baseUrl: this.config.baseUrl,
      token,
      options,
    };

    const built = adapter.build(transportCtx);

    const ctx = {
      url: built.url,
      init: built.init,
      endpoint: endpoint as never,
      route: { ...adapter.describe(anyEndpoint), transport: adapter.kind },
      request: {
        ...built.parts,
        rawInput: parsedInput,
      },
    } satisfies MiddlewareContext;

    let controller: AbortController | undefined;
    let timeoutId: any;
    // The client implements `timeout` by aborting, so the failure that comes
    // back is indistinguishable from a caller-initiated cancel. Remembering
    // which one fired is what lets the two be reported as different `kind`s —
    // a distinction a retry policy needs, since a timeout is worth retrying and
    // a user navigating away is not.
    let timedOut = false;

    if (options?.timeout) {
      controller = new AbortController();
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller!.abort();
      }, options.timeout);
    }

    if (options?.signal || controller) {
      ctx.init.signal = options?.signal || controller?.signal;
    }

    // Progress handlers are wired only when the caller asked for them — never
    // merely because instrumentation is attached. Opening devtools must not
    // change which transport a request uses or whether its body is re-streamed.
    const onUpload = this.withProgressEvents(options?.onUploadProgress, trace);
    const onDownload = this.withProgressEvents(
      options?.onDownloadProgress,
      trace,
    );

    if (onUpload) this.checkProgressSupport(adapter, "upload");
    if (onDownload) this.checkProgressSupport(adapter, "download");

    // Asked of the adapter rather than read off the endpoint: `driver` lives on
    // the http registry entry, and the core never reads a transport-specific
    // field. A transport with no opinion inherits "auto".
    const driver = adapter.resolveDriver?.(endpoint as AnyEndpointDefZ) ?? "auto";
    const useXhr = this.shouldUseXhr(driver, Boolean(onUpload), adapter);

    if (onUpload && !adapter.send && !useXhr) {
      this.warnUploadProgressUnavailable();
    }

    // A transport with its own terminal sender replaces `fetch` at the end of
    // the chain; every middleware above it is unaware of the swap, exactly as
    // with the XHR path.
    const send = adapter.send;
    const terminal = send
      ? () => send(ctx.url, ctx.init, { onUploadProgress: onUpload })
      : useXhr
        ? () => xhrRequest(ctx.url, ctx.init, { onUploadProgress: onUpload })
        : () => fetch(ctx.url, ctx.init);

    const runner = this.middlewares.reduceRight(
      (next, mw) => () => mw.fn(ctx, next, mw.options),
      terminal,
    );

    const execute = async () => {
      let res = await runner();

      // Failure is handled before any decoding. A transport's declared success
      // decoding describes the *success* body only — an endpoint returning a
      // Blob still reports its 404 as JSON — and reading the error body
      // defensively is what keeps a non-JSON failure (an HTML 502, an empty 401)
      // reporting its status instead of surfacing as a bare SyntaxError.
      if (!res.ok) {
        const failure = await adapter.fail(res, transportCtx);

        // An envelope API answering `{ success: false, message }` alongside a
        // 4xx put its message here before this reordering, and that message is
        // the useful one. Consulted with `safeParse`, so a failure body that
        // doesn't fit the envelope falls through to the status-based error
        // instead of throwing a validation error over it.
        if (failure.wasJson && failure.enveloped && this.responseWrapper) {
          const enveloped = this.responseWrapper(endpoint.response).safeParse(
            failure.body,
          );
          if (enveloped.success && (enveloped.data as any)?.success === false) {
            throw this.buildEnvelopeFailure(enveloped.data as any, res.status);
          }
        }

        throw this.createError(failure.error);
      }

      // Gated on the capability as well as the response type: warning that a
      // transport cannot report download progress and then re-streaming its body
      // to count bytes anyway would pay the cost for a handler that is never
      // called.
      if (
        onDownload &&
        adapter.capabilities?.downloadProgress !== false &&
        allowsDownloadProgress(anyEndpoint)
      ) {
        res = withDownloadProgress(res, onDownload);
      }

      const decoded = await adapter.decode(res, transportCtx);

      // Envelopes and the global response transform are JSON/text concepts.
      // Unwrapping a Blob, or handing one to a transform written for records,
      // would corrupt exactly the payloads that motivated these response types.
      if (!decoded.enveloped) {
        return endpoint.response.parse(decoded.value);
      }

      let responseData = decoded.value;

      if (this.responseWrapper) {
        const wrappedSchema = this.responseWrapper(endpoint.response);
        const parsedWrapped = wrappedSchema.parse(decoded.value) as any;

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
      const error = this.normalizeError(err);
      if (timedOut && error.kind === "cancelled") {
        error.kind = "deadline_exceeded";
      }
      throw this.report(error);
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

  /**
   * Warn when a request asks for progress a transport cannot report.
   *
   * A capability the wire does not have is otherwise a silent no-op, and a
   * progress bar frozen at zero on a transfer that is in fact working reads as
   * a hung app — the same reasoning as the "no XMLHttpRequest here" warning.
   */
  private checkProgressSupport(
    adapter: TransportAdapter,
    phase: "upload" | "download",
  ) {
    const capabilities = adapter.capabilities;
    if (!capabilities) return;

    const supported =
      phase === "upload"
        ? capabilities.uploadProgress
        : capabilities.downloadProgress;
    if (supported) return;

    const key = `${adapter.kind}:${phase}`;
    if (this.warnedTransportCapability.has(key)) return;
    this.warnedTransportCapability.add(key);

    console.warn(
      `[typefetch] on${phase === "upload" ? "Upload" : "Download"}Progress was ` +
        `provided for a "${adapter.kind}" endpoint, but that transport cannot ` +
        `report ${phase} progress. The request still runs; the handler will not ` +
        `be called.`,
    );
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
   * Resolve the terminal sender for one request.
   *
   * A transport supplying its own `send` owns the wire outright, so the driver
   * is not consulted for it at all — honouring `driver: "xhr"` there would mean
   * overriding the very thing that adapter exists to do.
   */
  private shouldUseXhr(
    driver: HttpDriver,
    wantsUploadProgress: boolean,
    adapter: TransportAdapter,
  ): boolean {
    if (adapter.send) return false;

    const available = isXhrAvailable();

    if (driver === "fetch") return false;

    if (driver === "xhr") {
      if (!available) this.warnXhrDriverUnavailable();
      return available;
    }

    // "auto": the historical rule — XHR exists only to report upload progress,
    // so a request that did not ask for it takes the unchanged fetch path.
    return wantsUploadProgress && available;
  }

  /**
   * Warn once when a contract pinned `driver: "xhr"` somewhere XHR does not
   * exist. Falling back silently would hide the reason a request behaves
   * differently in SSR than it does in the browser.
   */
  private warnXhrDriverUnavailable() {
    if (this.warnedNoXhrDriver) return;
    this.warnedNoXhrDriver = true;
    console.warn(
      '[typefetch] An endpoint declares driver: "xhr", but XMLHttpRequest is ' +
        "not available in this environment (Node/SSR). The request falls back " +
        "to fetch.",
    );
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

  /**
   * Build a `RichError`, classifying it if the caller did not.
   *
   * Defaulting `kind` here rather than at each call site is what makes the
   * guarantee "every error the client produces carries a `kind`" true by
   * construction — a new failure path cannot forget to classify itself.
   */
  private createError(error: Partial<RichError> & { message: string }) {
    return new RichError({
      ...error,
      kind: error.kind ?? kindFromHttpStatus(error.status),
    });
  }

  private normalizeError(err: any) {
    if (err instanceof RichError) return err;
    if (err instanceof z.ZodError) {
      return this.createError({
        message: `Validation error: ${err.issues.map((e) => e.message).join(", ")}`,
        code: "VALIDATION_ERROR",
        kind: "validation",
        // `errors` is already `Record<string, string[]>`, which is exactly what
        // Zod's flattened field errors are — so the per-field detail a caller
        // would have read off the `ZodError` survives normalisation.
        errors: z.flattenError(err).fieldErrors as Record<string, string[]>,
      });
    }
    return this.createError({
      message: err?.message || "Unknown error",
      kind: kindFromThrown(err),
    });
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
