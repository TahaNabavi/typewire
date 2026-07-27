# @tahanabavi/typefetch-query-core

## 1.0.0

### Major Changes

- 9602c04: **1.0.0 — the query layer and cross-transport devtools go stable.**

  Four packages reach their first release together, because they only make sense
  together: one Zod contract now flows client → cache → inspector.

  **`typefetch-query-core`** — a framework-agnostic query engine: cache, dedup,
  staleness, mutations, retry, and **declared invalidation** (`relations`, no
  hand-written cache keys). It imports no framework and no transport — it needs
  only a callable endpoint carrying a stable id, so the same client drives
  typefetch HTTP and typesocket acked events. Everything is exposed behind an
  `Observable` (`subscribe` / `getSnapshot`) contract.

  **`typefetch-react`** — a thin React adapter: `useQuery`, `useMutation`, and
  `TypeFetchProvider`, each the engine's contract handed to `useSyncExternalStore`.

  **`type-devtools-core`** — the transport-agnostic inspector core: `InspectorBridge`
  (one timeline for HTTP **and** WS), a runtime override registry, and a new
  `QueryInspector` / `connectQueryClient` that mirrors a query cache and drives its
  refetch / invalidate / remove. The client is typed structurally, so the package
  keeps **zero dependencies**.

  **`type-devtools`** — the React panel: timeline with source/status filters,
  search, and pause; an **override editor** (mock / force-error / latency / drop);
  a **Cache tab** (query state, one-click refetch/invalidate/remove, recent
  mutations); a collapsible, syntax-colored **JSON tree** with per-node copy;
  copy-as-JSON / copy-as-cURL / export; a summary bar and WS connection indicator;
  and a **Settings tab** (persisted to `sessionStorage`) for theme (dark / light /
  auto), density, animations (respecting `prefers-reduced-motion`), and Web
  Audio–synthesized **sound cues** (off by default). Still dependency-free and
  inline-styled — the only injected CSS is one `@keyframes` block.
