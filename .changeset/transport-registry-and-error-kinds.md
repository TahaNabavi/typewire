---
"@tahanabavi/typefetch": major
---

Lay the foundation for pluggable transports, and normalise the failure taxonomy.

**Breaking:** an invalid request **input** now throws a `RichError` instead of a
raw `ZodError`. See "input validation" below for the migration.

**Transport registry.** `EndpointDef` is now built from an open
`TransportRegistry` interface rather than being a fixed HTTP-only object type.
Transport packages register themselves by declaration merging, which is what lets
gRPC and GraphQL ship as separate installable packages while the core stays
dependency-free. With only the built-in `http` transport installed, every type
resolves exactly as it did before, so existing contracts are untouched.

New exports: `TransportRegistry`, `TransportKind`, `EndpointBase`,
`HttpEndpointFields`, `EndpointFor`, `AnyEndpointDef`, `AnyEndpointDefZ`.
`EndpointDef` keeps its name and its HTTP-only meaning.

**`RichError.kind`.** Every failure the client produces now carries a
transport-independent classification (`not_found`, `unauthenticated`,
`deadline_exceeded`, `validation`, `network`, …), so a global handler is written
once and keeps working when an endpoint moves to a wire whose failure vocabulary
is not HTTP status codes. `status` and `code` are unchanged. A request that times
out is now distinguishable from one the caller cancelled — both abort, but they
report `deadline_exceeded` and `cancelled` respectively.

**`errors` accepts string keys.** `ErrorResponsesMap` widens from
`Record<number, …>` to `Record<number | string, …>`, because a transport's error
key space is its own — an HTTP status, a gRPC code, or a GraphQL
`extensions.code`. `isContractError` narrows off either, matching on the new
`RichError.errorKey` (the key in the contract's `errors` map) rather than
assuming the HTTP status is that key.

**Input validation now fails like output validation.** `request.parse` ran
before the client's error handling, so a bad *input* escaped as a raw `ZodError`
— never a `RichError`, no `kind`, never reaching `onError`, never appearing in an
inspector. A bad *output*, one line further down the same request, did all four.
A global error handler therefore missed an entire class of failure with no
signal that it had.

Both ends of the contract now behave identically. Zod's per-field detail is
carried across to `RichError.errors` (already `Record<string, string[]>`, the
same shape), so nothing is lost.

```diff
  try {
    await api.user.createUser(input);
  } catch (e) {
-   if (e instanceof ZodError) showFieldErrors(e.flatten().fieldErrors);
+   if (e instanceof RichError && e.kind === "validation") showFieldErrors(e.errors);
  }
```

Note that `onError` now fires for invalid input, where it previously did not.

No new dependencies.
