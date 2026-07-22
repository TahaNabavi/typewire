# examples

Runnable demos. All private, none published.

| Example | What it shows |
| --- | --- |
| [`basic`](./basic) | typesocket in four files — contract, server, client, run. No UI, prints an annotated frame log and exits. Start here. |
| [`chat`](./chat) | A real app: multi-room chat with presence, typing, history, and a live frame inspector. socket.io server + React UI on one contract. |

```bash
pnpm install
pnpm --filter @typewire-examples/basic start
pnpm --filter @typewire-examples/chat dev
```

Each example depends on its package through `workspace:*`, so it always builds
against the local source rather than a published version. They carry a
`typecheck` script and run under `pnpm -r typecheck` in CI — if a package change
breaks an example, the PR goes red instead of the example quietly rotting.
