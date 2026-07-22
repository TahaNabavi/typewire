import type { z } from "zod";

/**
 * A single Zod validation issue.
 *
 * Derived from `ZodError` by indexed access rather than importing a named
 * issue type, so it stays correct across Zod's internal type reshuffles.
 */
export type SocketIssue = z.ZodError["issues"][number];

/**
 * ErrorLike
 * =========
 * Normalized error shape shared with `@tahanabavi/typefetch`, so a devtools
 * bridge can render an HTTP failure and a WS failure through the same view.
 */
export type ErrorLike = {
  message: string;
  code?: string;
  eventId?: string;
  [key: string]: unknown;
};

/**
 * Base class for every error this package throws.
 *
 * Normalizes to `ErrorLike` via `toJSON()` rather than by implementing it —
 * `ErrorLike` carries an index signature for transport-specific extras, which
 * a concrete class can't satisfy.
 */
export class SocketError extends Error {
  readonly code: string;
  readonly eventId?: string;

  constructor(message: string, code: string, eventId?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.eventId = eventId;
    // Restores the prototype chain when compiled to ES5-era targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): ErrorLike {
    return { message: this.message, code: this.code, eventId: this.eventId };
  }
}

/** Which side of a frame failed its schema. */
export type ValidationPhase = "request" | "ack" | "payload";

/**
 * Thrown when a frame does not match its contract schema.
 *
 * Outbound frames throw this synchronously (or reject, when an ack is
 * declared) — unlike v1, which logged and silently dropped the emit. Inbound
 * frames never throw into unrelated user code; they are routed to
 * `onValidationError` instead.
 */
export class SocketValidationError extends SocketError {
  readonly phase: ValidationPhase;
  readonly issues: SocketIssue[];
  /** The value that failed validation. */
  readonly received: unknown;

  constructor(args: {
    eventId: string;
    phase: ValidationPhase;
    issues: SocketIssue[];
    received: unknown;
  }) {
    super(
      `[typesocket] ${args.phase} validation failed for "${args.eventId}": ${formatIssues(args.issues)}`,
      "ERR_SOCKET_VALIDATION",
      args.eventId,
    );
    this.phase = args.phase;
    this.issues = args.issues;
    this.received = args.received;
  }
}

/** Thrown when an emit that declares an `ack` gets no acknowledgement in time. */
export class SocketAckTimeoutError extends SocketError {
  readonly timeoutMs: number;

  constructor(eventId: string, timeoutMs: number) {
    super(
      `[typesocket] No acknowledgement for "${eventId}" within ${timeoutMs}ms`,
      "ERR_SOCKET_ACK_TIMEOUT",
      eventId,
    );
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when an emit is attempted with no live connection.
 *
 * v1 silently no-opped here (`this.socket?.emit(...)`), losing the frame with
 * no signal. Use `.queue(input)` when buffering is what you want.
 */
export class SocketNotConnectedError extends SocketError {
  constructor(eventId: string) {
    super(
      `[typesocket] Socket is not connected; cannot emit "${eventId}". Use .queue() to buffer until connect.`,
      "ERR_SOCKET_NOT_CONNECTED",
      eventId,
    );
  }
}

/** Thrown when `.wait()` times out or its signal aborts. */
export class SocketWaitTimeoutError extends SocketError {
  readonly timeoutMs: number;

  constructor(eventId: string, timeoutMs: number) {
    super(
      `[typesocket] Timed out waiting ${timeoutMs}ms for "${eventId}"`,
      "ERR_SOCKET_WAIT_TIMEOUT",
      eventId,
    );
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when an instrumentation override forces a failure. */
export class SocketOverrideError extends SocketError {
  constructor(eventId: string, message: string, code = "ERR_SOCKET_OVERRIDE") {
    super(message, code, eventId);
  }
}

function formatIssues(issues: SocketIssue[]): string {
  return issues
    .slice(0, 3)
    .map((i) => {
      const at = i.path.length ? i.path.join(".") : "<root>";
      return `${at}: ${i.message}`;
    })
    .join("; ");
}
