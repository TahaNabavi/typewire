# `typewire-offline` — persistence and a queue with an owner (design)

Two features that are usually sold as one and are not: **the cache survives a
reload**, and **a write survives being made offline**. The first is a nice-to-have
that makes a refresh stop flashing empty. The second is a correctness feature
with sharp edges, and it is where offline-first apps quietly lose data.

**Status: design, not implementation.** Roadmap row 13 in [`ROADMAP.md`](./ROADMAP.md).
Depends on the leader primitive in [`SYNC.md`](./SYNC.md).

---

## 1. The guarantee, stated before the API

Everything below follows from one sentence, so it goes first:

> **At-least-once delivery, ordered within a queue, with an idempotency key per
> entry. Never at-most-once, never silently dropped, never merged.**

- **At-least-once**, because the alternative is losing a write that the user was
  told succeeded. The cost is that a mutation can reach the server twice — after
  a crash between "sent" and "acknowledged" there is no way to know which
  happened. Every entry therefore carries a stable `Idempotency-Key`, and the
  README says in its first paragraph that a server which ignores it will process
  duplicates. That is a true statement about the world, not a limitation to hide.
- **Ordered within a queue**, not globally. Two independent writes should not
  block each other; two writes to the same cart must not reorder.
- **Never silently dropped.** An entry that exhausts its retries becomes `dead`
  and is surfaced. A queue that empties itself by giving up is worse than a queue
  that stalls loudly.
- **Never merged.** Conflict resolution needs to understand what the data
  *means*, which a contract library does not. The server arbitrates; the app gets
  a hook.

## 2. Non-goals

No CRDTs, no operational transform, no local query engine, no schema migration
framework, no background sync worker. If the requirement is "two people edit the
same document offline", the answer is a sync engine, and it is not this.

## 3. Package shape

```txt
packages/offline/
  src/
    index.ts          persistQueryClient · createOutbox · types
    persist/
      dehydrate.ts    cache → records
      hydrate.ts      records → cache
      schedule.ts     debounce/throttle of writes
    outbox/
      queue.ts        enqueue, order, drain
      entry.ts        the entry shape + state machine
      retry.ts        backoff, attempt accounting, dead-lettering
    storage/
      types.ts        StorageAdapter
      indexeddb.ts    the default
      memory.ts       tests + SSR no-op
      local.ts        localStorage, for small caches only
```

```json
{ "package": "offline", "entry": "dist/index.mjs", "maxGzip": 5200 }
```

Zero runtime dependencies. Peers: `@tahanabavi/typewire-query-core`, and
`@tahanabavi/typewire-sync` **optional** — without it the outbox still works, but
only under the single-tab caveat in §6.

```ts
export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  /** Bounded transaction — the outbox needs read-modify-write to stay ordered. */
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<T>;
}
```

IndexedDB is the default because `localStorage` is synchronous, string-only and
~5 MB; it stays available for small caches and for browsers where IndexedDB is
unavailable in a private window.

## 4. Persistence

```ts
import { persistQueryClient } from "@tahanabavi/typewire-offline";

const persisted = persistQueryClient(client, {
  sources: api.modules,          // to map a stored id back to an endpoint (§8)
  version: pkg.version,          // a mismatch discards, it never migrates
  maxAge: 24 * 60 * 60 * 1000,
  include: ["catalog.*", "user.getProfile"],
  throttleMs: 1_000,
});

await persisted.ready;           // hydration finished; safe to render from cache
persisted.clear();
```

**What is written** per query: `key`, `endpointId`, the input, `data`,
`dataUpdatedAt`, and the writer's `version`. Not the error, not the fetch status,
not the observer count — none of them mean anything in a future process.

**When**: on the cache bus (`added` / `updated` with an advanced `dataUpdatedAt`),
debounced by `throttleMs` and coalesced per key, so a fast-updating query writes
once per window rather than per keystroke.

**Hydration**, on boot, in this order: read records → drop anything whose
`version` differs or whose `dataUpdatedAt` is older than `maxAge` → write each
into the cache **with the stored `updatedAt`** → resolve `ready`. Restoring with
`Date.now()` instead would mark day-old data as fresh, which is the failure mode
that makes people distrust persistence and turn it off.

Everything hydrated is *stale by default*: it renders immediately and refetches
when something observes it. That is the whole point — content on screen in the
first frame, correctness a moment later.

**Opt-in, not opt-out.** `include` is required. A blanket "persist everything"
default writes session data, permission bitfields and other people's records to
disk on a shared machine, which is not a decision a library gets to make quietly.

## 5. The outbox

```ts
const outbox = createOutbox(client, {
  sources: api.modules,
  storage,
  tabs,                                  // from typewire-sync; see §6
  queues: { "cart.*": "cart" },          // ids matched to a serial queue
  maxAttempts: 8,
  onDead: (entry) => notifyUser(entry),
  onConflict: (entry, error) => (error.kind === "already_exists" ? "drop" : "retry"),
});
```

An entry:

```ts
type OutboxEntry = {
  id: string;                    // also the Idempotency-Key
  queue: string;                 // "default" unless matched
  endpointId: string;
  input: unknown;
  optimistic?: OptimisticPatch[]; // §7
  state: "pending" | "sending" | "dead";
  attempts: number;
  createdAt: number;
  lastError?: { kind: ErrorKind; message: string };
};
```

**Enqueue** happens through the `gate` seam ([`SYNC.md`](./SYNC.md) §9) — the same
hook single-flight uses, which is why it is one seam and not three. When offline
(or when the run rejects with `kind: "network"`), the gate persists the entry and
resolves the caller optimistically instead of rejecting.

**Drain**, in order, per queue: oldest first, one in flight at a time, next only
after the previous settles. A failure with a retryable `ErrorKind`
(`unavailable`, `deadline_exceeded`, `network`, `resource_exhausted`) backs off
and stays at the head. A failure with a terminal kind (`invalid_argument`,
`permission_denied`, `not_found`, `already_exists`) does **not** block the queue
forever — it goes to `onConflict`, whose return value decides: `"retry"`,
`"drop"`, or `"replace"` with new input.

**Wake-up** is `online` events plus a probe, not `navigator.onLine` alone —
`onLine` reports whether there is a network, not whether the API answers, and a
captive portal satisfies it happily.

## 6. Exactly one tab may drain

A queue drained by every tab sends every write once per tab. This is the same
class of bug as the duplicate checkout, so it has the same answer: the leader.

```ts
tabs.leader.whenLeader(() => outbox.drain());
```

Without `typewire-sync` installed, the outbox drains in whichever tab created it
and the README says so. With it but on an unreliable lock adapter
(`tabs.reliable === false`), the outbox **refuses to drain rather than
double-sending** — the same fail-closed rule `exclusive` follows. Duplicate reads
are a cost; duplicate writes are the thing this package exists to prevent.

## 7. Optimistic state that survives a reload

This is the part that is easy to get wrong, because in-memory optimistic updates
are the norm and they evaporate on refresh — leaving a queued write with no trace
on screen. The user sees their edit disappear, and the write lands later anyway.

So an entry stores its own patch:

```ts
type OptimisticPatch = { key: string; endpointId: string; input: unknown; data: unknown };
```

The boot sequence is therefore three steps, in this order:

1. Hydrate the cache from the persisted records (§4).
2. Re-apply every pending entry's `optimistic` patch on top.
3. Start the drain (leader only).

On permanent failure, the patch is rolled back — the affected keys are
invalidated, so the next read comes from the server — and `onDead` fires. Rolling
back by writing a remembered "previous value" is deliberately *not* done: that
value may be many refetches stale by then.

`query-core` has no `onMutate` hook today; optimistic writes are `setQueryData`
calls in app code. So the patch is declared, not inferred:

```ts
await outbox.enqueue(api.modules.cart.addItem, input, {
  optimistic: (draft) => draft.patch(api.modules.cart.getCart, { path: { id } }, add(item)),
});
```

## 8. What this needs from the rest of the family

| Package | Change | Shared with |
| --- | --- | --- |
| `query-core` | the `gate` seam on `QueryClientOptions` | [`SYNC.md`](./SYNC.md) §9 |
| `query-core` | `setQueryData(…, { updatedAt })` | `SYNC.md` |
| `query-core` | `sources` — a resolver from `endpointId` back to the endpoint object, defaulting to a map built from a client's `modules` | `SYNC.md` §8.2, which needs the same lookup to apply a mirrored write |
| `query-core` | `reason: "gc" \| "explicit"` on `removed` | `SYNC.md` |
| `typewire-sync` | nothing — it is consumed as-is | — |

Four small additive changes in one package, serving three consumers. That is the
argument for landing them as their own release ahead of both packages.

> **Landed.** All four shipped in query-core 1.2.0 — `gate` and `sources` on
> `QueryClientOptions`, `setQueryData(…, { updatedAt })`, and `reason` on
> `removed` ([release notes](../packages/query-core/docs/releases/v1.2.0.md)).

## 9. Failure modes, named

| Mode | Behaviour |
| --- | --- |
| Crash between send and ack | replayed on boot; the idempotency key is the server's cue |
| Server ignores the idempotency key | duplicates. Documented in paragraph one, not buried |
| Entry exhausts `maxAttempts` | `dead` + `onDead`, patch rolled back. Never dropped silently |
| Terminal error mid-queue | `onConflict` decides; the queue does not wedge |
| Storage quota exceeded | oldest cache records evicted first, **outbox entries never** |
| IndexedDB unavailable | `localStorage` if it fits, else memory + a warning; persistence degrades, writes still queue |
| Two tabs, no `typewire-sync` | single-tab drain, documented caveat |
| Unreliable lock adapter | drain refuses (§6) |
| Version mismatch on boot | cache discarded, **outbox kept** — a queued write is not invalidated by a deploy |
| Clock moves backwards | `maxAge` uses stored `dataUpdatedAt` deltas; a negative age is treated as 0, not as fresh-forever |

The quota and version rows share one rule worth stating on its own: **cache is
disposable, the outbox is not.** Anything that has to give, gives on the cache
side.

## 10. Test matrix

| Test | Asserts |
| --- | --- |
| `hydrated data keeps its original updatedAt` | §4 |
| `a version mismatch discards the cache and keeps the outbox` | §9 |
| `an excluded id is never written to storage` | §4 |
| `a queued mutation survives a simulated reload` | §5 |
| `a queue drains in order and stops at the first retryable failure` | §5 |
| `a terminal failure consults onConflict instead of wedging the queue` | §5 |
| `an entry that exhausts maxAttempts is dead, not deleted` | §5 |
| `an optimistic patch is re-applied after hydration` | §7 |
| `a dead entry rolls its patch back by invalidating, not by restoring` | §7 |
| `two outboxes on one storage do not both drain` | §6 |
| `the drain refuses when the lock adapter is unreliable` | §6 |
| `quota pressure evicts cache records before outbox entries` | §9 |
| `every API resolves with no IndexedDB and no localStorage` | SSR / Node |

## 11. Milestones

| # | Milestone | Contains |
| --- | --- | --- |
| O1 | query-core seams | `gate`, `updatedAt`, `sources`, `reason` — shared with `typewire-sync`, released once. **Done** (query-core 1.2.0) |
| O2 | `StorageAdapter` + IndexedDB + memory | testable in Node, no browser |
| O3 | `persistQueryClient` | dehydrate, hydrate, throttle, version/`maxAge` guards |
| O4 | Outbox | entry state machine, ordering, backoff, dead-lettering, `onConflict` |
| O5 | Optimistic patches + leader drain | §6 and §7, the parts that need `typewire-sync` |

O3 is shippable alone and is what most users will actually install.

## 12. Open questions

1. **Does `enqueue` belong on the outbox or on the mutation observer?** A
   `queued: true` option on `watchMutation` would read better at the call site,
   but it puts an offline concern into query-core's API — which design law 2
   exists to prevent.
2. **Idempotency key transport.** An `Idempotency-Key` header is the HTTP
   convention; gRPC and GraphQL have no equivalent. Per-transport, via the
   adapter's `build()`, or a contract-declared field?
3. **Does the cache persist per user?** The storage key namespace needs the
   session identity, and this package does not know it. Probably a required
   `namespace` option — which also solves the shared-machine problem in §4.
4. **Background Sync API.** It would let a drain happen with no tab open at all,
   and it exists only in Chromium. Worth a seam, or out of scope for good?
