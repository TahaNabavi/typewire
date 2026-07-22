import type { SocketClientConfig } from "./types";

/** Ack timeout applied when neither the event nor the client overrides it. */
export const DEFAULT_ACK_TIMEOUT_MS = 10_000;
/** Frames buffered by `.queue()` before the oldest is evicted. */
export const DEFAULT_MAX_QUEUE_SIZE = 100;
/** Timeout applied by `.wait()` when the caller passes none. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

/**
 * Minimal environment surface. Declared structurally so this module compiles
 * and runs in a browser bundle with no `process` shim — v1 read `process.env`
 * unconditionally at import time, which throws in that setting.
 */
export type EnvLike = Record<string, string | undefined>;

function safeProcessEnv(): EnvLike {
  try {
    return typeof process !== "undefined" && process.env ? process.env : {};
  } catch {
    return {};
  }
}

/**
 * Builds a config from environment variables.
 *
 * Prefix-driven rather than hardcoded to `NEXT_PUBLIC_*` as in v1: pass
 * `"NEXT_PUBLIC_SOCKET_"` for Next.js, `"VITE_SOCKET_"` for Vite, or the
 * default `"SOCKET_"` on a server. Only variables that are actually present
 * produce keys, so the result layers cleanly over explicit config.
 *
 * Recognised suffixes: `URL`, `PATH`, `AUTO_CONNECT`, `RECONNECTION`,
 * `RECONNECTION_ATTEMPTS`, `RECONNECTION_DELAY`, `ACK_TIMEOUT`, `AUTH_TOKEN`,
 * `QUERY_PARAMS` (JSON), `TRANSPORTS` (comma-separated), `DEBUG`.
 */
export function socketConfigFromEnv(
  prefix = "SOCKET_",
  env: EnvLike = safeProcessEnv(),
): Partial<SocketClientConfig> {
  const read = (key: string) => env[`${prefix}${key}`];
  const config: Partial<SocketClientConfig> = {};

  const url = read("URL");
  if (url) config.url = url;

  const path = read("PATH");
  if (path) config.path = path;

  const autoConnect = read("AUTO_CONNECT");
  if (autoConnect !== undefined) config.autoConnect = autoConnect !== "false";

  const reconnection = read("RECONNECTION");
  if (reconnection !== undefined) config.reconnection = reconnection !== "false";

  const attempts = toInt(read("RECONNECTION_ATTEMPTS"));
  if (attempts !== undefined) config.reconnectionAttempts = attempts;

  const delay = toInt(read("RECONNECTION_DELAY"));
  if (delay !== undefined) config.reconnectionDelay = delay;

  const ackTimeout = toInt(read("ACK_TIMEOUT"));
  if (ackTimeout !== undefined) config.ackTimeoutMs = ackTimeout;

  const token = read("AUTH_TOKEN");
  if (token) config.auth = { token };

  const query = read("QUERY_PARAMS");
  if (query) {
    try {
      config.query = JSON.parse(query) as Record<string, string>;
    } catch {
      // A malformed env var must not take the app down at import time.
      console.warn(
        `[typesocket] Ignoring ${prefix}QUERY_PARAMS — not valid JSON.`,
      );
    }
  }

  const transports = read("TRANSPORTS");
  if (transports) {
    config.transports = transports
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is "websocket" | "polling" =>
        t === "websocket" || t === "polling",
      );
  }

  const debug = read("DEBUG");
  if (debug !== undefined) config.debug = debug === "true";

  return config;
}

/** Fills in defaults for everything the caller left unset. */
export function resolveSocketConfig(
  config: SocketClientConfig,
): Required<Pick<SocketClientConfig, "url" | "ackTimeoutMs" | "maxQueueSize" | "debug">> &
  SocketClientConfig {
  return {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    ...config,
    url: config.url || "/",
    ackTimeoutMs: config.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
    maxQueueSize: config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
    debug: config.debug ?? false,
  };
}

/** Maps our config onto the options object socket.io actually accepts. */
export function toIoOptions(
  config: SocketClientConfig,
): Record<string, unknown> {
  // socket.io takes either a static object or a callback form. Mapping a
  // function to the callback form means it is re-invoked on every reconnect,
  // so a refreshed token is picked up without rebuilding the client.
  const authFn = config.auth;
  const auth =
    typeof authFn === "function"
      ? (cb: (data: Record<string, unknown>) => void) => cb(authFn())
      : authFn;

  return {
    path: config.path,
    autoConnect: config.autoConnect,
    reconnection: config.reconnection,
    reconnectionAttempts: config.reconnectionAttempts,
    reconnectionDelay: config.reconnectionDelay,
    reconnectionDelayMax: config.reconnectionDelayMax,
    timeout: config.timeout,
    transports: config.transports,
    withCredentials: config.withCredentials,
    extraHeaders: config.extraHeaders,
    query: config.query,
    auth,
    ...config.ioOptions,
  };
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}
