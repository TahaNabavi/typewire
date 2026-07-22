---
"@tahanabavi/typesocket": major
---

Rewrite typesocket around a direction-tagged contract, replacing `SocketService` with `SocketClient`.

**Contract.** One contract object replaces the separate `onEvents` / `emitEvents` maps. Each event declares its own `direction`, so the same object reads correctly from both ends — the client emits `client->server` events and listens to `server->client` ones, and a server gateway does the reverse without a mirrored copy that can drift. Events are grouped into modules and carry a stable `eventId` (`"chat.sendMessage"`), matching typefetch's `"module.endpoint"` scheme so higher layers key both transports identically.

**Instrumentation seam.** New `client.instrument({ on, resolveOverride })`, mirroring typefetch. Emits structured lifecycle and frame events (`outbound`/`ack`/`inbound`/`dropped`/`frame_error`, correlated by `frameId`) and resolves per-frame overrides — drop, delay, rewrite, mock an ack, or swap a schema — without mutating the contract. Zero cost when no hook is attached. This is what `connectTypeSocket` in `@tahanabavi/type-devtools-core` needs in order to exist.

**Correctness fixes.** Each of these changes observable behaviour:

- Handlers fired **twice** on the first connection, and once more per reconnect: `on()` registered a wrapped handler on the socket *and* stored it for re-registration on `connect`. One dispatcher is now bound per event and fans out to a local registry.
- `off()` could never remove anything — it passed the user's callback while the socket held a wrapper. Removal now happens in the registry.
- `waitFor()` leaked a listener on every call (same cause) and rejected when *any* frame on that event failed validation. `.wait()` always detaches, and an invalid frame leaves it armed.
- The `callback` schema was declared and typed but never enforced; `emitAsync` resolved the raw server value. Acks are now validated, and a non-conforming ack rejects.
- `emitAsync` had no timeout and hung forever if the server never acked. Ack timeouts are now enforced (`ackTimeoutMs`, per-event or per-call) and `AbortSignal` is supported.
- Invalid emits were logged to `console.error` and silently dropped; emits with no connection silently no-opped. Both now throw typed errors (`SocketValidationError`, `SocketNotConnectedError`).
- `emitQueued` buffered unvalidated data and flushed it raw. `.queue()` validates at call time, and the buffer is bounded with oldest-first eviction.
- `reconnectWithBackoff()` called `init()` without disconnecting, leaking a socket per attempt, and never reset its counter. Removed — socket.io's own backoff is configured via `reconnectionDelay` / `reconnectionDelayMax`.
- `getSocketConfig()` read `NEXT_PUBLIC_*` off bare `process.env` at import time, which throws in a browser bundle with no `process` shim. Replaced by `socketConfigFromEnv(prefix, env?)`, which is prefix-driven and guards its environment access.

**Also new.** Typed error hierarchy with stable codes; middleware over both directions that can drop (`false`) or rewrite (`{ payload }`) a frame; `.wait({ filter })`; `destroy()`; `listenerCount`; `client.events` for tooling; function-valued `auth` re-invoked on every reconnect; strict-mode TypeScript.

`zod` and `socket.io-client` move from dependencies to **peer dependencies** (matching typefetch), and `typescript` is no longer a runtime dependency.

See the package README for a full v1 → v2 migration table.
