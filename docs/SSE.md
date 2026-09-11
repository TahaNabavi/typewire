# `typefetch-sse` — typed streaming (design)

Every product built in the last two years streams something: tokens from a model,
progress from a job, rows from an export. TypeWire speaks request/response on
three wires and has no answer for the fourth. Server-Sent Events is the transport
under most of it — a plain HTTP response with a text body — so it belongs in this
family as another adapter rather than as a new concept.

**Status: design, not implementation.** Roadmap row 12 in [`ROADMAP.md`](./ROADMAP.md).

---

## 1. Why SSE, and why not `EventSource`

SSE over `fetch`, not the browser's `EventSource` object. `EventSource` cannot
send an `Authorization` header, cannot POST, and cannot carry a body — which
rules out every authenticated endpoint and every "stream the answer to _this_
prompt" call, i.e. the two things people actually want. Reading the response body
as a stream costs nothing extra and works identically in Node, Bun and Deno, all
three of which the CI matrix already covers.

WebSocket stays typesocket's job. The line: **server→client only, over one HTTP
request** is SSE; bidirectional and stateful is a socket. A transport that
quietly did both would be a socket with worse ergonomics.

## 2. Scope

In scope: SSE framing, per-event schemas, resume, backpressure, one contract.
Out of scope: bidirectional streams, gRPC server-streaming (that belongs in
`typefetch-grpc` behind the same core seam), and any server implementation —
`typewire-nestjs` gains `@SseEndpoint()` afterwards, as a separate row.

## 3. What the core is missing, honestly

The GraphQL adapter proved the transport seam by needing **zero** core changes.
SSE will not repeat that, and pretending otherwise would produce a worse design.
Two things in the client are shaped for a single terminal value:

1. [`client.ts:635`](../packages/typefetch/src/client.ts#L635) validates the
   decoded body with `endpoint.response.parse(decoded.value)`. A stream has no
   single body to validate; each **frame** validates against the schema for its
   event name.
2. A per-endpoint `timeout` aborts a slow request. A stream that is open for
   twenty minutes is not slow, it is working.

So the seam grows by the smallest amount that admits a stream:

```ts
// transport/adapter.ts
export type TransportCapabilities = {
  uploadProgress?: boolean
  downloadProgress?: boolean
  responseTypes?: readonly ResponseType[]
  /** This wire can return a stream instead of a value. */
  streaming?: boolean
}

export type TransportDecoded = {
  value: unknown
  enveloped: boolean
  /**
   * The value is a stream the adapter already validates frame by frame.
   * The client skips `endpoint.response.parse` and the response transform,
   * for the same reason a `Blob` skips them: unwrapping it would corrupt it.
   */
  stream?: true
}
```

That is the entire core change: one optional capability, one optional flag, and
the `if` that reads it. `enveloped: false` already exists and already means "do
not run the JSON envelope pipeline over this", so the precedent is set — the
`Blob` case took the same shape.

Everything else the adapter does itself, through `send()` — the seam's documented
escape hatch for "a wire that cannot be expressed as a single `fetch` call".
Reconnect _is_ a second fetch, so this is exactly the case it was written for.

## 4. The contract

```ts
declare module '@tahanabavi/typefetch' {
  interface TransportRegistry {
    sse: {
      path: string
      method?: 'GET' | 'POST'
      /** A schema per `event:` name. The union of these is what a frame is. */
      events: Record<string, StandardSchemaLike>
      /** Resume with `Last-Event-ID` after a drop. Default true. */
      resume?: boolean
      /** Give up after this long with no frame *and* no comment. Default 60s. */
      idleTimeoutMs?: number
      retry?: {
        maxAttempts?: number
        backoffMs?: number
        maxBackoffMs?: number
      }
    }
  }
}
```

```ts
export const contracts = {
  chat: {
    stream: {
      transport: 'sse',
      method: 'POST',
      path: '/chat/:id/stream',
      request: z.object({
        path: z.object({ id: z.string() }),
        body: z.object({ prompt: z.string() }),
      }),
      events: {
        token: z.object({ text: z.string() }),
        usage: z.object({ input: z.number(), output: z.number() }),
        done: z.object({ reason: z.enum(['stop', 'length']) }),
      },
      response: z.void(), // there is no terminal body; the frames are the answer
      auth: true,
    },
  },
} as const
```

`validate()` on the adapter rejects at client construction — not on first call —
when `events` is empty, when a name is not a valid SSE event name, or when
`responseType` is set (there is no body to decode).

`describe()` returns `{ protocol: "SSE", operation: method ?? "GET", target: path }`,
so `typewire list`, devtools rows and permission audit payloads keep working
without knowing this transport exists.

## 5. Consuming it

The daily call site stays frozen (design law 2), so the endpoint is still called
the same way. The typed iterator comes from a helper that refines the static type
from the `events` map — no conditional type is added to the core, which must
never read a transport-specific field:

```ts
import { sseStream } from '@tahanabavi/typefetch-sse'

const stream = await sseStream(api.modules.chat.stream, {
  path: { id },
  body: { prompt },
})

for await (const frame of stream) {
  switch (frame.event) {
    case 'token':
      append(frame.data.text)
      break // data: { text: string }
    case 'usage':
      meter(frame.data)
      break
    case 'done':
      return frame.data.reason
  }
}

stream.close() // aborts the request
stream.lastEventId // where a resume would pick up
```

`for await` is the backpressure: the adapter pulls from the response reader only
as the consumer asks for frames, so a slow renderer slows the read rather than
growing an unbounded queue. A frame that fails its schema does not kill the
stream — it is emitted as `{ event: "…", error }` with `kind: "validation"`, and
the loop decides. One malformed token is not a reason to drop the other nine
hundred.

## 6. Resume, which is the part that earns a package

`EventSource` reconnects on its own and the generation state does not come back
with it, so a four-minute agent run that drops at minute three restarts from
zero. The adapter owns the reconnect instead:

1. Track `lastEventId` from every frame carrying `id:`.
2. On a transport-level drop (not an abort, not a `done`), wait
   `backoffMs × 2^attempt`, capped, honouring any `retry:` interval the server
   sent — which is what that SSE field is for.
3. Re-issue the same request with `Last-Event-ID: <id>`.
4. Emit `{ event: "…", resumed: true }` once, so a UI can say so.
5. Give up after `maxAttempts` and reject the iterator with `kind: "unavailable"`.

The server is what makes this work or not, and the docs must say so plainly: a
server that ignores `Last-Event-ID` replays from the start, and the package
cannot fix that. What it can do is not lie about it — `stream.resumed` counts
reconnects, and a server that never honoured the header shows up as a stream that
starts over.

`idleTimeoutMs` covers the other half: a connection that is open but silent is
indistinguishable from a working one until the timer fires. SSE comment lines
(`:heartbeat`) reset it, which is why they exist.

## 7. The six-connection ceiling

HTTP/1.1 allows six connections per origin. A dashboard with four streaming
widgets in three tabs is over budget before the user does anything. Two answers,
in order:

1. **HTTP/2 or /3** — the real fix, and not ours to ship.
2. **One stream in the leader tab**, fanned out to the others over
   [`SYNC.md`](./SYNC.md)'s channel. That primitive already has to exist for the
   socket case; SSE is the same shape, which is why these two rows sit next to
   each other on the roadmap.

## 8. Package shape

```txt
packages/sse/
  src/
    index.ts        sseTransport() · sseStream() · types
    transport.ts    the TransportAdapter, incl. send()
    frames.ts       the SSE line parser (data:/event:/id:/retry:/comment)
    stream.ts       the async iterator, backpressure, close()
    resume.ts       backoff, Last-Event-ID, attempt accounting
    errors.ts       SSE failures → ErrorKind
    types.ts        module augmentation of TransportRegistry
```

Peers: `@tahanabavi/typefetch` and `zod` (or any Standard Schema validator once
[`SCHEMA.md`](./SCHEMA.md) lands). Zero runtime dependencies. Budget row:

```json
{ "package": "sse", "entry": "dist/index.mjs", "maxGzip": 3800 }
```

Registration is explicit, exactly like the other adapters:

```ts
const api = new ApiClient({ baseUrl, transports: [sseTransport()] }, contracts)
```

## 9. Failure modes, named

| Mode                           | Behaviour                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| Connection drops mid-stream    | reconnect with `Last-Event-ID`, backoff, `resumed: true`                            |
| Server ignores `Last-Event-ID` | frames repeat; `stream.resumed` says why. Documented, not hidden                    |
| Server never sends anything    | `idleTimeoutMs` fires → `deadline_exceeded`                                         |
| One frame fails its schema     | that frame carries `kind: "validation"`; the stream continues                       |
| Unknown event name             | delivered as `{ event, data: unknown, unknown: true }`, never silently dropped      |
| `close()` mid-stream           | request aborted, iterator returns, no reconnect                                     |
| Non-2xx on open                | the normal `fail()` path — one `RichError`, one `ErrorKind`, like any other request |
| Wrong content type             | fails at open with `internal` and the received type in the message                  |

## 10. Test matrix

Against a hand-written `node:http` server, in the style of `examples/transports`
— headless, self-asserting, and therefore covered by `pnpm test`:

| Test                                                                | Asserts         |
| ------------------------------------------------------------------- | --------------- |
| `frames split across chunk boundaries parse as one event`           | §8 `frames.ts`  |
| `a comment line resets the idle timer`                              | §6              |
| `an event with no name arrives as "message"`                        | SSE default     |
| `data over multiple lines is joined with newlines`                  | SSE spec        |
| `a dropped connection resumes with the last event id`               | §6              |
| `a resumed stream reports resumed: true exactly once per reconnect` | §6              |
| `giving up after maxAttempts rejects with unavailable`              | §6              |
| `a malformed frame does not end the stream`                         | §5              |
| `an unknown event name is delivered, not dropped`                   | §9              |
| `close() aborts the request and does not reconnect`                 | §9              |
| `a slow consumer does not buffer the whole stream`                  | §5 backpressure |
| `endpoint timeout does not abort an open stream`                    | §3.2            |
| `the client does not run response.parse over a stream`              | §3.1            |

## 11. Milestones

| #   | Milestone            | Contains                                                                                                         |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| E1  | Core seam            | `streaming` capability + `stream` flag + the timeout exemption. Additive, no behaviour change                    |
| E2  | Parser + adapter     | framing, `build`/`decode`/`fail`/`describe`, one-shot streams                                                    |
| E3  | Resume               | `send()`, backoff, `Last-Event-ID`, idle timeout                                                                 |
| E4  | `sseStream()` typing | the per-event discriminated union from `events`                                                                  |
| E5  | Downstream           | devtools frame rows (reusing the existing progress ticks), query-core's answer to §12.2, nestjs `@SseEndpoint()` |

## 12. Open questions

1. **Does `response` stay required?** `z.void()` reads like a placeholder. The
   alternative is making the base contract's `response` optional when the
   transport declares `streaming` — cleaner to write, but it loosens a type every
   other transport relies on.
2. **What does query-core do with a stream?** Caching a stream is meaningless;
   caching its _accumulated_ value is exactly what a chat UI wants. Options: out
   of scope (the app accumulates), or a `reduce` on the endpoint that folds
   frames into the cached value. Current lean: out of scope for E1–E4, revisit
   with a real example.
3. **Devtools representation.** A stream is one row with N frames, or N rows? The
   progress ticks `devtools-core` already stores were built for transfer bars and
   fit the first shape almost exactly.
4. **NDJSON.** The same parser with a different framing, and it is what several
   APIs actually ship. A second `kind`, or a `framing: "sse" | "ndjson"` option
   on this one?
