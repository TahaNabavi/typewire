import { Notifier, type Observable } from "./observable";
import { resolveRetryDelay, shouldRetry, sleep } from "./retry";
import { resolveSourceId } from "./source";
import type {
  AnyQuerySource,
  EndpointCallOptions,
  MutationObserverOptions,
  MutationObserverResult,
  MutationState,
  ProgressHandlerLike,
  TransferProgressLike,
} from "./types";

/**
 * Hooks the client injects so the observer can announce itself without
 * importing `QueryClient` (which constructs it — a cycle otherwise).
 */
export interface MutationHooks {
  /** Run the client-level `relations` invalidation for a successful mutation. */
  onSuccess: (
    endpointId: string,
    variables: unknown,
    data: unknown,
    /** Extra endpoint ids declared on this observer's own options. */
    extraInvalidates: string[] | undefined,
  ) => void | Promise<void>;
  /** Publish onto the cache event bus. */
  emit: (status: MutationState["status"], ctx: {
    endpointId: string;
    variables: unknown;
    data: unknown;
    error: unknown;
  }) => void;
}

/**
 * A write against one endpoint, plus the invalidation it triggers.
 *
 * Unlike a query, a mutation is not cached or deduplicated — two calls are two
 * distinct writes. What it shares with a query is the `Observable` contract, so
 * the same framework adapter binds both.
 */
export class MutationObserver<
  TInput = unknown,
  TData = unknown,
  TError = Error,
> implements Observable<MutationObserverResult<TData, TError, TInput>>
{
  private readonly endpoint: AnyQuerySource;
  /** Resolved once: typefetch spells it `endpointId`, typesocket `eventId`. */
  private readonly endpointId: string;
  private readonly hooks: MutationHooks;
  private readonly notifier = new Notifier();
  private readonly mutateFn = (input: TInput) => {
    void this.mutateAsync(input).catch(() => {
      // Reported through `result.error`; see the `mutate` doc comment.
    });
  };
  private readonly mutateAsyncFn = (input: TInput) => this.mutateAsync(input);
  private readonly resetFn = () => this.reset();

  private options: MutationObserverOptions<TData, TError, TInput>;
  private state: MutationState<TData, TError, TInput>;
  private currentResult!: MutationObserverResult<TData, TError, TInput>;
  /**
   * Guards against a slow first call overwriting a newer one's result. Only the
   * most recent `mutate` is allowed to write state.
   */
  private activeCallId = 0;

  constructor(
    endpoint: AnyQuerySource,
    options: MutationObserverOptions<TData, TError, TInput> = {},
    hooks: MutationHooks,
  ) {
    this.endpoint = endpoint;
    this.endpointId = resolveSourceId(endpoint);
    this.options = options;
    this.hooks = hooks;
    this.state = {
      status: "idle",
      data: undefined,
      error: undefined,
      variables: undefined,
      failureCount: 0,
    };
    this.buildResult();
  }

  getSnapshot(): MutationObserverResult<TData, TError, TInput> {
    return this.currentResult;
  }

  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener);
  }

  setOptions(options: MutationObserverOptions<TData, TError, TInput>): void {
    this.options = options;
  }

  /** Run the mutation. Rejects on failure; `mutate` is the safe wrapper. */
  async mutateAsync(input: TInput): Promise<TData> {
    const callId = ++this.activeCallId;
    this.setState({
      status: "pending",
      variables: input,
      failureCount: 0,
      data: undefined,
      error: undefined,
      // A new call starts at zero; leaving the last upload's percentage on
      // screen would show the new one as already finished.
      progress: undefined,
    });

    try {
      const data = await this.run(input, callId);
      if (callId !== this.activeCallId) return data;

      this.setState({ status: "success", data, error: undefined });
      this.hooks.emit("success", {
        endpointId: this.endpointId,
        variables: input,
        data,
        error: undefined,
      });

      await this.options.onSuccess?.(data, input);
      // Client-declared relations first, then this call site's extra ids.
      await this.hooks.onSuccess(
        this.endpointId,
        input,
        data,
        this.options.invalidates,
      );
      await this.options.onSettled?.(data, undefined, input);
      return data;
    } catch (error) {
      if (callId === this.activeCallId) {
        this.setState({ status: "error", error: error as TError });
        this.hooks.emit("error", {
          endpointId: this.endpointId,
          variables: input,
          data: undefined,
          error,
        });
        await this.options.onError?.(error as TError, input);
        await this.options.onSettled?.(undefined, error as TError, input);
      }
      throw error;
    }
  }

  /** Back to `idle`, discarding the last result. */
  reset(): void {
    this.activeCallId += 1;
    this.setState({
      status: "idle",
      data: undefined,
      error: undefined,
      variables: undefined,
      failureCount: 0,
      progress: undefined,
    });
  }

  private async run(input: TInput, callId: number): Promise<TData> {
    let failureCount = 0;
    const callOptions = this.buildCallOptions(callId);

    for (;;) {
      try {
        // Options are omitted entirely when nothing needs them, so a mutation
        // without progress tracking calls the endpoint exactly as before.
        return (await (callOptions
          ? this.endpoint(input, callOptions)
          : this.endpoint(input))) as TData;
      } catch (error) {
        failureCount += 1;
        if (callId === this.activeCallId) this.setState({ failureCount });
        if (!shouldRetry(this.options.retry, failureCount, error as TError)) {
          throw error;
        }
        await sleep(
          resolveRetryDelay(this.options.retryDelay, failureCount, error as TError),
        );
      }
    }
  }

  /**
   * Build the per-call options for this attempt, or `undefined` when the
   * mutation wants nothing from the transport.
   *
   * Bound to `callId` so a superseded call's ticks are discarded rather than
   * writing progress for a mutation whose result is already being ignored.
   */
  private buildCallOptions(callId: number): EndpointCallOptions | undefined {
    const { trackProgress, onUploadProgress, onDownloadProgress } = this.options;

    const wantUpload =
      trackProgress === true ||
      trackProgress === "upload" ||
      Boolean(onUploadProgress);
    const wantDownload =
      trackProgress === true ||
      trackProgress === "download" ||
      Boolean(onDownloadProgress);

    if (!wantUpload && !wantDownload) return undefined;

    const options: EndpointCallOptions = {};

    if (wantUpload) {
      options.onUploadProgress = this.progressSink(
        callId,
        "upload",
        onUploadProgress,
      );
    }
    if (wantDownload) {
      options.onDownloadProgress = this.progressSink(
        callId,
        "download",
        onDownloadProgress,
      );
    }

    return options;
  }

  /** One direction's tick handler: forward to the caller, then store. */
  private progressSink(
    callId: number,
    phase: "upload" | "download",
    handler: ProgressHandlerLike | undefined,
  ): ProgressHandlerLike {
    return (progress: TransferProgressLike) => {
      if (callId !== this.activeCallId) return;

      handler?.(progress);

      // Reads `this.options` fresh rather than closing over `trackProgress`,
      // so a re-render that flips tracking off stops writing state mid-upload.
      const tracking = this.options.trackProgress;
      if (tracking !== true && tracking !== phase) return;

      this.setState({
        progress: { ...this.state.progress, [phase]: progress },
      });
    };
  }

  private setState(patch: Partial<MutationState<TData, TError, TInput>>): void {
    this.state = { ...this.state, ...patch };
    this.buildResult();
    this.notifier.notify();
  }

  private buildResult(): void {
    this.currentResult = {
      ...this.state,
      isIdle: this.state.status === "idle",
      isPending: this.state.status === "pending",
      isSuccess: this.state.status === "success",
      isError: this.state.status === "error",
      mutate: this.mutateFn,
      mutateAsync: this.mutateAsyncFn,
      reset: this.resetFn,
    };
  }
}
