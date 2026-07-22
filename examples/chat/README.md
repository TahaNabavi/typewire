# chat — a real app on one typesocket contract

Multi-room chat with presence, typing indicators, message history, and a live
frame inspector. A socket.io server and a React UI, both driven by the same
[`shared/contracts.ts`](./shared/contracts.ts).

```bash
pnpm install
pnpm --filter @typewire-examples/chat dev
```

- UI → <http://localhost:5273>
- socket.io server → <http://localhost:3102>

Open it in **two tabs** with different names and watch frames flow both ways in
the inspector panel.

## Layout

```txt
shared/contracts.ts        the single source of truth — imported by both sides
server/
  contract-bridge.ts       ~60 lines: contract -> socket.io handlers
  index.ts                 rooms, presence, history, typing
client/src/
  socket.ts                one SocketClient for the app
  hooks.ts                 useSocketEvent · useConnection · useFrameLog
  App.tsx                  join form, room, composer
  Inspector.tsx            live frame timeline, built only on instrument()
```

## What this demonstrates

### One contract, read from both ends

`server/index.ts` and `client/src/App.tsx` import the same object. Neither
declares a mirrored copy, because each event carries its own `direction`:

```ts
send: {
  direction: "client->server",
  request: z.object({ roomId: z.string(), text: z.string().min(1).max(500) }),
  ack: z.object({ id: z.string(), sentAt: z.number() }),
}
```

The client emits it; the server handles it. Change the schema in one place and
both sides fail to compile — which is the entire point.

### The server never repeats an event name

[`server/contract-bridge.ts`](./server/contract-bridge.ts) is the whole
contract→server layer. `handle()` binds an inbound event with its request
schema and validates whatever the handler returns against the `ack` schema;
`push()` validates an outbound payload before it leaves. A server literally
cannot send an acknowledgement its own contract rejects.

This is hand-rolled here to show the moving parts. The planned
`@tahanabavi/typewire-nestjs` WebSocket gateway generates the same thing.

### Acks vs. fire-and-forget, decided by the contract

`chat.send` declares an `ack`, so it returns a Promise and the UI can show a
send failure. `chat.setTyping` doesn't, so it returns `void` — right for a
keystroke-frequency signal nobody needs to confirm. You never pick a method
name; the contract already decided.

### The inspector is just `instrument()`

[`Inspector.tsx`](./client/src/Inspector.tsx) reads one hook —
`socket.instrument({ on })` — and renders every frame with its parsed payload.
Nothing in the chat code knows the panel exists. `frameId` pairs an outbound
emit with its ack, so you can see round-trip latency per message.

That is the seam `@tahanabavi/type-devtools-core` attaches to, which is how HTTP
and WebSocket traffic will end up in one timeline.

### React bindings are ~40 lines

Because every subscription returns its own unsubscribe,
[`hooks.ts`](./client/src/hooks.ts) is little more than `useEffect` plus a ref:

```ts
useSocketEvent(socket.modules.chat.message, (m) => setMessages((p) => [...p, m]));
//                                            ^? Message — inferred from the contract
```

## Things worth trying

**Reconnect.** Stop the server (`Ctrl+C` in the server pane) and restart it. The
client reconnects, the room re-joins, history reloads — and each message still
renders **once**. In v1 handlers were re-registered on every connect, so a
message would render twice after one reconnect, three times after two.

**Break the contract.** Change `text: z.string().min(1)` to `.min(5)` in
`shared/contracts.ts` and send a short message. It throws
`SocketValidationError` on the client, before anything touches the wire — and
TypeScript flags the server if the shape no longer matches.

**Simulate bad network.** Add an override in `client/src/socket.ts`:

```ts
socket.instrument({
  resolveOverride: (eventId) =>
    eventId === "chat.send" ? { latencyMs: 2000 } : undefined,
});
```

Sends now take two seconds; the inspector shows the delay in the ack row. Swap
`latencyMs` for `{ drop: true }` and watch the send fail with an ack timeout
instead of hanging forever.

**Watch a schema violation get caught.** In `server/index.ts`, make `chat.message`
push a payload missing `user`. The server refuses to send it (`push()` validates
outbound), and if you bypass that, the client drops it and reports through
`onValidationError` — it never reaches a handler as a half-shaped object.

## Troubleshooting

**`Port 3102 is already in use`** — an earlier run is still holding it. Either
free the port or move:

```bash
npx kill-port 3102            # free it
PORT=3103 pnpm dev:server     # or start elsewhere...
VITE_SOCKET_URL=http://localhost:3103 pnpm dev:client   # ...and point the UI at it
```

## Notes

This is a demo: history and presence live in memory, there is no auth, and one
socket belongs to one room. Adding auth would mean a `auth: () => ({ token })`
in the client config — it is re-invoked on every reconnect, so a refreshed token
is picked up without rebuilding the client.
