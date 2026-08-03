---
"@tahanabavi/typefetch": minor
"@tahanabavi/typefetch-query-core": minor
"@tahanabavi/typefetch-react": minor
"@tahanabavi/type-devtools-core": minor
---

Response types and transfer progress.

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
