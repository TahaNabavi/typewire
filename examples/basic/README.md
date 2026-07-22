# basic — typesocket in four files

The smallest thing that shows the point: one contract, imported by a socket.io
server and a typesocket client, with every frame validated in both directions.

```bash
pnpm install
pnpm --filter @typewire-examples/basic start
```

It boots a server, runs a client against it, prints an annotated frame log, and
exits. No UI, no ports left open.

## What's here

| File | Role |
| --- | --- |
| [`src/contracts.ts`](./src/contracts.ts) | The single source of truth. Three events, each tagged with its direction. |
| [`src/server.ts`](./src/server.ts) | A plain socket.io server that reads its event names and schemas **off the contract**. |
| [`src/client.ts`](./src/client.ts) | The typesocket client: listen, emit, ack, wait, instrument. |
| [`src/main.ts`](./src/main.ts) | Boots one, runs the other, tears both down. |

## The five things worth reading

**Direction lives in the contract.** `server.ts` and `client.ts` import the same
object and read it from opposite ends. Neither declares a mirrored copy, so
there is nothing to drift.

**The ack decides the return type.** `echo.say` declares an `ack`, so calling it
returns `Promise<{ echoed, at }>`. `echo.ping` doesn't, so it returns `void`.
You don't have to remember which method to call — the contract already knows.

**Acks are validated.** The promise resolves only after the server's answer
passes the `ack` schema. A server that returns the wrong shape rejects instead
of handing unchecked data to typed code.

**Bad emits throw.** The deliberate `@ts-expect-error` in `client.ts` shows both
gates: TypeScript rejects it at compile time, and if you cast past that, Zod
throws `SocketValidationError` before anything touches the wire.

**Instrumentation is the devtools seam.** The hook in `client.ts` prints every
frame with its `frameId` — the same id pairs an outbound emit with its ack. This
is the API `@tahanabavi/type-devtools-core` will attach to.

## Expected output

```txt
[server] listening on http://localhost:3101
[server] client connected: AbC123...
[client] connected as AbC123...

  ↗ f1 echo.say { text: 'hello typewire' }
[server] echo.say -> "hello typewire"
  ↙ f1 ack in 3ms { echoed: 'HELLO TYPEWIRE', at: 1770000000000 }
[client] server echoed: "HELLO TYPEWIRE"

  ↗ f2 echo.ping { seq: 1 }
[server] echo.ping #1
[client] blocked a bad emit: Invalid input: expected number, received string

  ↘ f4 echo.tick { seq: 0, at: 1770000000000 }
[client] tick #0
  ...
[client] waited for tick #3

[client] done
```

## Next

[`examples/chat`](../chat) is the same idea as a real app — a React UI, a live
inspector panel, and rooms.
