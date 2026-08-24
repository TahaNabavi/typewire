# `typewire-sync` — the tab axis (design)

Every package in this repo assumes one runtime holds one client. Users do not.
They open the dashboard in three tabs, edit the invoice in one, and the other two
keep showing the old total until their own `staleTime` runs out — or, worse, both
press **Send**, because neither knows the other is already sending.

**Status: design, not implementation.** Nothing here ships yet. The API below is
what an implementer should build; the open questions at the bottom are the parts
still undecided. Roadmap row 10 in [`ROADMAP.md`](./ROADMAP.md).

---

## 1. Three problems, usually conflated

| # | Problem | What happens today | What it costs |
| --- | --- | --- | --- |
| 1 | **Duplicate reads** | Four tabs mount `user.getUser`; four requests leave the browser | 4× the load, 4× the rate limit, four different `dataUpdatedAt` |
| 2 | **Stale reads** | Tab A mutates and invalidates; tab B still renders the old row | The bug users report as "it didn't save" |
| 3 | **Duplicate writes** | Two tabs run `cart.checkout` at once | Two charges. Not a rendering bug |

They look like one feature ("sync my tabs") and are not: 1 is a *lock*, 2 is a
*message*, 3 is a *lock with a different answer for the loser*. A package that
only broadcasts cache state — the shape everyone reaches for first — solves 2 and
leaves 1 and 3 exactly where they were.

## 2. Three primitives instead

```txt
mirror   one tab's result becomes every tab's result — no second request
lock     one tab performs; the rest wait, refuse, queue, or adopt the result
leader   one tab owns the shared thing — the socket, the poll, the token refresh
```

All three key on the id every package here already keys on: `"module.member"`
(`endpointId` in typefetch, `eventId` in typesocket), plus the input hash for the
cases that are per-input. No new identifier enters the family.

### Non-goals

- **Not a sync engine.** No CRDTs, no merge semantics, no server component. The
  server stays the arbiter; this coordinates *one browser's* tabs.
- **Not persistence.** A reload empties everything. That is
  [`OFFLINE.md`](./OFFLINE.md), which depends on the leader primitive here.
- **Not cross-origin, not cross-device, not cross-profile.** The boundary is
  whatever the browser says same-origin means, and it is not ours to widen.

---

## 3. Package shape

```txt
packages/sync/
  src/
    index.ts              the primitives — no query engine imported
    query.ts              `./query` entry: the query-core binding
    tab-sync.ts           createTabSync()
    tab-id.ts             per-tab id, minted once
    protocol.ts           SyncMessage, PROTOCOL_VERSION, guards
    policy.ts             id matching: exact · "module.*" · "*"
    leader.ts             election over a LockAdapter
    channel/
      types.ts            ChannelAdapter
      broadcast.ts        BroadcastChannel
      storage.ts          `storage` event on localStorage
      memory.ts           tests, and the SSR no-op
    lock/
      types.ts            LockAdapter
      web-locks.ts        navigator.locks
      lease.ts            heartbeat lease over the channel (reliable: false)
      memory.ts
```

Two entry points, mirroring how `typewire-nestjs` splits per wire so an app
installs only what it uses:

```jsonc
{
  "name": "@tahanabavi/typewire-sync",
  "exports": {
    ".":       { "types": "./dist/index.d.ts",  "import": "./dist/index.mjs",  "require": "./dist/index.js" },
    "./query": { "types": "./dist/query.d.ts",  "import": "./dist/query.mjs",  "require": "./dist/query.js" }
  },
  "sideEffects": false,
  "peerDependencies":     { "@tahanabavi/typewire-query-core": "^1.2.0" },
  "peerDependenciesMeta": { "@tahanabavi/typewire-query-core": { "optional": true } }
}
```

Zero runtime dependencies, asserted by `scripts/assert-no-deps.mjs` like every
other package. New row for `size-budget.json`:

```json
{ "package": "sync", "entry": "dist/index.mjs", "maxGzip": 4200 }
```

---

## 4. Layer 0 — two seams, both replaceable

The package owns no browser API directly. It owns two adapters, in the same
spirit as typefetch's [`TransportAdapter`](../packages/typefetch/src/transport/adapter.ts),
so the whole thing is testable in Node with no browser.

```ts
export interface ChannelAdapter {
  post(message: SyncMessage): void;
  subscribe(handler: (message: SyncMessage) => void): () => void;
  close(): void;
}

export interface LockAdapter {
  /** Resolves when held. `null` means someone else has it and you said not to wait. */
  acquire(
    name: string,
    opts?: {
      mode?: "exclusive" | "shared";
      signal?: AbortSignal;
      ifAvailable?: boolean;
    },
  ): Promise<LockHandle | null>;
  /** False when the implementation cannot guarantee mutual exclusion. */
  readonly reliable: boolean;
}

export interface LockHandle {
  release(): void;
  readonly name: string;
}
```

| Environment | Channel | Lock | `reliable` |
| --- | --- | --- | --- |
| Modern browser, secure context | `BroadcastChannel` | `navigator.locks` | `true` |
| No `navigator.locks` | `BroadcastChannel` | channel lease + heartbeat | **`false`** |
| No `BroadcastChannel` | `storage` event on `localStorage` | channel lease | **`false`** |
| Node / SSR / worker without either | no-op | no-op, always grants | `false` |

`reliable` is not decoration. A lease built on messages and timers can
double-grant under clock skew or a frozen background tab, so:

> When the lock adapter is not `reliable`, an **`exclusive`** policy **fails
> closed** — the call rejects with `kind: "unavailable"` rather than running
> unprotected. A `single-flight` policy degrades to a plain local fetch, because
> a duplicate read is a cost, not a correctness bug.

Refusing to pretend is the same call this repo already made about the Connect
conformance runner: an unverified guarantee is worse than a documented gap.

The no-op row is what makes importing this safe from a Next.js server component.
Nothing throws on a server; the primitives behave as if this tab were alone,
which it is.

---

## 5. The protocol

```ts
export const PROTOCOL_VERSION = 1;

export type SyncEnvelope = {
  p: typeof PROTOCOL_VERSION; // protocol; a mismatch is dropped, never adopted
  app?: string;               // the consumer's own version, same rule
  tab: string;                // per-tab id, minted once
  at: number;                 // the origin's Date.now() — see rule 1
  seq: number;                // per-tab counter; breaks `at` ties
};

export type SyncBody =
  | { t: "data";       key: string; id: string; data: unknown }
  | { t: "hint";       key: string; id: string }
  | { t: "invalidate"; ids: string[] }
  | { t: "claim";      lock: string }
  | { t: "result";     lock: string; ok: boolean; data?: unknown; error?: unknown }
  | { t: "leader";     state: "claimed" | "released" }
  | { t: "user";       topic: string; payload: unknown };

export type SyncMessage = SyncEnvelope & SyncBody;
```

`hint` is the whole reason this is not merely "broadcast the cache". It says
*this key changed* without carrying the value — the fallback for payloads over
budget, and the only thing ever sent for an endpoint that carries a secret. A tab
displaying that key refetches; a tab that is not marks it stale and pays nothing.

`key` is query-core's `endpointId|hash(input)`, produced by `buildQueryKey` — the
package never invents a key format, it forwards the one the engine already made.

---

## 6. Five rules that make it correct

**1. Time, not arrival order.** A `data` message is adopted only when its `at`
(tie-broken by `seq`, then `tab`) is newer than the receiving tab's
`dataUpdatedAt` for that key. Message order across tabs is not causality — a
throttled tab flushing a queued message must not overwrite a newer local write.
This is the "double-update" bug that an optimistic update, a mutation response
and a realtime event produce together, and it gets fixed once, here, instead of
in every app.

**2. Garbage collection is not a removal.** `QueryCache.remove` emits the same
`{ type: "removed" }` whether the developer called `removeQueries` or a `gcTime`
timer fired — [`query-cache.ts:91-103`](../packages/query-core/src/query-cache.ts#L91-L103),
reached from `onGarbageCollect` on line 77. Broadcasting that event as-is means
an unmounted query in a background tab evicts the same query from the tab the
user is looking at. Needs `reason` upstream (§9).

**3. A payload has a budget.** `maxPayloadBytes` (default 64 KB) is measured
before posting; over budget, `data` degrades to `hint`. Broadcasting a
thousand-row list to six tabs on every keystroke is how "sync" becomes "jank".
Structured clone means `Date`, `Map` and `Set` survive the `BroadcastChannel`
path intact — only the `localStorage` fallback is JSON, and it takes the optional
`serialize` / `deserialize` pair.

**4. Opt out by id, not by hope.** Some state is deliberately per-tab: a draft, a
wizard step, which row is expanded. Those are named, not discovered in
production: `exclude: ["draft.*", "editor.getSession"]`.

**5. A dead leader must not be able to hang a follower.** Web Locks release
automatically when the holding tab dies, so a crash resolves in milliseconds. A
tab that is *alive but wedged* does not, so every wait carries `takeoverAfter`
(default 5 s), after which the follower stops waiting and does the work itself.
Slow is a degraded mode; stuck is a bug.

---

## 7. Policies, per endpoint id

| Policy | Reads | Writes | The loser gets |
| --- | --- | --- | --- |
| `mirror` (default for queries) | value broadcast, adopted by rule 1 | — | the data, and no request |
| `hint` | only the invalidation crosses | — | a stale mark; refetches if displayed |
| `single-flight` | one request per key across all tabs | — | the holder's result via `result` |
| `exclusive` | — | one tab may run it | a typed rejection, immediately |
| `queue` | — | one at a time, in order | its turn, after the holder settles |
| `adopt` | — | one tab runs, the rest resolve with its result | the same value the runner got |
| `local` | never crosses | never crosses | nothing — per-tab by design |

`exclusive`'s rejection is a real error in the family's
[`ErrorKind`](../packages/typefetch/src/types.ts#L202-L222) vocabulary, not a
timeout: `{ kind: "conflict"… }` is not in that union, so it is spelled
`{ kind: "aborted", locked: true, holder: "tab_7f3" }` — `aborted` is the
taxonomy's word for "a concurrency conflict stopped this". A UI can then say
*"this checkout is already running in another tab"*, which is the entire point.
A spinner that never ends is what a lock with no loser branch produces.

Matching is exact id, then `"module.*"`, then `"*"` — most specific wins, the
same resolution order `type-permission` uses.

---

## 8. Algorithms

### 8.1 Mirror, outbound

Subscribe to the cache bus once. For each `updated` event:

1. Resolve the policy for `event.endpointId`; stop unless it is `mirror`/`hint`.
2. Read `state.dataUpdatedAt`. Stop if it is not greater than `lastSent.get(key)`
   — this is what filters out the `fetchStatus` flips, which emit `updated` too.
3. Stop if `state.fetchStatus !== "idle"` — never broadcast a half-settled state.
4. `mirror`: measure the encoded size. Under budget → `data`; over → `hint`.
   `hint` policy → always `hint`.
5. `lastSent.set(key, at)`, then `post`.

Echo suppression falls out of step 2 rather than needing a flag: an adopted value
is written with the **origin's** `updatedAt` (§9), so the `updated` event it
causes carries an `at` that is not greater than the one just recorded.

### 8.2 Mirror, inbound

1. Drop the message if `p`/`app` mismatch, or if `msg.tab` is this tab.
2. `data` → look up the local `dataUpdatedAt` for `key`; apply only if
   `(msg.at, msg.seq, msg.tab) > (local, …)`. Apply via
   `setQueryData(endpoint, input, msg.data, { updatedAt: msg.at })`.
3. `hint` → `invalidateQueries({ key })`. A query with observers refetches; one
   without is simply marked stale, so a background tab pays nothing.
4. `invalidate` → `invalidateQueries({ endpointId: msg.ids })`, which is exactly
   what `relations` already produces locally.

Step 2 needs the endpoint object to write through the typed API, which is what
the `sources` resolver in §9 is for. A message for an endpoint this tab has never
mounted is dropped — there is no cache entry to update anyway, so `hint` is the
correct degradation and is what is sent.

### 8.3 Single-flight (reads)

Through the `gate` seam (§9), so nothing wraps or forks the engine's fetch path:

1. `handle = await locks.acquire("q:" + key, { ifAvailable: true })`.
2. **Got it** → `run()`, broadcast `{ t: "result", lock, ok, data }` and the
   normal `data` message, then `release()` in a `finally`.
3. **Did not** → wait for a `result` message naming this lock, up to
   `takeoverAfter`. Resolve with its payload (`ok: false` → reject with the
   carried error, so a failure is not silently retried by every tab at once).
4. **Timed out** → `run()` locally. A wedged holder degrades to today's
   behaviour, which is one extra request, not a hang.

### 8.4 Exclusive · queue · adopt (writes)

Same gate, on the mutation side:

- `exclusive` → `ifAvailable: true`; `null` rejects immediately with the locked
  error. If `!locks.reliable`, reject before even trying (§4).
- `queue` → plain `acquire` with the caller's `signal`; FIFO is the lock API's,
  not ours to reimplement.
- `adopt` → `ifAvailable: true`; on `null`, wait for `result` exactly as 8.3.3.

### 8.5 Leader

```ts
locks.acquire(name + "/leader", { signal }).then((h) => {
  if (!h) return;                       // aborted during teardown
  held = h;                             // never released until close()
  post({ t: "leader", state: "claimed" });
  for (const fn of pending) fn();
});
```

Holding a lock forever *is* the election: the browser releases it when the tab
dies, so the next waiter is promoted with no timeout and no heartbeat. `close()`
releases and posts `released`. With an unreliable adapter, `whenLeader` still
fires — in the worst case in two tabs — so anything that must be exactly-once
(the outbox drain) checks `locks.reliable` and refuses, while anything that is
merely wasteful when doubled (a poll) proceeds.

---

## 9. What this needs from the rest of the family

All additive. The package is not allowed to fork anyone's pipeline (design law 3).

| Package | Change | Why |
| --- | --- | --- |
| `query-core` | `reason: "gc" \| "explicit"` on the `removed` event, at [`query-cache.ts:98`](../packages/query-core/src/query-cache.ts#L98) | Rule 2. Nothing downstream can tell the two apart today |
| `query-core` | `setQueryData(endpoint, input, updater, { updatedAt })` | An adopted value must keep the origin's timestamp, not be restamped `Date.now()` at [`query.ts:256`](../packages/query-core/src/query.ts#L256) |
| `query-core` | a `gate` on `QueryClientOptions` | The one seam §8.3–8.4 need. Also what `typewire-offline` needs — one hook, three consumers |
| `query-core` | `sources` — an `endpointId` → endpoint resolver, defaulting to a map built from a client's `modules` | §8.2 must write a mirrored value through the typed API. [`OFFLINE.md`](./OFFLINE.md) needs the same lookup to hydrate |
| `typesocket` | `leaderOnly?: boolean` beside `autoConnect` in [`types.ts:336`](../packages/typesocket/src/types.ts#L336) | One socket per browser, inbound frames fanned out over the channel |
| `devtools-core` | a `tab` axis on `InspectorEvent` | Who leads, which locks wait, which writes were adopted rather than fetched. A new axis exactly as `transport` was in 8a — not a widening of `source` |
| `cli` | one question in `typewire init` when a query client is scaffolded | Nothing here works if nobody knows it exists |

```ts
// query-core: the gate seam
export type FetchGate = (
  ctx: { key: string; endpointId: string; input: unknown; kind: "query" | "mutation" },
  run: () => Promise<unknown>,
) => Promise<unknown>;

export interface QueryClientOptions {
  relations?: RelationsConfig;
  defaultOptions?: { … };
  /** Wraps every fetch and mutation. Default: `(_, run) => run()`. */
  gate?: FetchGate;
}
```

Absent a gate the engine behaves byte-for-byte as today, which is the condition
for landing it separately and ahead of this package.

---

## 10. The API — three tiers, and the bottom one is public

**Tier 1 — one line.** Everything above, on defaults:

```ts
import { syncQueryClient } from "@tahanabavi/typewire-sync/query";

syncQueryClient(client);
```

**Tier 2 — declared at the setup site**, beside `relations`, because that is
where this family puts cross-cutting policy. Contracts stay untouched (law 1):

```ts
const client = new QueryClient({ relations: { "cart.addItem": ["cart.getCart"] } });

const sync = syncQueryClient(client, {
  name: "acme-app",
  app: pkg.version,
  exclude: ["draft.*"],
  policy: {
    "cart.checkout": "exclusive",
    "report.export": "single-flight",
    "auth.*": "hint",           // never put a session on the channel
  },
  maxPayloadBytes: 64 * 1024,
  takeoverAfter: 5_000,
  channel: myChannelAdapter,    // both seams are injectable
  locks: myLockAdapter,
});

sync.close();
```

**Tier 3 — the primitives, with no query engine anywhere.** This is the "full
access" half: the package stays useful to someone who never installs query-core.

```ts
import { createTabSync } from "@tahanabavi/typewire-sync";

const tabs = createTabSync({ name: "acme-app" });

await tabs.lock("checkout", async () => {
  /* exactly one tab is ever in here */
});
const ran = await tabs.lock("checkout", fn, { ifAvailable: true }); // null if busy

tabs.emit("cart:changed", { id: 4 });
tabs.on("cart:changed", (payload) => {
  /* runs in every other tab */
});

tabs.leader.whenLeader(() => startPolling()); // runs in exactly one tab
tabs.leader.subscribe((isLeader) => setBadge(isLeader));
tabs.leader.isLeader();

tabs.reliable; // false ⇒ exclusivity is advisory here. Branch on it if it matters
tabs.close();
```

`whenLeader` is the SharedWorker pattern without a SharedWorker: Web Locks elect
a leader inside the tab itself, failover happens the moment the holder's tab
closes, and none of SharedWorker's debugging or Safari-version problems apply.
The leader is where a `typesocket` connection, a `refetchInterval` and a token
refresh belong — three things silently multiplied today by the number of open
tabs, the last of which is a race that can log everyone out.

---

## 11. Failure modes, named

| Mode | Behaviour |
| --- | --- |
| Holder tab closed mid-flight | the lock auto-releases; the next waiter fetches. Sub-frame |
| Holder tab alive but wedged | `takeoverAfter` elapses; the waiter does the work itself |
| Background tab throttled | timers slow, locks do not; leadership is unaffected |
| `BroadcastChannel` absent | `storage` fallback; `exclusive` fails closed |
| Message arrives out of order | rejected by rule 1, not applied |
| Payload over budget | degrades to `hint`; one refetch in the tabs that display it |
| Two tabs on different app versions | `p`/`app` mismatch — dropped, never adopted |
| Private window / partitioned storage | a separate channel namespace. The browser's boundary, not ours |
| Holder fetch rejects | the error is carried on `result`; waiters reject with it rather than stampeding |

## 12. Security boundary

`BroadcastChannel` is same-origin, and so is everything here — nothing crosses
origins, ever. But *same-origin* includes every script on the page. An endpoint
whose response carries a token or another user's data should be `hint`, so the
value is refetched under the receiving tab's own credentials rather than copied
across. `auth.*` defaults to `hint` for exactly this reason.

## 13. Test matrix

`createMemoryChannel()` and `createMemoryLocks()` ship from the package: N
simulated tabs in one Node process, deterministic ordering, no browser. Named
after the bug each prevents, per `AGENTS.md`:

| Test | Asserts |
| --- | --- |
| `a gc eviction in one tab does not remove the query in another` | rule 2 |
| `an older message does not overwrite a newer local write` | rule 1 |
| `an adopted value is not re-broadcast` | §8.1 step 2 |
| `a payload over budget is sent as a hint` | rule 3 |
| `an excluded id never leaves the tab` | rule 4 |
| `a second tab does not fetch while the first holds the key` | §8.3 |
| `a wedged holder releases the waiter after takeoverAfter` | rule 5 |
| `a failed holder fetch rejects the waiters with its error` | §8.3 step 3 |
| `exclusive rejects with the locked error while held` | §8.4 |
| `exclusive fails closed when the lock adapter is unreliable` | §4 |
| `queue runs the second mutation after the first settles` | §8.4 |
| `leadership moves to the next tab when the leader closes` | §8.5 |
| `a message from another protocol version is ignored` | §5 |
| `every primitive resolves when neither browser API exists` | §4, SSR |

## 14. Milestones

Each is done only when build + typecheck + test are green, the README is
written, and a changeset exists — `AGENTS.md`'s definition, unchanged.

| # | Milestone | Contains |
| --- | --- | --- |
| M1 | query-core seams | `reason`, `updatedAt`, `gate` — additive, behaviour unchanged, released on their own |
| M2 | Layer 0 | both adapters, all four implementations, the protocol, the memory harness |
| M3 | `createTabSync` | lock · channel · leader, tier 3 complete and independently useful |
| M4 | `./query` | mirror, single-flight, the policy map, the write policies |
| M5 | The rest of the family | `leaderOnly`, the devtools tab axis, the `init` question |

M3 is a shippable package on its own. If M4 slips, nothing that shipped is a
half-feature.

## 15. Open questions

1. **Is `mirror` the right default, or is `hint`?** `hint` is always safe and
   costs one refetch; `mirror` is the feature people actually want. Current lean:
   `mirror` by default, `hint` for anything matching `auth.*`.
2. **Does the mutation outbox live here or in `typewire-offline`?** A persisted
   queue must be drained by exactly one tab, so it needs the leader — but
   persistence is a different concern with a different dependency profile.
   Current lean: the outbox lives in `typewire-offline`, which *depends on* the
   leader primitive here.
3. **`shared` lock mode** — is a reader/writer split worth exposing, or does it
   only invite deadlocks in application code?
4. **The name.** `typewire-sync` reads like data sync (ElectricSQL, PowerSync),
   which this deliberately is not. `typewire-tabs` is narrower and more honest,
   but understates the leader primitive.
