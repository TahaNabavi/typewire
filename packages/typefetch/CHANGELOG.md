# @tahanabavi/typefetch

## 1.10.0

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

## 1.9.0

### Minor Changes

- 03ecc58: Client-side permission enforcement, mirroring the server's `createPermissionGuard`.

  - **typefetch** — `createPermissionMiddleware({ getPermissions, authorize, onDeny? })`
    returns a `Middleware` that reads `ctx.endpoint.permission`, evaluates it with the
    injected `authorize` (pass `P.authorize`), and throws `PermissionDeniedError`
    (`{ status: 403, missing, missingAny? }`) before the request is sent. Endpoints
    with no `permission` key pass through. `authorize` is injected, so typefetch keeps
    no dependency on `@tahanabavi/type-permission`.

  - **typesocket** — `createPermissionMiddleware({ getPermissions, authorize, onDeny? })`
    builds a pre-emit guard registered via the new `authorizeOutbound` client option
    (or `client.setOutboundAuthorizer()`). A denied emit throws `PermissionDeniedError`
    — an ack'd emit rejects, a fire-and-forget one throws synchronously. It uses
    `authorizeOutbound` rather than `client.use()` because a `SocketMiddleware` can only
    drop a frame silently; `getPermissions` is synchronous so a `void` emit can fail at
    the call site. New: `OutboundAuthorizer` type, `authorizeOutbound` option,
    `client.setOutboundAuthorizer()`.

  Both are additive and dependency-free; client checks are UX only — the server
  (`@tahanabavi/typewire-nestjs`) remains the enforcement point.

## 1.8.0

### Minor Changes

- ecf70c7: Contract-linked permissions (opt-in, additive). Endpoints and `client->server`
  socket events may now carry an optional `permission` requirement
  (`{ require?, any?, reason? }`) written once on the contract:

  - **typefetch** — `EndpointDef.permission`
  - **typesocket** — `ClientToServerDef.permission` (client authorizes what it sends)

  Both types are redeclared structurally, so the transports stay dependency-free.

  **typewire-nestjs** gains `createPermissionGuard({ getPermissions, authorize })`
  — a NestJS guard that reads the requirement off the contract metadata and
  rejects with a 403 naming the missing flags — plus a `@RequirePermission()`
  decorator for contract-less routes. Pass `@tahanabavi/type-permission`'s
  `P.authorize` straight through; a route with no requirement is never blocked.

## 1.7.1

### Patch Changes

- 84c00be: Update package manifest metadata — author contact (email/URL), homepage, and
  keywords — with no runtime or API changes. typesocket additionally corrects its
  license to MIT and now ships its README and LICENSE in the published tarball
  (previously `dist` only).
