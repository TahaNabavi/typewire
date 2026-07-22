import type { z } from "zod";
import type { ErrorLike } from "./errors";

/* ============================================================================
 * CONTRACT
 * ========================================================================== */

/**
 * Which way a frame travels.
 *
 * Direction is declared on the event itself rather than implied by which map
 * the event was passed in. That is what lets a single contract object be read
 * correctly from *both* ends: the client emits `client->server` events and
 * listens to `server->client` ones, while a server gateway
 * (`@tahanabavi/typewire-nestjs`) does exactly the reverse — from the same
 * object, with no mirrored second declaration to drift.
 */
export type EventDirection = "client->server" | "server->client";

/** An event the client sends and the server handles. */
export type ClientToServerDef<
  TReq extends z.ZodTypeAny = z.ZodTypeAny,
  TAck extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  direction: "client->server";
  /** Wire event name. Defaults to the key the event is declared under. */
  event?: string;
  /** Schema for the payload sent to the server. */
  request: TReq;
  /**
   * Schema for the server's acknowledgement. Declaring this changes the emit
   * from fire-and-forget to `Promise<Ack>` — and the ack is *validated*, which
   * v1 declared but never enforced.
   */
  ack?: TAck;
  /** Per-event ack timeout, overriding the client default. */
  ackTimeoutMs?: number;
  /** Human-readable description, surfaced by devtools and docs tooling. */
  description?: string;
};

/** An event the server pushes and the client listens for. */
export type ServerToClientDef<TPayload extends z.ZodTypeAny = z.ZodTypeAny> = {
  direction: "server->client";
  /** Wire event name. Defaults to the key the event is declared under. */
  event?: string;
  /** Schema for the payload pushed by the server. */
  payload: TPayload;
  /** Human-readable description, surfaced by devtools and docs tooling. */
  description?: string;
};

export type SocketEventDef = ClientToServerDef | ServerToClientDef;

/**
 * A module-grouped map of socket events — structurally parallel to
 * `typefetch`'s `Contracts`, so both transports produce the same
 * `"module.event"` identifier shape and higher layers can key them uniformly.
 */
export type SocketContracts = {
  [module: string]: { [event: string]: SocketEventDef };
};

/* ============================================================================
 * GENERATED SURFACE
 * ========================================================================== */

/** Detaches a listener. Returned by every subscribe call so cleanup is local. */
export type Unsubscribe = () => void;

export type EmitOptions = {
  /** Overrides the event/client ack timeout for this call. */
  timeoutMs?: number;
  /** Cancels a pending ack. */
  signal?: AbortSignal;
  /** Drops the frame if the socket is not writable (socket.io volatile emit). */
  volatile?: boolean;
};

export type WaitOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Resolve only when the payload satisfies this predicate. */
  filter?: (payload: any) => boolean;
};

/** Resolves an event's ack schema, or `never` when none is declared. */
type AckOf<E> = E extends { ack: infer A extends z.ZodTypeAny } ? A : never;

/**
 * The callable produced for a `client->server` event.
 *
 * Returns `Promise<Ack>` when the contract declares an `ack`, and `void`
 * otherwise — so the type tells you whether awaiting is meaningful.
 */
export type EmitApi<E extends ClientToServerDef = ClientToServerDef> = {
  (
    input: z.infer<E["request"]>,
    options?: EmitOptions,
  ): E extends { ack: z.ZodTypeAny } ? Promise<z.infer<AckOf<E>>> : void;

  /**
   * Validates now, sends on the next connect. Frames flush in declaration
   * order. Throws immediately if `input` fails its schema, so a bad payload
   * can't sit in the buffer until connect to fail invisibly.
   */
  queue(input: z.infer<E["request"]>): void;

  /** Stable `"module.event"` identifier — the cross-package key. */
  readonly eventId: string;
  /** The wire event name actually sent. */
  readonly event: string;
  /** The originating contract definition. */
  readonly def: E;
};

/** The listener object produced for a `server->client` event. */
export type ListenApi<E extends ServerToClientDef = ServerToClientDef> = {
  /** Subscribes. Returns an unsubscribe function. */
  on(handler: (payload: z.infer<E["payload"]>) => void): Unsubscribe;
  /** Subscribes for exactly one *valid* payload. */
  once(handler: (payload: z.infer<E["payload"]>) => void): Unsubscribe;
  /** Detaches a handler registered via `on`/`once`. */
  off(handler: (payload: z.infer<E["payload"]>) => void): void;
  /** Detaches every handler for this event. */
  offAll(): void;
  /** Resolves with the next valid payload. */
  wait(options?: WaitOptions): Promise<z.infer<E["payload"]>>;
  /** Number of currently attached handlers. */
  readonly listenerCount: number;

  /** Stable `"module.event"` identifier — the cross-package key. */
  readonly eventId: string;
  /** The wire event name actually listened to. */
  readonly event: string;
  /** The originating contract definition. */
  readonly def: E;
};

/** Picks the right API shape for an event based on its declared direction. */
export type EventApi<E extends SocketEventDef> = E extends ClientToServerDef
  ? EmitApi<E>
  : E extends ServerToClientDef
    ? ListenApi<E>
    : never;

/** The full generated surface: `client.modules.<module>.<event>`. */
export type SocketModules<C extends SocketContracts> = {
  [M in keyof C]: { [E in keyof C[M]]: EventApi<C[M][E]> };
};

/* ============================================================================
 * MIDDLEWARE
 * ========================================================================== */

export type SocketFrame = {
  direction: "inbound" | "outbound";
  /** Stable `"module.event"` identifier. */
  eventId: string;
  /** The wire event name. */
  event: string;
  /** Raw, not-yet-validated payload. */
  payload: unknown;
};

/**
 * Runs on every frame in both directions, before validation.
 *
 * Unlike v1 — which only saw inbound frames and could only observe — a
 * middleware may drop a frame by returning `false`, or rewrite it by returning
 * `{ payload }`. Returning `undefined` passes the frame through untouched.
 */
export type SocketMiddleware = (
  frame: SocketFrame,
) => void | false | { payload: unknown };

/* ============================================================================
 * INSTRUMENTATION — the devtools / query-layer seam
 * ========================================================================== */

/**
 * Structured lifecycle events, emitted only while at least one instrumentation
 * hook is attached. Mirrors `typefetch`'s `RequestEvent` so
 * `@tahanabavi/type-devtools-core` can map both transports into one timeline.
 *
 * Purely observational: these never change what the caller receives.
 */
export type SocketLifecycleEvent =
  | { type: "connect"; ts: number; socketId?: string; attempt: number }
  | { type: "disconnect"; ts: number; reason: string }
  | { type: "connect_error"; ts: number; error: ErrorLike };

export type SocketFrameEvent =
  | {
      type: "outbound";
      /** Correlates this frame with its `ack` / `frame_error`. */
      frameId: string;
      eventId: string;
      event: string;
      payload: unknown;
      ts: number;
      /** `true` when the frame was buffered rather than sent immediately. */
      queued: boolean;
      /** `true` when the contract declares an ack. */
      expectsAck: boolean;
    }
  | {
      type: "ack";
      frameId: string;
      eventId: string;
      /** The parsed, typed acknowledgement returned to the caller. */
      data: unknown;
      durationMs: number;
      /** `true` when an override supplied the ack instead of the server. */
      fromMock: boolean;
    }
  | {
      type: "inbound";
      frameId: string;
      eventId: string;
      event: string;
      /** The parsed, typed payload delivered to handlers. */
      payload: unknown;
      ts: number;
      /** `true` when an override injected the frame. */
      injected: boolean;
    }
  | {
      type: "dropped";
      frameId: string;
      eventId: string;
      direction: "inbound" | "outbound";
      /** What discarded the frame. */
      by: "middleware" | "override";
      ts: number;
    }
  | {
      type: "frame_error";
      frameId: string;
      eventId: string;
      direction: "inbound" | "outbound";
      error: ErrorLike;
      ts: number;
    };

export type SocketEvent = SocketLifecycleEvent | SocketFrameEvent;

/**
 * A runtime, per-frame override resolved from an instrumentation hook.
 *
 * Lets a devtools panel change what one frame does **without mutating the
 * contract** — drop it, delay it, rewrite it, fake an ack, or swap the schema
 * to test a structural change. Every field is optional and independent.
 */
export type SocketOverride = {
  /** Discard the frame: don't send it (outbound) / don't dispatch it (inbound). */
  drop?: boolean;
  /** Artificial latency (ms) applied before the frame is processed. */
  latencyMs?: number;
  /** Replace the payload, or derive a replacement from it. */
  payload?: unknown | ((payload: unknown) => unknown);
  /**
   * Answer an ack locally, bypassing the network. Still validated against the
   * (possibly overridden) ack schema, so a mock can't claim a shape the
   * contract forbids.
   */
  ack?: unknown | ((input: unknown) => unknown);
  /** Force a failure instead of sending/dispatching. */
  error?: { code?: string; message?: string };
  /** Swap the outbound request schema at runtime. */
  request?: z.ZodTypeAny;
  /** Swap the inbound payload / ack schema at runtime. */
  response?: z.ZodTypeAny;
};

/**
 * An optional, additive hook registered via `client.instrument(...)`.
 *
 * Multiple hooks may attach; `on` receives every event, and the first hook to
 * return an override from `resolveOverride` wins for that frame. With no hook
 * attached, frame handling is identical to the un-instrumented path.
 */
export type SocketInstrumentation = {
  /** Receives each lifecycle and frame event. */
  on?: (event: SocketEvent) => void;
  /** Resolve a per-frame override, or `undefined` to leave the frame alone. */
  resolveOverride?: (
    eventId: string,
    payload: unknown,
  ) => SocketOverride | undefined;
};

/** One entry of the contract map, flattened. Used by devtools and codegen. */
export type SocketEventMeta = {
  eventId: string;
  module: string;
  name: string;
  event: string;
  direction: EventDirection;
  description?: string;
};

/* ============================================================================
 * CONFIG
 * ========================================================================== */

export type SocketClientConfig = {
  /** Server URL, e.g. `https://api.example.com` or `/`. */
  url: string;
  /** socket.io endpoint path. Defaults to `/socket.io`. */
  path?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  reconnectionDelayMax?: number;
  timeout?: number;
  transports?: Array<"websocket" | "polling">;
  /**
   * Handshake auth. A function is re-invoked on every (re)connect, so a
   * refreshed token is picked up without rebuilding the client.
   */
  auth?: Record<string, unknown> | (() => Record<string, unknown>);
  query?: Record<string, string>;
  withCredentials?: boolean;
  extraHeaders?: Record<string, string>;

  /** Default ack timeout in ms for emits that declare an ack. Defaults to 10000. */
  ackTimeoutMs?: number;
  /** Max frames held by `.queue()` while disconnected. Defaults to 100. */
  maxQueueSize?: number;
  /** Verbose frame logging. */
  debug?: boolean;

  /**
   * Called when an *inbound* frame fails its schema. Inbound failures can't
   * throw into unrelated user code, so they surface here. Defaults to
   * `console.error`; pass a no-op to silence.
   */
  onValidationError?: (error: import("./errors").SocketValidationError) => void;

  /** Escape hatch for socket.io options not modelled above. */
  ioOptions?: Record<string, unknown>;
};

export type SocketClientOptions = {
  middlewares?: SocketMiddleware[];
  onConnect?: (info: { socketId?: string; attempt: number }) => void;
  onDisconnect?: (reason: string) => void;
  onConnectError?: (error: ErrorLike) => void;
};
