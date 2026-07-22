import { io, Socket } from "socket.io-client";
import type { z } from "zod";

import {
  isClientToServer,
  listSocketEvents,
  makeEventId,
  resolveEventName,
  validateSocketContracts,
} from "./contract";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  resolveSocketConfig,
  toIoOptions,
} from "./config";
import {
  type ErrorLike,
  SocketAckTimeoutError,
  SocketError,
  SocketNotConnectedError,
  SocketOverrideError,
  SocketValidationError,
  SocketWaitTimeoutError,
} from "./errors";
import type {
  ClientToServerDef,
  EmitApi,
  EmitOptions,
  ListenApi,
  ServerToClientDef,
  SocketClientConfig,
  SocketClientOptions,
  SocketContracts,
  SocketEvent,
  SocketEventMeta,
  SocketInstrumentation,
  SocketMiddleware,
  SocketModules,
  SocketOverride,
  Unsubscribe,
  WaitOptions,
} from "./types";

/** A user handler plus the flag that decides whether it survives a dispatch. */
type HandlerEntry = {
  fn: (payload: any) => void;
  once: boolean;
};

/** A frame validated at `.queue()` time and awaiting the next connect. */
type QueuedFrame = {
  eventId: string;
  event: string;
  payload: unknown;
};

/** Outcome of the shared outbound preparation path. */
type Prepared =
  | { send: true; frameId: string; payload: unknown; override?: SocketOverride }
  | { send: false; frameId: string };

/**
 * SocketClient
 * ============
 * A contract-driven Socket.IO client. One direction-tagged contract object
 * produces the whole surface — `client.modules.<module>.<event>` — with every
 * frame validated in both directions.
 *
 * Structurally parallel to `typefetch`'s `ApiClient`: same `"module.event"`
 * identifier scheme, same additive `instrument()` seam, so a query engine or a
 * devtools bridge treats HTTP and WS traffic uniformly.
 *
 * @example
 * const client = new SocketClient({ url: "http://localhost:3001" }, wsContracts);
 * client.connect();
 *
 * const off = client.modules.chat.message.on((m) => console.log(m.text));
 * const ack = await client.modules.chat.sendMessage({ text: "hi" });
 */
export class SocketClient<C extends SocketContracts> {
  private socket: Socket | null = null;
  private readonly config: SocketClientConfig;
  private readonly ioOptions: Record<string, unknown>;

  /** Wire event name → the user handlers attached to it. */
  private readonly handlers = new Map<string, Set<HandlerEntry>>();
  /**
   * Wire event name → the single listener bound to socket.io.
   *
   * Exactly one dispatcher is registered per event per socket, and it fans out
   * to `handlers`. This is what makes `off()` reliable (it only touches our
   * own Set) and what stops handlers from multiplying across reconnects.
   */
  private readonly dispatchers = new Map<string, (raw: unknown) => void>();

  private readonly queue: QueuedFrame[] = [];
  private middlewares: SocketMiddleware[] = [];
  private instrumentations: SocketInstrumentation[] = [];

  private readonly lifecycle = {
    connect: new Set<(info: { socketId?: string; attempt: number }) => void>(),
    disconnect: new Set<(reason: string) => void>(),
    connectError: new Set<(error: ErrorLike) => void>(),
  };

  private frameCounter = 0;
  private connectAttempt = 0;

  /** The generated, fully-typed API surface. */
  public readonly modules: SocketModules<C>;

  constructor(
    config: SocketClientConfig,
    private readonly contracts: C,
    options: SocketClientOptions = {},
  ) {
    const problems = validateSocketContracts(contracts);
    if (problems.length) {
      throw new SocketError(
        `[typesocket] Invalid contracts:\n  - ${problems.join("\n  - ")}`,
        "ERR_SOCKET_INVALID_CONTRACT",
      );
    }

    this.config = resolveSocketConfig(config);
    this.ioOptions = toIoOptions(this.config);
    this.middlewares = [...(options.middlewares ?? [])];

    if (options.onConnect) this.lifecycle.connect.add(options.onConnect);
    if (options.onDisconnect) this.lifecycle.disconnect.add(options.onDisconnect);
    if (options.onConnectError) this.lifecycle.connectError.add(options.onConnectError);

    this.modules = this.buildModules();
  }

  /* ==========================================================================
   * CONNECTION
   * ======================================================================== */

  /**
   * Opens the connection, binding one dispatcher per declared inbound event.
   *
   * Idempotent: calling it on a live client is a no-op, and on a disconnected
   * one it reuses the existing socket rather than leaking a second.
   */
  public connect(): this {
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return this;
    }

    this.socket = io(this.config.url, this.ioOptions);
    this.bindLifecycle(this.socket);
    for (const [event, dispatcher] of this.dispatchers) {
      this.socket.on(event, dispatcher);
    }
    return this;
  }

  /**
   * Closes the connection and detaches every socket listener.
   *
   * User handlers are deliberately kept, so a later `connect()` restores them
   * — the registry, not the socket, owns subscriptions.
   */
  public disconnect(): this {
    if (!this.socket) return this;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    return this;
  }

  /** Tears the socket down and opens a fresh one. */
  public reconnect(): this {
    this.disconnect();
    return this.connect();
  }

  /**
   * Permanently disposes the client: disconnects, drops every handler,
   * middleware, instrumentation hook and queued frame.
   */
  public destroy(): void {
    this.disconnect();
    this.handlers.clear();
    this.queue.length = 0;
    this.middlewares = [];
    this.instrumentations = [];
    this.lifecycle.connect.clear();
    this.lifecycle.disconnect.clear();
    this.lifecycle.connectError.clear();
  }

  public get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  public get id(): string | undefined {
    return this.socket?.id;
  }

  /** The underlying socket.io instance, for anything this wrapper doesn't model. */
  public get raw(): Socket | null {
    return this.socket;
  }

  /** Frames buffered by `.queue()` and not yet flushed. */
  public get queueSize(): number {
    return this.queue.length;
  }

  /** Every event in the contract, flattened. Used by devtools and codegen. */
  public get events(): SocketEventMeta[] {
    return listSocketEvents(this.contracts);
  }

  public onConnect(
    handler: (info: { socketId?: string; attempt: number }) => void,
  ): Unsubscribe {
    this.lifecycle.connect.add(handler);
    return () => void this.lifecycle.connect.delete(handler);
  }

  public onDisconnect(handler: (reason: string) => void): Unsubscribe {
    this.lifecycle.disconnect.add(handler);
    return () => void this.lifecycle.disconnect.delete(handler);
  }

  public onConnectError(handler: (error: ErrorLike) => void): Unsubscribe {
    this.lifecycle.connectError.add(handler);
    return () => void this.lifecycle.connectError.delete(handler);
  }

  private bindLifecycle(socket: Socket): void {
    socket.on("connect", () => {
      this.connectAttempt += 1;
      const info = { socketId: socket.id, attempt: this.connectAttempt };
      this.publish({ type: "connect", ts: Date.now(), ...info });
      this.log("🟢 connected", info);
      this.flushQueue();
      for (const handler of [...this.lifecycle.connect]) {
        this.safely(() => handler(info), "onConnect");
      }
    });

    socket.on("disconnect", (reason: string) => {
      this.publish({ type: "disconnect", ts: Date.now(), reason });
      this.log("🔴 disconnected", reason);
      for (const handler of [...this.lifecycle.disconnect]) {
        this.safely(() => handler(reason), "onDisconnect");
      }
    });

    socket.on("connect_error", (error: Error) => {
      const normalized: ErrorLike = {
        message: error?.message ?? String(error),
        code: "ERR_SOCKET_CONNECT",
      };
      this.publish({ type: "connect_error", ts: Date.now(), error: normalized });
      this.log("⚠️ connect_error", normalized.message);
      for (const handler of [...this.lifecycle.connectError]) {
        this.safely(() => handler(normalized), "onConnectError");
      }
    });
  }

  /* ==========================================================================
   * EXTENSION POINTS
   * ======================================================================== */

  /**
   * Registers a middleware over every frame in both directions.
   * Returns a function that removes it.
   */
  public use(middleware: SocketMiddleware): Unsubscribe {
    this.middlewares.push(middleware);
    return () => {
      const index = this.middlewares.indexOf(middleware);
      if (index >= 0) this.middlewares.splice(index, 1);
    };
  }

  /**
   * Attaches an instrumentation hook. Returns a function that detaches it.
   *
   * With no hook attached, frame handling is identical to the un-instrumented
   * path — no events are constructed and no overrides are resolved.
   */
  public instrument(hook: SocketInstrumentation): Unsubscribe {
    this.instrumentations.push(hook);
    return () => {
      const index = this.instrumentations.indexOf(hook);
      if (index >= 0) this.instrumentations.splice(index, 1);
    };
  }

  private publish(event: SocketEvent): void {
    if (!this.instrumentations.length) return;
    for (const hook of this.instrumentations) {
      try {
        hook.on?.(event);
      } catch (error) {
        console.error("[typesocket] instrumentation hook threw", error);
      }
    }
  }

  private resolveOverride(
    eventId: string,
    payload: unknown,
  ): SocketOverride | undefined {
    if (!this.instrumentations.length) return undefined;
    for (const hook of this.instrumentations) {
      const override = hook.resolveOverride?.(eventId, payload);
      if (override) return override;
    }
    return undefined;
  }

  /* ==========================================================================
   * MODULE GENERATION
   * ======================================================================== */

  private buildModules(): SocketModules<C> {
    const modules: Record<string, Record<string, unknown>> = {};

    for (const [module, events] of Object.entries(this.contracts)) {
      modules[module] = {};
      for (const [name, def] of Object.entries(events)) {
        const eventId = makeEventId(module, name);
        const event = resolveEventName(def, module, name);
        modules[module][name] = isClientToServer(def)
          ? this.buildEmitApi(eventId, event, def)
          : this.buildListenApi(eventId, event, def as ServerToClientDef);
      }
    }

    return modules as SocketModules<C>;
  }

  private buildEmitApi(
    eventId: string,
    event: string,
    def: ClientToServerDef,
  ): EmitApi {
    const emit = (input: unknown, options?: EmitOptions) =>
      def.ack
        ? this.emitWithAck(eventId, event, def, input, options)
        : this.emitVoid(eventId, event, def, input, options);

    return Object.defineProperties(emit, {
      queue: { value: (input: unknown) => this.queueFrame(eventId, event, def, input) },
      eventId: { value: eventId, enumerable: true },
      event: { value: event, enumerable: true },
      def: { value: def, enumerable: true },
    }) as unknown as EmitApi;
  }

  private buildListenApi(
    eventId: string,
    event: string,
    def: ServerToClientDef,
  ): ListenApi {
    // Registered eagerly so a dispatcher exists before the first connect and
    // is bound exactly once per socket, whenever `connect()` happens.
    this.dispatchers.set(event, this.makeDispatcher(eventId, event, def));

    const subscribe = (fn: (payload: any) => void, once: boolean): Unsubscribe => {
      let set = this.handlers.get(event);
      if (!set) {
        set = new Set();
        this.handlers.set(event, set);
      }
      const entry: HandlerEntry = { fn, once };
      set.add(entry);
      return () => void set!.delete(entry);
    };

    const remove = (fn: (payload: any) => void) => {
      const set = this.handlers.get(event);
      if (!set) return;
      for (const entry of set) {
        if (entry.fn === fn) set.delete(entry);
      }
    };

    const api: ListenApi = {
      on: (handler) => subscribe(handler, false),
      once: (handler) => subscribe(handler, true),
      off: remove,
      offAll: () => void this.handlers.get(event)?.clear(),
      wait: (options?: WaitOptions) => this.waitFor(eventId, event, options),
      get listenerCount() {
        return 0;
      },
      eventId,
      event,
      def,
    };

    // `listenerCount` must read through to the live Set, so it is defined here
    // rather than captured in the literal above.
    Object.defineProperty(api, "listenerCount", {
      get: () => this.handlers.get(event)?.size ?? 0,
      enumerable: true,
    });

    return api;
  }

  /* ==========================================================================
   * OUTBOUND
   * ======================================================================== */

  /**
   * The shared outbound path: override → middleware → validation → event.
   *
   * Throws `SocketValidationError` on a bad payload rather than logging and
   * dropping it, so a contract violation can never leave silently.
   */
  private prepareOutbound(
    eventId: string,
    event: string,
    def: ClientToServerDef,
    input: unknown,
    queued: boolean,
  ): Prepared {
    const frameId = this.nextFrameId();
    const override = this.resolveOverride(eventId, input);

    if (override?.drop) {
      this.publish({
        type: "dropped",
        frameId,
        eventId,
        direction: "outbound",
        by: "override",
        ts: Date.now(),
      });
      return { send: false, frameId };
    }

    if (override?.error) {
      throw new SocketOverrideError(
        eventId,
        override.error.message ?? `Forced error for "${eventId}"`,
        override.error.code,
      );
    }

    let payload = applyPayloadOverride(override, input);

    const result = this.runMiddlewares({
      direction: "outbound",
      eventId,
      event,
      payload,
    });
    if (result === false) {
      this.publish({
        type: "dropped",
        frameId,
        eventId,
        direction: "outbound",
        by: "middleware",
        ts: Date.now(),
      });
      return { send: false, frameId };
    }
    if (result) payload = result.payload;

    const schema = override?.request ?? def.request;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new SocketValidationError({
        eventId,
        phase: "request",
        issues: parsed.error.issues,
        received: payload,
      });
    }

    this.publish({
      type: "outbound",
      frameId,
      eventId,
      event,
      payload: parsed.data,
      ts: Date.now(),
      queued,
      expectsAck: Boolean(def.ack),
    });

    return { send: true, frameId, payload: parsed.data, override };
  }

  /** Fire-and-forget emit for events with no declared `ack`. */
  private emitVoid(
    eventId: string,
    event: string,
    def: ClientToServerDef,
    input: unknown,
    options?: EmitOptions,
  ): void {
    const prepared = this.prepareOutbound(eventId, event, def, input, false);
    if (!prepared.send) return;

    // Checked before any simulated latency so the failure is synchronous and
    // catchable at the call site.
    if (!this.connected) throw new SocketNotConnectedError(eventId);

    const write = () => this.write(event, prepared.payload, options);
    if (prepared.override?.latencyMs) {
      setTimeout(write, prepared.override.latencyMs);
    } else {
      write();
    }

    this.log("🔵 emit", eventId, prepared.payload);
  }

  /**
   * Emit for events that declare an `ack`, resolving with the **validated**
   * acknowledgement.
   *
   * v1 typed this return from the `callback` schema but resolved the raw
   * server value, so the type was a claim the runtime never checked.
   */
  private emitWithAck(
    eventId: string,
    event: string,
    def: ClientToServerDef,
    input: unknown,
    options?: EmitOptions,
  ): Promise<unknown> {
    const timeoutMs =
      options?.timeoutMs ?? def.ackTimeoutMs ?? this.config.ackTimeoutMs!;

    return new Promise((resolve, reject) => {
      let prepared: Prepared;
      try {
        prepared = this.prepareOutbound(eventId, event, def, input, false);
      } catch (error) {
        reject(error);
        return;
      }

      // A dropped frame is not settled early: letting the ack time out models
      // what a genuinely lost packet does, and guarantees the promise settles.
      if (!prepared.send) {
        const timer = setTimeout(
          () => reject(new SocketAckTimeoutError(eventId, timeoutMs)),
          timeoutMs,
        );
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(abortError(eventId));
        });
        return;
      }

      const startedAt = Date.now();
      const ackSchema = prepared.override?.response ?? def.ack!;

      const settle = (raw: unknown, fromMock: boolean) => {
        const parsed = ackSchema.safeParse(raw);
        if (!parsed.success) {
          const error = new SocketValidationError({
            eventId,
            phase: "ack",
            issues: parsed.error.issues,
            received: raw,
          });
          this.publish({
            type: "frame_error",
            frameId: prepared.frameId,
            eventId,
            direction: "outbound",
            error: error.toJSON(),
            ts: Date.now(),
          });
          reject(error);
          return;
        }
        this.publish({
          type: "ack",
          frameId: prepared.frameId,
          eventId,
          data: parsed.data,
          durationMs: Date.now() - startedAt,
          fromMock,
        });
        this.log("🟣 ack", eventId, parsed.data);
        resolve(parsed.data);
      };

      // An override may answer locally, never touching the network.
      if (prepared.override && "ack" in prepared.override) {
        const mocked =
          typeof prepared.override.ack === "function"
            ? (prepared.override.ack as (i: unknown) => unknown)(prepared.payload)
            : prepared.override.ack;
        const deliver = () => settle(mocked, true);
        if (prepared.override.latencyMs) {
          setTimeout(deliver, prepared.override.latencyMs);
        } else {
          deliver();
        }
        return;
      }

      if (!this.connected) {
        reject(new SocketNotConnectedError(eventId));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new SocketAckTimeoutError(eventId, timeoutMs);
        this.publish({
          type: "frame_error",
          frameId: prepared.frameId,
          eventId,
          direction: "outbound",
          error: error.toJSON(),
          ts: Date.now(),
        });
        reject(error);
      }, timeoutMs);

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(abortError(eventId));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      const send = () => {
        this.log("🔵 emit", eventId, prepared.payload);
        this.write(event, prepared.payload, options, (raw: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options?.signal?.removeEventListener("abort", onAbort);
          settle(raw, false);
        });
      };

      if (prepared.override?.latencyMs) {
        setTimeout(send, prepared.override.latencyMs);
      } else {
        send();
      }
    });
  }

  /**
   * Validates now and sends on the next connect.
   *
   * Validating at queue time — rather than at flush time as v1 did — means a
   * malformed payload fails at the call site instead of silently going out
   * unvalidated minutes later.
   */
  private queueFrame(
    eventId: string,
    event: string,
    def: ClientToServerDef,
    input: unknown,
  ): void {
    if (this.connected) {
      if (def.ack) {
        // Nothing can await the result here; send it and surface a rejection.
        void (
          this.emitWithAck(eventId, event, def, input) as Promise<unknown>
        ).catch((error) => this.reportFrameError(eventId, "outbound", error));
      } else {
        this.emitVoid(eventId, event, def, input);
      }
      return;
    }

    const prepared = this.prepareOutbound(eventId, event, def, input, true);
    if (!prepared.send) return;

    const max = this.config.maxQueueSize!;
    if (this.queue.length >= max) {
      const dropped = this.queue.shift();
      if (dropped) {
        this.log("🟠 queue full, evicted oldest", dropped.eventId);
        this.publish({
          type: "dropped",
          frameId: prepared.frameId,
          eventId: dropped.eventId,
          direction: "outbound",
          by: "override",
          ts: Date.now(),
        });
      }
    }

    this.queue.push({ eventId, event, payload: prepared.payload });
    this.log("🟡 queued", eventId, prepared.payload);
  }

  private flushQueue(): void {
    if (!this.queue.length) return;
    const pending = this.queue.splice(0, this.queue.length);
    for (const frame of pending) {
      this.log("🟢 flushing", frame.eventId);
      this.write(frame.event, frame.payload);
    }
  }

  /** The one place that touches `socket.emit`. */
  private write(
    event: string,
    payload: unknown,
    options?: EmitOptions,
    ack?: (raw: unknown) => void,
  ): void {
    const target = options?.volatile ? this.socket?.volatile : this.socket;
    if (ack) target?.emit(event, payload, ack);
    else target?.emit(event, payload);
  }

  /* ==========================================================================
   * INBOUND
   * ======================================================================== */

  /**
   * Builds the single socket.io listener for an event.
   *
   * Handlers are snapshotted before iteration so a handler that unsubscribes
   * (or that was registered via `once`) cannot perturb the dispatch in flight.
   */
  private makeDispatcher(
    eventId: string,
    event: string,
    def: ServerToClientDef,
  ): (raw: unknown) => void {
    return (raw: unknown) => {
      const frameId = this.nextFrameId();
      const override = this.resolveOverride(eventId, raw);

      if (override?.drop) {
        this.publish({
          type: "dropped",
          frameId,
          eventId,
          direction: "inbound",
          by: "override",
          ts: Date.now(),
        });
        return;
      }

      let payload = applyPayloadOverride(override, raw);

      const result = this.runMiddlewares({
        direction: "inbound",
        eventId,
        event,
        payload,
      });
      if (result === false) {
        this.publish({
          type: "dropped",
          frameId,
          eventId,
          direction: "inbound",
          by: "middleware",
          ts: Date.now(),
        });
        return;
      }
      if (result) payload = result.payload;

      const deliver = () => {
        const schema = override?.response ?? def.payload;
        const parsed = schema.safeParse(payload);

        if (!parsed.success) {
          const error = new SocketValidationError({
            eventId,
            phase: "payload",
            issues: parsed.error.issues,
            received: payload,
          });
          this.publish({
            type: "frame_error",
            frameId,
            eventId,
            direction: "inbound",
            error: error.toJSON(),
            ts: Date.now(),
          });
          this.handleValidationError(error);
          return;
        }

        this.publish({
          type: "inbound",
          frameId,
          eventId,
          event,
          payload: parsed.data,
          ts: Date.now(),
          injected: Boolean(override && "payload" in override),
        });
        this.log("🟣 on", eventId, parsed.data);

        const set = this.handlers.get(event);
        if (!set?.size) return;

        for (const entry of [...set]) {
          // `once` is consumed only on a *valid* payload, so an invalid frame
          // can't silently burn a one-shot subscription.
          if (entry.once) set.delete(entry);
          this.safely(() => entry.fn(parsed.data), `handler for ${eventId}`);
        }
      };

      if (override?.latencyMs) setTimeout(deliver, override.latencyMs);
      else deliver();
    };
  }

  /**
   * Resolves with the next valid payload for an event.
   *
   * Always detaches — on resolve, on timeout and on abort. v1 leaked a
   * listener per call because its `off()` could not match the wrapped handler.
   */
  private waitFor(
    eventId: string,
    event: string,
    options?: WaitOptions,
  ): Promise<unknown> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      let set = this.handlers.get(event);
      if (!set) {
        set = new Set();
        this.handlers.set(event, set);
      }

      const cleanup = () => {
        clearTimeout(timer);
        set!.delete(entry);
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const entry: HandlerEntry = {
        once: false,
        fn: (payload: unknown) => {
          // A non-matching payload leaves the wait armed rather than rejecting,
          // so an unrelated frame can't cancel someone else's wait.
          if (options?.filter && !options.filter(payload)) return;
          cleanup();
          resolve(payload);
        },
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new SocketWaitTimeoutError(eventId, timeoutMs));
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        reject(abortError(eventId));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      set.add(entry);
    });
  }

  /* ==========================================================================
   * INTERNALS
   * ======================================================================== */

  private runMiddlewares(frame: {
    direction: "inbound" | "outbound";
    eventId: string;
    event: string;
    payload: unknown;
  }): void | false | { payload: unknown } {
    if (!this.middlewares.length) return;

    let payload = frame.payload;
    let mutated = false;

    for (const middleware of this.middlewares) {
      let result: void | false | { payload: unknown };
      try {
        result = middleware({ ...frame, payload });
      } catch (error) {
        // A broken middleware must not take the frame down with it.
        console.error(
          `[typesocket] middleware threw on ${frame.direction} "${frame.eventId}"`,
          error,
        );
        continue;
      }
      if (result === false) return false;
      if (result && typeof result === "object" && "payload" in result) {
        payload = result.payload;
        mutated = true;
      }
    }

    return mutated ? { payload } : undefined;
  }

  private handleValidationError(error: SocketValidationError): void {
    if (this.config.onValidationError) {
      this.safely(() => this.config.onValidationError!(error), "onValidationError");
      return;
    }
    console.error(error.message, error.issues);
  }

  private reportFrameError(
    eventId: string,
    direction: "inbound" | "outbound",
    error: unknown,
  ): void {
    const normalized: ErrorLike =
      error instanceof SocketError
        ? error.toJSON()
        : { message: error instanceof Error ? error.message : String(error) };
    this.publish({
      type: "frame_error",
      frameId: this.nextFrameId(),
      eventId,
      direction,
      error: normalized,
      ts: Date.now(),
    });
    console.error(`[typesocket] ${direction} frame failed`, normalized);
  }

  private safely(fn: () => void, label: string): void {
    try {
      fn();
    } catch (error) {
      console.error(`[typesocket] ${label} threw`, error);
    }
  }

  private nextFrameId(): string {
    this.frameCounter += 1;
    return `f${this.frameCounter}`;
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) console.log("[typesocket]", ...args);
  }
}

/**
 * Convenience factory. Equivalent to `new SocketClient(...)`, and connects
 * immediately unless `autoConnect` is explicitly `false`.
 */
export function createSocketClient<const C extends SocketContracts>(
  config: SocketClientConfig,
  contracts: C,
  options?: SocketClientOptions,
): SocketClient<C> {
  const client = new SocketClient(config, contracts, options);
  if (config.autoConnect !== false) client.connect();
  return client;
}

function applyPayloadOverride(
  override: SocketOverride | undefined,
  payload: unknown,
): unknown {
  if (!override || !("payload" in override)) return payload;
  return typeof override.payload === "function"
    ? (override.payload as (p: unknown) => unknown)(payload)
    : override.payload;
}

function abortError(eventId: string): SocketError {
  return new SocketError(
    `[typesocket] "${eventId}" was aborted`,
    "ERR_SOCKET_ABORTED",
    eventId,
  );
}

/** Infers the payload/request type of a contract event. */
export type InferInput<E> = E extends { request: infer R extends z.ZodTypeAny }
  ? z.infer<R>
  : E extends { payload: infer P extends z.ZodTypeAny }
    ? z.infer<P>
    : never;

/** Infers the acknowledgement type of a contract event, or `never`. */
export type InferAck<E> = E extends { ack: infer A extends z.ZodTypeAny }
  ? z.infer<A>
  : never;
