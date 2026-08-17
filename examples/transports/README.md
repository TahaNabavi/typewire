# transports

One client, three wires: **REST**, **GraphQL** and **gRPC** on a single
contract — with errors that normalize across all of them.

```bash
pnpm --filter @typewire-examples/transports start   # runs, asserts, exits
pnpm --filter @typewire-examples/transports list    # the CLI, no server needed
```

Headless and self-asserting, so `pnpm test` covers it. An example that only
prints can drift from the packages it demonstrates without anyone noticing.

## What it shows

**The call site never names a protocol.** These three lines are the whole point:

```ts
const rest    = await user.getUser({ path: { id: "1" } });
const graphql = await user.profile({ id: "1" });
const grpc    = await user.syncUser({ id: "1" });
```

Each returns the same validated `User`. The transport is a property of the
*contract*, not of the call — so migrating a route from REST to gRPC is a change
to [`shared/contracts.ts`](./shared/contracts.ts) and nothing else. No second
client, no second auth setup, no second error shape.

**The GraphQL document is generated from the zod schema.** The contract writes no
query. This is what actually went over the wire:

```graphql
query UserProfile($id: String!) { user(id: $id) { id name email } }
```

Add a field to the response schema and the query asks for it. Nothing else in
the ecosystem closes that gap — with a hand-written document, the query and the
type that validates its result drift the first time someone edits one of them.

**Errors normalize.** Three completely different failure shapes:

| Wire | What the server sent | `error.kind` |
| --- | --- | --- |
| HTTP | `404` + `{ message }` | `not_found` |
| GraphQL | `200` + `extensions.code: "NOT_FOUND"` | `not_found` |
| gRPC | `404` + `{ code: "not_found" }` | `not_found` |

So an app's "show a not-found page" branch is written once. This is the part
that earns the abstraction — a client speaking three protocols is only useful
if application code stops caring which one it is on.

**Tooling asks the transport, never the endpoint.** `method` and `path` exist
only on http routes, so anything that prints a route has to go through
`describe()`:

```txt
user.getUser   HTTP     GET    /users/:id
user.profile   GraphQL  query  user
user.syncUser  gRPC     unary  user.v1.UserService/GetUser
```

That is `typewire list` output. It runs with **no server up and no client
built** — the config declares the adapters under `typefetch.transports` purely
so contracts-only commands can resolve them. Leave them out and those rows
degrade to `?`, with a warning saying so rather than a listing that looks
complete and is not.

**One definition of the client, imported by both.**
[`shared/client.ts`](./shared/client.ts) exports a factory and the adapter list;
[`typewire.config.ts`](./typewire.config.ts) imports them rather than building
its own:

```ts
// shared/client.ts
export const transports = [graphqlTransport(), grpcTransport()];
export function createClient(options: { baseUrl?: string; token?: string } = {}) { … }

// typewire.config.ts
import { createClient, transports } from "./shared/client.js";
export default defineConfig({ typefetch: { contracts, createClient, transports, … } });
```

The factory's options are exactly what the CLI passes, so it can be handed over
as-is — `--base-url` and `--token` arrive there. A second client built inside
the config would drift from this one the first time a middleware, a transport or
an auth header is added to either, and `typewire test` would then be exercising
a client the example does not run.

A repo with several API surfaces — dashboard, admin, landing — wraps these
sections in a `projects` block instead, one entry per surface with its own
contracts and client. This example has one API, so it declares one section and
the CLI treats it as a single implicit project.

## The server

[`shared/server.ts`](./shared/server.ts) speaks all three protocols on one
`node:http` server, hand-written rather than built on Apollo and a Connect
runtime: the point here is what goes over the wire, and a framework would hide
exactly the part worth reading. Each handler is the *whole* server side of its
protocol for a single unary call.

The GraphQL handler is not a GraphQL engine — it reads `variables` and answers
the one root field this example queries. Honest for a demo, wrong for anything
else.

## Files

| File | What it is |
| --- | --- |
| [`shared/contracts.ts`](./shared/contracts.ts) | Three endpoints, three transports, one response type |
| [`shared/client.ts`](./shared/client.ts) | The client factory and adapter list, imported by the app *and* the CLI |
| [`shared/server.ts`](./shared/server.ts) | REST + GraphQL + Connect on one port |
| [`main.ts`](./main.ts) | The run, with assertions |
| [`typewire.config.ts`](./typewire.config.ts) | The CLI reading the same contracts |
