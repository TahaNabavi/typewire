# examples

Runnable demos. All private, none published.

| Example | What it shows |
| --- | --- |
| [`basic`](./basic) | typesocket in four files — contract, server, client, run. No UI, prints an annotated frame log and exits. Start here. |
| [`chat`](./chat) | A real app: multi-room chat with presence, typing, history, and a live frame inspector. socket.io server + React UI on one contract. |
| [`query`](./query) | The query layer end to end: `useQuery` / `useMutation` over HTTP **and** WebSocket, declared invalidation, and the devtools panel showing both transports in one timeline. Ships a React app *and* a headless run that asserts, so `pnpm test` covers it. |

```bash
pnpm install
pnpm --filter @typewire-examples/basic start
pnpm --filter @typewire-examples/chat dev
pnpm --filter @typewire-examples/query dev     # React app + devtools panel
pnpm --filter @typewire-examples/query start   # headless, asserts and exits
```

Each example depends on its package through `workspace:*`, so it always runs
against the local source rather than a published version. The packages resolve
through their `dist/`, which is gitignored — so `start` and `dev` run
`build:deps` first (`pnpm --filter "<example>^..." build`, its workspace
dependencies only). A fresh clone needs nothing but `pnpm install`, and you can
never run an example against a stale build.

They carry a `typecheck` script and run under `pnpm -r typecheck` in CI — if a
package change breaks an example, the PR goes red instead of the example quietly
rotting. `typecheck` and query's `test` stay bare on purpose: CI builds
everything up front, and a nested build racing `pnpm -r test` could rewrite a
`dist/` another package is reading.
