# @tahanabavi/typefetch-query-core

## 1.1.0

### Minor Changes

- 7e52d2b: Response types and transfer progress.

  - **typefetch** — new optional `responseType` on an endpoint: `json` (default),
    `text`, `blob`, `arrayBuffer`, `formData`, `file`, `stream`, `response`. Paired
    schema helpers `zBlob()` / `zFile()` / `zArrayBuffer()` / `zFormData()` /
    `zStream()` / `zResponse()` defer their global lookup into the validator, so a
    contract importing them is constructible in Node and SSR (unlike
    `z.instanceof(Blob)`). `responseType: "file"` resolves to
    `{ blob, filename, contentType, size }` with `filename` parsed from
    `Content-Disposition` (RFC 5987 form preferred, directory components stripped).
    `setResponseWrapper` / `useResponseTransform` apply to `json` and `text` only.

  - **typefetch** — new per-request `onUploadProgress` / `onDownloadProgress` in
    `RequestOptions`, reporting `TransferProgress`. `fetch` has no upload-progress
    API, so passing `onUploadProgress` swaps the middleware chain's terminal
    transport for `XMLHttpRequest`; middleware is unaffected (same context, still
    handed a `Response`) and requests without the handler keep the unchanged
    `fetch` path. Where `XMLHttpRequest` is absent the request still runs over
    `fetch` and the client warns once. Download progress counts bytes off
    `res.body` and is skipped for `stream`/`response`. `RequestEvent` gains a
    `progress` variant, emitted only for requests that asked for progress.

  - **type-devtools-core** — `TypeFetchRequestEvent` gains the `progress` variant,
    and `InspectorBridge` gains a separate latest-only progress channel
    (`recordProgress` / `getProgressSnapshot`) rather than routing ticks through
    the event ring buffer, where one upload would evict the whole log.
    `selectEntries(events, progress?)` joins it onto the matching row.

  - **typefetch-query-core** — `EndpointCallOptions` carries the progress
    callbacks; `MutationObserverOptions` gains `trackProgress` (`true` | `"upload"`
    | `"download"`) plus pass-through handlers, and `MutationState` gains
    `progress`. A mutation that wants nothing calls the endpoint with no options at
    all, exactly as before.

  - **typefetch-react** — `useMutation(endpoint, { trackProgress })` exposes
    `result.progress`, updating through the existing `useSyncExternalStore`
    subscription. No new hook.

  **Behavior change (fix):** `onError` now fires exactly once per failed request.
  It previously fired once per layer that saw the error on its way out — twice for
  a plain HTTP failure, and once per attempt plus one when retries were configured
  (`maxRetries: 2` called it four times). Reporting is now idempotent per error
  instance and sits outside the retry loop. Which errors reach the handler, and the
  error instance it receives, are unchanged.

  **Behavior change (fix):** a failed response is now handled before its body is
  decoded, and the body is read as text then parsed. Previously `res.json()` ran
  first, so a non-JSON failure — an HTML 502, an empty 401, a plain-text 503 —
  threw a raw `SyntaxError` and the HTTP status never reached the caller. Those now
  produce a `RichError` carrying `status`, with the raw text in `detail`. An
  envelope reporting `{ success: false }` alongside a 4xx still surfaces its
  message, now via `safeParse` so a non-envelope failure body falls through to the
  status error instead of throwing a validation error over it.

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
