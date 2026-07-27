---
"@tahanabavi/type-devtools-core": minor
"@tahanabavi/type-devtools": minor
---

Build out the devtools into a full inspector.

**`type-devtools-core`** — a new `QueryInspector` store and `connectQueryClient` connector mirror a `QueryClient`'s cache into a panel-ready snapshot (queries, states, recent mutations) and drive its refetch/invalidate/remove actions. The client is typed structurally (`QueryClientLike`), so the package still imports no query engine and keeps zero dependencies.

**`type-devtools`** — the panel is now a real inspector:

- **Override editor** — the previously code-only override engine (mock, force-error, latency, drop) is now buttons in the detail pane, with a live list of active overrides.
- **Cache tab** — cached queries with fresh/stale/fetching/error state and one-click refetch / invalidate / remove, plus a recent-mutations list. Pass `queries={inspector}` to unlock it.
- **JSON tree** — collapsible, syntax-colored, per-node copy, and search-match highlighting, replacing the raw `<pre>`.
- **Search & status filters**, **pause/record**, **copy-as-JSON / copy-as-cURL**, **export**, a **summary bar** (calls / errors / avg latency), and a **WS connection indicator**.
- **Settings tab** (persisted to `sessionStorage`): theme (dark / light / **auto**), density, animations (respecting `prefers-reduced-motion`), and **sound cues** — off by default, synthesized with the Web Audio API so no asset ships.

Still dependency-free and inline-styled; the only injected CSS is one `@keyframes` block for the row animations. The existing `TypeDevtools` API is unchanged and backward-compatible — `queries` is optional.
