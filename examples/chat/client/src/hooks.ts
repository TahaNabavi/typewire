import { useEffect, useRef, useState } from "react";
import type { SocketEvent } from "@tahanabavi/typesocket";

import { socket } from "./socket.js";

/**
 * React bindings for typesocket.
 *
 * They stay this small because the client already returns an unsubscribe from
 * every subscription — the hook is just `useEffect` plus a ref so a changing
 * handler doesn't churn the subscription.
 */

/**
 * Subscribes to a `server->client` event for the lifetime of the component.
 *
 * The payload type is inferred structurally from the event's `on` signature, so
 * `useSocketEvent(socket.modules.chat.message, m => …)` types `m` straight from
 * the contract with no generic to pass.
 */
export function useSocketEvent<P>(
  event: { on(handler: (payload: P) => void): () => void },
  handler: (payload: P) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    // Subscribing through the ref means a new inline handler on every render
    // doesn't tear down and re-create the subscription.
    return event.on((payload) => ref.current(payload));
  }, [event]);
}

/** Tracks connection state, including the reconnect count. */
export function useConnection() {
  const [state, setState] = useState(() => ({
    connected: socket.connected,
    socketId: socket.id,
    attempt: 0,
    error: null as string | null,
  }));

  useEffect(() => {
    socket.connect();

    const offs = [
      socket.onConnect(({ socketId, attempt }) =>
        setState({ connected: true, socketId, attempt, error: null }),
      ),
      socket.onDisconnect((reason) =>
        setState((s) => ({ ...s, connected: false, error: reason })),
      ),
      socket.onConnectError((error) =>
        setState((s) => ({ ...s, connected: false, error: error.message })),
      ),
    ];

    // Deliberately not calling socket.destroy() — the client is module-scoped
    // and outlives this component. Only the subscriptions are cleaned up.
    return () => offs.forEach((off) => off());
  }, []);

  return state;
}

export type Frame = SocketEvent & { key: number };

/**
 * Mirrors the instrumentation stream into React state.
 *
 * This is the whole devtools seam: one hook, every frame, already parsed.
 * `@tahanabavi/type-devtools` will render exactly this feed.
 */
export function useFrameLog(limit = 60) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const seq = useRef(0);

  useEffect(
    () =>
      socket.instrument({
        on(event) {
          setFrames((prev) => [{ ...event, key: seq.current++ }, ...prev].slice(0, limit));
        },
      }),
    [limit],
  );

  return { frames, clear: () => setFrames([]) };
}
