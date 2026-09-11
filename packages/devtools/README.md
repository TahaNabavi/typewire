# @tahanabavi/type-devtools

![type-devtools — the React inspector panel: timeline, query cache, override editor, colored JSON tree](./docs/assets/type-devtools-banner.png)

A React inspector panel for the TypeWire ecosystem. One timeline for **REST,
GraphQL, gRPC and WebSocket** traffic, a live **query cache** view, a runtime
**override editor**, and a **settings** tab — dropped into your app as a single
component.

It renders any bridge from
[`@tahanabavi/type-devtools-core`](../devtools-core), so adding a transport is
one more `connect*` call, not a change in here.

```bash
pnpm add @tahanabavi/type-devtools @tahanabavi/type-devtools-core
```

## Setup

Wire your clients into a bridge, then render the panel:

```tsx
import {
  InspectorBridge,
  connectTypeFetch,
  connectTypeSocket,
  connectQueryClient,
  TypeDevtools,
} from '@tahanabavi/type-devtools'

const bridge = new InspectorBridge()
connectTypeFetch(apiClient, bridge) // HTTP
connectTypeSocket(socketClient, bridge) // WebSocket

// Optional: attach a query client to unlock the Cache tab.
const queries = connectQueryClient(queryClient)

function Root() {
  return (
    <>
      <App />
      <TypeDevtools bridge={bridge} queries={queries} />
    </>
  )
}
```

`queries` is optional — omit it and the Cache tab simply doesn't appear.

### Props

| Prop          | Type              | Default               |                                             |
| ------------- | ----------------- | --------------------- | ------------------------------------------- |
| `bridge`      | `InspectorBridge` | —                     | The transport timeline (required).          |
| `queries`     | `QueryInspector`  | —                     | Attach a query cache to show the Cache tab. |
| `defaultOpen` | `boolean`         | `false`               | Render expanded on first mount.             |
| `title`       | `string`          | `"TypeWire devtools"` | Header label.                               |

## What's in it

**Timeline.** One row per call, tagged by the **wire it travelled on**, newest
first. Filter by wire and status (`pending` / `success` / `error`), search across
labels, payloads, error kinds _and_ transports, and **pause** to freeze the
stream while you read. Select a row for the full input / output / error.

Since typefetch grew a transport registry, one client speaks REST, GraphQL and
gRPC — so the badge shows `http` / `graphql` / `grpc` / `ws`, and the wire filter
is built from the traffic that actually arrived. An app that speaks one wire
never sees a filter it can't use; an app that registers a transport of its own
gets a badge for it without a change in here.

**Normalized failures.** A failed row shows typefetch's `ErrorKind` beside its
status, so `404`, gRPC code `5` and GraphQL `extensions.code: "NOT_FOUND"` all
read as `not_found`. That is the field to scan on a mixed timeline: gRPC and
GraphQL carry no HTTP status, so without it a row could only say "error".

**Live transfers.** A call reporting upload or download progress draws a bar
under its row and an `↑ 62% · 1.2 MB / 2.0 MB` readout in the detail. Chunked
responses report no total, so those get a moving indeterminate bar rather than
one stuck at zero. Progress is stored latest-only, outside the event log — a
single large upload would otherwise evict a whole session's history.

**Override editor.** The override engine was always wired through the bridge and
both connectors — now it's buttons. From a selected row: **force an error**, add
**+1s / +2s latency**, supply a **mock** response (paste JSON), or **drop** a WS
frame. Active overrides show in a strip with per-item and bulk removal. Every
future call of that endpoint/event is steered — no code, no contract change.

**Cache.** Every cached query with its state (`fresh` / `stale` / `fetching` /
`error`), plus one-click **refetch**, **invalidate**, and **remove**, and a
recent-mutations list. Driven entirely by the query client's event bus.

**JSON tree.** Collapsible and syntax-colored, with per-node copy and
search-match highlighting. `Error`, `Map`, `Set`, `Date` and `BigInt` are
normalized; cycles render as `[Circular]` instead of throwing.

**Copy / export.** Copy any entry as JSON, a **REST** entry as **cURL**, or
export the whole timeline to a `.json` file. cURL is offered for REST only: on
GraphQL the operation is `query` and the target is a root field, so the command
would not run — rebuilding the real POST means rebuilding the document and the
envelope, which belongs to the adapter, not the panel.

**Settings** (persisted to `sessionStorage` for the session):

- **Theme** — `dark` / `light` / `auto` (follows the host's `prefers-color-scheme`).
- **Density** — `comfortable` / `compact`.
- **Animations** — row-enter and a pending pulse, always gated by `prefers-reduced-motion`.
- **Sound** — a soft blip on new traffic, a buzz on error. **Off by default**,
  synthesized with the Web Audio API so no audio asset ships.

## No stylesheet

The panel is dropped into someone else's app, so it ships **no CSS**: every color
is an inline, theme-aware value, and the only injected style is one `@keyframes`
block for the row animations (which inline styles can't express). There are no
runtime dependencies beyond React and `type-devtools-core`.

## Build your own

The panel is one consumer of the primitives, not the only way in. The hooks, the
tree and the row colors are exported for a custom inspector:

```tsx
import {
  useInspectorEntries, // rows, with live progress already joined on
  useInspectorProgress, // the progress store on its own
  useQueryInspector,
  JsonTree,
  transportOf, // the wire a row used, falling back to its source
  transportColor,
  statusColor,
} from '@tahanabavi/type-devtools'
```

## License

[MIT](../../LICENSE) © Taha Nabavi
