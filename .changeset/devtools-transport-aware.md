---
"@tahanabavi/type-devtools-core": minor
"@tahanabavi/type-devtools": minor
---

The inspector catches up with the transport registry: a timeline that shows the
wire, the normalized failure, and the transfer.

One typefetch client now speaks REST, GraphQL and gRPC. The inspector didn't know
that — every row said `http`, whichever wire it went out on.

- **`transport` on the event and the entry.** `connectTypeFetch` forwards the
  adapter typefetch actually used, and `selectEntries` hoists it from the event
  that opened the call onto the row. A client older than the transport registry
  reports none and gets `http`, because every call it could make was HTTP —
  blank would read as "unknown wire" for a client that only ever had one.
- **`source` and `transport` are now different things**, and the distinction is
  load-bearing. `source` is which *client* produced the event (`http` =
  typefetch, `ws` = typesocket) and stays the key space for overrides and
  correlation ids; `transport` is which *wire* carried it. An override
  registered under `"graphql"` would never match, because the connector that
  resolves it is typefetch's. Show `transport`; key on `source`.
- **`errorKind` on the entry.** typefetch's `ErrorKind` is lifted out of the
  error so a panel never reaches into a transport-specific body. It is the only
  thing an inspector can rely on to say what went wrong: `status` is meaningless
  on gRPC and GraphQL, so without it those rows could only say "error".

In the panel:

- **The row badge shows the wire**, colored per transport — `http`, `graphql`,
  `grpc`, `ws`, and a neutral badge for a third-party adapter rather than none.
- **The wire filter is derived from the traffic.** A REST-only app never sees a
  `graphql` chip it can't select, and the group hides itself entirely when
  everything went over one wire — a filter with one option filters nothing. It
  stays visible while a filter is active, so clearing the timeline can't strand
  the panel with no chip to turn the filter off.
- **Failed rows show their kind** beside the status, and in the detail beside
  the HTTP status when there is one.
- **Live transfer progress finally renders.** `devtools-core` has recorded it
  since the progress release; the panel called `selectEntries` without it, so a
  200 MB upload showed a static "pending" row. There is now a bar under the row
  and an `↑ 62% · 1.2 MB / 2.0 MB` readout in the detail, plus a moving
  indeterminate bar for the common chunked case that reports no total.
- **Search covers the error kind and the transport**, so `not_found` or `grpc`
  narrows the list the way an endpoint name does.
- **cURL is offered for REST only.** On GraphQL the start event's operation is
  `query` against a root field, so the button was producing `curl -X query` —
  not a command anyone can run. Rebuilding the real POST means rebuilding the
  document and the envelope, which belongs to the adapter, not the panel.

New exports: `useInspectorProgress`, `transportOf`, `transportColor`,
`statusColor`, and the `InspectorProgress` / `TypeFetchErrorLike` types.

Every addition is optional and nothing was renamed, so an existing panel and any
custom inspector built on these hooks keep working untouched.
