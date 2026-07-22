# @tahanabavi/typesocket

[![npm](https://img.shields.io/npm/v/%40tahanabavi%2Ftypesocket?color=8b5cf6)](https://www.npmjs.com/package/@tahanabavi/typesocket)
[![Zod](https://img.shields.io/badge/contracts-Zod%204-3e67b1?logo=zod&logoColor=white)](https://zod.dev)
[![license](https://img.shields.io/badge/license-MIT-22d3ee)](./LICENSE)

**Contract-driven Socket.IO for TypeScript.** Declare each event once — with its
direction and its Zod schemas — and the client generates itself. Every frame is
validated on the way out *and* on the way in, acknowledgements included.

Part of [TypeWire](https://github.com/TahaNabavi/typewire), so it shares
`typefetch`'s `"module.event"` identifier scheme and its `instrument()` seam:
HTTP and WebSocket traffic land in one devtools timeline with no adapter glue.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Why direction belongs in the contract](#why-direction-belongs-in-the-contract)
- [Emitting](#emitting)
- [Listening](#listening)
- [Errors](#errors)
- [Middleware](#middleware)
- [Instrumentation & overrides](#instrumentation--overrides)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Migrating from v1](#migrating-from-v1)
- [Examples & release notes](#examples--release-notes)
- [License](#license)

---

## Install

```bash
npm install @tahanabavi/typesocket zod socket.io-client
```

`zod` and `socket.io-client` are **peer dependencies** — schemas only compare
correctly when every package shares one `zod` instance.

---

## Quick start

**1. Declare the contract.** This file is imported by the frontend *and* the
backend:

```ts
// ws-contracts.ts
import { z } from "zod";
import { defineSocketContracts } from "@tahanabavi/typesocket";

export const wsContracts = defineSocketContracts({
  chat: {
    sendMessage: {
      direction: "client->server",
      request: z.object({ roomId: z.string(), text: z.string().min(1) }),
      ack: z.object({ id: z.string(), sentAt: z.number() }),
    },
    typing: {
      direction: "client->server",
      request: z.object({ roomId: z.string(), isTyping: z.boolean() }),
    },
    message: {
      direction: "server->client",
      payload: z.object({ id: z.string(), text: z.string(), user: z.string() }),
    },
  },
});
```

**2. Use it.** The client is generated from the contract — there is no event
name to mistype and no payload shape to keep in sync:

```ts
import { createSocketClient } from "@tahanabavi/typesocket";
import { wsContracts } from "./ws-contracts";

const client = createSocketClient({ url: "http://localhost:3001" }, wsContracts);

// server -> client: listening. `m` is fully typed.
const off = client.modules.chat.message.on((m) => console.log(m.user, m.text));

// client -> server with an ack: returns a Promise of the *validated* ack.
const { id } = await client.modules.chat.sendMessage({ roomId: "r1", text: "hi" });

// client -> server without an ack: fire-and-forget, returns void.
client.modules.chat.typing({ roomId: "r1", isTyping: true });

off(); // unsubscribe
```

Whether an emit returns `Promise<Ack>` or `void` is decided by the contract:
declare `ack` and awaiting is meaningful, omit it and the return type is `void`.

---

## Why direction belongs in the contract

v1 took two maps — `onEvents` and `emitEvents` — named from the client's point
of view. That works for a client and only a client: a server gateway consuming
the same object needs them swapped, so it had to declare a mirrored copy that
could drift.

Tagging each event with `direction` makes the contract readable from both ends.
The client emits `client->server` events and listens to `server->client` ones;
a server adapter does exactly the reverse, from the same object. It also gives
every event a stable `eventId` (`"chat.sendMessage"`) — the same
`"module.endpoint"` shape `typefetch` uses — so a cache or a devtools panel can
key both transports the same way.

```ts
client.modules.chat.sendMessage.eventId; // "chat.sendMessage"
client.modules.chat.sendMessage.def;     // the contract definition
client.events;                           // every event, flattened, for tooling
```

---

## Emitting

```ts
// Ack declared → Promise, rejecting on validation failure or timeout.
const ack = await client.modules.chat.sendMessage(
  { roomId: "r1", text: "hi" },
  { timeoutMs: 3_000, signal: controller.signal },
);

// No ack declared → void, throwing synchronously on an invalid payload.
client.modules.chat.typing({ roomId: "r1", isTyping: true });

// Validate now, send on the next connect.
client.modules.chat.typing.queue({ roomId: "r1", isTyping: false });
```

`queue()` validates **at call time**, so a malformed payload fails where you
wrote it instead of going out unvalidated minutes later. Buffered frames flush
in order on connect; the buffer is bounded by `maxQueueSize` (default 100) and
evicts oldest-first.

**Acks are validated.** If the server answers `sendMessage` with something that
doesn't match the `ack` schema, the promise rejects with a
`SocketValidationError` rather than resolving a value whose type is a lie.

---

## Listening

```ts
const off = client.modules.chat.message.on((m) => render(m));
off();                                      // or .off(handler) / .offAll()

client.modules.chat.message.once((m) => greet(m));

// Resolve on the next matching payload.
const mine = await client.modules.chat.message.wait({
  timeoutMs: 5_000,
  filter: (m) => m.user === "taha",
});
```

Every subscribe call returns its own unsubscribe function. Subscriptions live
in the client, not on the socket, so they survive `reconnect()` — and exactly
one socket listener is bound per event no matter how many handlers you attach,
so nothing double-fires across reconnects.

Inbound payloads that fail validation never reach handlers. They go to
`onValidationError` instead (default: `console.error`), because throwing into
an unrelated handler's call stack helps nobody.

---

## Errors

Every error extends `SocketError` and carries a stable `code` plus the
`eventId` it belongs to.

| Class | Code | Raised when |
| --- | --- | --- |
| `SocketValidationError` | `ERR_SOCKET_VALIDATION` | A frame fails its schema. `phase` is `"request"`, `"ack"` or `"payload"`; `issues` holds the Zod issues. |
| `SocketAckTimeoutError` | `ERR_SOCKET_ACK_TIMEOUT` | No acknowledgement arrived in time. |
| `SocketNotConnectedError` | `ERR_SOCKET_NOT_CONNECTED` | An emit was attempted with no live connection. |
| `SocketWaitTimeoutError` | `ERR_SOCKET_WAIT_TIMEOUT` | `.wait()` expired. |
| `SocketOverrideError` | `ERR_SOCKET_OVERRIDE` | An instrumentation override forced a failure. |

```ts
import { SocketValidationError } from "@tahanabavi/typesocket";

try {
  await client.modules.chat.sendMessage({ roomId: "r1", text: "" });
} catch (error) {
  if (error instanceof SocketValidationError) console.error(error.issues);
}
```

---

## Middleware

Middleware sees **both** directions and can observe, rewrite, or drop a frame.

```ts
const remove = client.use((frame) => {
  console.debug(frame.direction, frame.eventId, frame.payload);

  if (frame.direction === "outbound" && isRateLimited(frame.eventId)) {
    return false; // drop it
  }
  if (frame.direction === "outbound") {
    return { payload: { ...(frame.payload as object), ts: Date.now() } };
  }
});
```

Returning `undefined` passes the frame through, `false` drops it, and
`{ payload }` replaces it. Rewrites happen **before** validation, so a
middleware can't smuggle a payload past the contract. A middleware that throws
is logged and skipped — it never takes the frame down with it.

---

## Instrumentation & overrides

The seam higher layers build on, mirroring `typefetch`'s `client.instrument()`.
Attaching a hook is the only thing that turns event construction on — with no
hook, the path is identical to the un-instrumented one.

```ts
const detach = client.instrument({
  on(event) {
    // "connect" | "disconnect" | "connect_error"
    // "outbound" | "ack" | "inbound" | "dropped" | "frame_error"
    timeline.push(event);
  },
  resolveOverride(eventId, payload) {
    if (eventId === "chat.sendMessage") {
      return { latencyMs: 800, ack: { id: "mocked", sentAt: Date.now() } };
    }
  },
});
```

`outbound` and its `ack`/`frame_error` share a `frameId`, so a panel can pair
them. Overrides let a devtools panel change one frame **without touching the
contract**:

| Field | Effect |
| --- | --- |
| `drop` | Discard the frame. An emit awaiting an ack then times out, as a lost packet would. |
| `latencyMs` | Delay the frame. |
| `payload` | Replace the payload (value or deriving function). |
| `ack` | Answer locally, bypassing the network. Still validated. |
| `error` | Force a failure. |
| `request` / `response` | Swap a schema at runtime to test a structural change. |

The first hook that returns an override wins for that frame.

---

## Configuration

```ts
const client = new SocketClient(
  {
    url: "http://localhost:3001",
    auth: () => ({ token: getToken() }), // re-invoked on every reconnect
    ackTimeoutMs: 10_000,
    maxQueueSize: 100,
    debug: false,
    onValidationError: (error) => reportToSentry(error),
  },
  wsContracts,
  {
    onConnect: ({ socketId, attempt }) => console.log(socketId, attempt),
    onDisconnect: (reason) => console.log(reason),
    onConnectError: (error) => console.error(error.message),
    middlewares: [logger],
  },
);

client.connect();
```

Reading config from the environment is prefix-driven rather than hardcoded to
Next.js, and only produces keys for variables that are actually set — so it
layers cleanly over explicit config:

```ts
import { socketConfigFromEnv } from "@tahanabavi/typesocket";

const client = new SocketClient(
  { url: "/", ...socketConfigFromEnv("NEXT_PUBLIC_SOCKET_") },
  wsContracts,
);
```

Recognised suffixes: `URL`, `PATH`, `AUTO_CONNECT`, `RECONNECTION`,
`RECONNECTION_ATTEMPTS`, `RECONNECTION_DELAY`, `ACK_TIMEOUT`, `AUTH_TOKEN`,
`QUERY_PARAMS` (JSON), `TRANSPORTS` (comma-separated), `DEBUG`.

---

## API reference

### Client

| Member | Description |
| --- | --- |
| `new SocketClient(config, contracts, options?)` | Builds the client. Throws on an invalid contract. |
| `createSocketClient(config, contracts, options?)` | Same, and connects unless `autoConnect: false`. |
| `.modules` | The generated surface — `modules.<module>.<event>`. |
| `.connect()` / `.disconnect()` / `.reconnect()` | Connection control. `connect()` is idempotent. |
| `.destroy()` | Disconnect and drop every handler, middleware and hook. |
| `.use(middleware)` | Attach middleware. Returns a remover. |
| `.instrument(hook)` | Attach an instrumentation hook. Returns a detacher. |
| `.onConnect/.onDisconnect/.onConnectError(fn)` | Lifecycle subscriptions. Each returns an unsubscribe. |
| `.connected` · `.id` · `.raw` · `.queueSize` · `.events` | Introspection. |

### `client->server` events

| Member | Description |
| --- | --- |
| `(input, options?)` | Validate and emit. `Promise<Ack>` when `ack` is declared, else `void`. |
| `.queue(input)` | Validate now, send on the next connect. |
| `.eventId` · `.event` · `.def` | Metadata for tooling. |

### `server->client` events

| Member | Description |
| --- | --- |
| `.on(handler)` / `.once(handler)` | Subscribe. Returns an unsubscribe. |
| `.off(handler)` / `.offAll()` | Detach. |
| `.wait(options?)` | Resolve on the next valid (optionally filtered) payload. |
| `.listenerCount` | Live handler count. |
| `.eventId` · `.event` · `.def` | Metadata for tooling. |

### Contract helpers

`defineSocketContracts` · `listSocketEvents` · `validateSocketContracts` ·
`isClientToServer` · `isServerToClient` · `makeEventId` · `resolveEventName`

---

## Migrating from v1

v2 replaces `SocketService` with `SocketClient`. The rewrite also fixes
correctness bugs that were not fixable without changing behaviour, so upgrading
is worth doing deliberately rather than mechanically.

**Contract:** merge the two maps into one, tagging each event's direction and
grouping into modules. `response` becomes `payload`, `callback` becomes `ack`.

```ts
// v1
const onEvents   = { message:     { response: MessageSchema } };
const emitEvents = { sendMessage: { request: ReqSchema, callback: AckSchema } };

// v2
const wsContracts = defineSocketContracts({
  chat: {
    message:     { direction: "server->client", payload: MessageSchema },
    sendMessage: { direction: "client->server", request: ReqSchema, ack: AckSchema },
  },
});
```

**Call sites:**

| v1 | v2 |
| --- | --- |
| `new SocketService(cfg, on, emit, handlers).init()` | `new SocketClient(cfg, contracts, options).connect()` |
| `socket.on("message", fn)` | `client.modules.chat.message.on(fn)` |
| `socket.off("message", fn)` | `client.modules.chat.message.off(fn)` — now actually detaches |
| `socket.emit("sendMessage", d)` | `client.modules.chat.sendMessage(d)` |
| `socket.emitAsync("sendMessage", d)` | `client.modules.chat.sendMessage(d)` — ack now validated, and it times out |
| `socket.emitQueued("sendMessage", d)` | `client.modules.chat.sendMessage.queue(d)` |
| `socket.waitFor("message", ms)` | `client.modules.chat.message.wait({ timeoutMs: ms })` |
| `socket.enableDebug()` | `debug: true` in config |
| `socket.reconnectWithBackoff()` | removed — socket.io's own backoff is configured via `reconnectionDelay` / `reconnectionDelayMax` |
| `getSocketConfig()` | `socketConfigFromEnv(prefix)` |

**Behaviour changes to plan for:**

- Handlers used to fire **twice** on the first connection (and once more per
  reconnect) because listeners were registered on the socket *and* re-registered
  on `connect`. They now fire once. Code that compensated for the duplicate
  needs the workaround removed.
- `off()` never removed anything in v1. It does now — check nothing relied on a
  handler surviving its own removal.
- Invalid outbound payloads used to be logged and dropped. They now **throw**
  (or reject). Wrap emits that can receive user input.
- Emits with no connection used to be silently discarded. They now throw
  `SocketNotConnectedError`; use `.queue()` where buffering was the intent.
- `emitAsync` had no timeout and never validated the ack. Both are enforced now,
  so a previously-hanging call fails loudly and a non-conforming ack rejects.

---

## Examples & release notes

| | |
| --- | --- |
| [`examples/basic`](../../examples/basic) | typesocket in four files — contract, server, client, run. |
| [`examples/chat`](../../examples/chat) | Multi-room chat with presence, typing and a live frame inspector. |
| [`docs/releases/v2.0.0.md`](./docs/releases/v2.0.0.md) | The full 2.0 release note, with rationale and the complete migration table. |

```bash
pnpm --filter @typewire-examples/basic start   # runs and exits
pnpm --filter @typewire-examples/chat dev      # server + UI
```

---

## License

[MIT](./LICENSE) © Taha Nabavi
