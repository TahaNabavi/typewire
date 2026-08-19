---
"@tahanabavi/typefetch-graphql": minor
---

New package: GraphQL as a transport for TypeFetch contracts.

A GraphQL route lives in the same contract file, behind the same client, as your
REST routes — and keeps every transport-independent feature unchanged:
middleware, `onError`, retries, timeouts, `AbortSignal`, mock mode,
instrumentation, devtools, and query-engine cache keys.

**The selection set is generated from the Zod response schema.** No codegen step,
no document to keep in sync, and no way for the shape that requests the data to
drift from the shape that validates it. `document` remains available for
fragments, aliases and unions.

```ts
getUser: {
  transport: "graphql",
  operation: "query",
  root: "user",
  request: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string() }),
  variableTypes: { id: "ID!" },
}
// → query UserGetUser($id: ID!) { user(id: $id) { id name } }
```

Also included:

- **Errors mapped onto the shared `ErrorKind`**, so one
  `kind === "unauthenticated"` handler covers a GraphQL `UNAUTHENTICATED` and an
  HTTP 401 alike. `errors` is keyed by `extensions.code`, and `isContractError`
  narrows off it.
- **Both response media types** — legacy `application/json` with errors inside a
  200, and `application/graphql-response+json` with a real status.
  `extensions.http.status` is honoured.
- **Partial data is a decision, not an accident** — `errorPolicy: "none"`
  (default) throws; `"all"` resolves the data and hands the errors to
  `onPartialErrors` rather than dropping them.
- **Refusals are loud and early.** A schema whose selection set cannot be
  inferred (unions, records, cycles) fails at `client.init()` naming the endpoint
  and the path, not on a request in production.
- **GET mode** for queries, so they are CDN-cacheable. Mutations always POST.

Requires `@tahanabavi/typefetch` >= 2.0.0 for the transport seam. Installing this
package is what makes `transport: "graphql"` type-check; registering it in
`transports` is what puts it in the bundle.
