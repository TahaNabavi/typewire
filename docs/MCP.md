# `typewire generate mcp` — contracts as agent tools (design)

An agent that calls your API needs a tool definition per operation: a name, a
description, and a JSON Schema for the arguments. Teams write those by hand,
which makes them the fourth copy of a shape this repo exists to keep in one
place — and the copy that drifts fastest, because nothing typechecks it.

`generate openapi` is already on the roadmap. This is the same walk over the same
contracts with a different emitter, plus the two things a naive 1:1 mapping gets
wrong.

**Status: design, not implementation.** Roadmap row 14 in [`ROADMAP.md`](./ROADMAP.md).

---

## 1. It emits a file, not a runtime

The CLI is a devDependency and stays one ([`ARCHITECTURE.md`](./ARCHITECTURE.md)),
so nothing here ships an MCP server at runtime. The command writes a small
TypeScript file into the user's project; `@modelcontextprotocol/sdk` becomes
_their_ dependency, imported by _their_ file, versioned on _their_ schedule.

That is the same rule as everything else: anything that needs a dependency ships
separately, and here "separately" means "in the consuming project", because an
MCP server is an application, not a library.

The generated file is meant to be committed and edited. Emitting a
`// generated, do not edit` header over something people obviously will edit is
how a generator becomes a thing teams route around; instead the file is generated
once, and re-running the command with `--check` reports what has drifted.

## 2. The mapping

| Contract          | MCP tool                                                          | Note                                                                                                                 |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `"user.getUser"`  | `name: "user_getUser"`                                            | MCP names allow `[A-Za-z0-9_-]{1,64}`; the dot is the only illegal character, so the mapping is total and reversible |
| `request` schema  | `inputSchema`                                                     | via `jsonSchemaOf(…, "draft-2020-12", "input")` — [`SCHEMA.md`](./SCHEMA.md) §6                                      |
| `response` schema | `outputSchema`                                                    | same ladder, `"output"`                                                                                              |
| `describe()`      | `description` (fallback)                                          | `"GET /users/:id"` is a poor description, which is why §3 exists                                                     |
| `method` (http)   | `annotations.readOnlyHint` / `destructiveHint` / `idempotentHint` | `GET`/`HEAD` read-only; `DELETE`/`PUT` destructive; `GET`/`PUT`/`DELETE` idempotent                                  |
| `permission`      | tool filtering                                                    | §5                                                                                                                   |
| `errors` map      | the tool's documented failure list                                | agents retry better when the failure is named                                                                        |

The reason this is a small feature rather than a project: `"module.member"` is
already the family's stable identifier, so the tool name is not a new naming
scheme to maintain — it is the same id every other package keys on, with one
character substituted.

## 3. The part that is not mechanical

An auto-generated tool set is usually mediocre, and the reason is always the
same: `"GET /orders"` tells a model nothing about when to call it, what
pagination it needs, or which argument is a foreign key. Good tool descriptions
are LLM-facing prose, and they do not belong on the contract — design law 1 says
cache, devtools and query concerns never add parameters to a transport contract,
and "how to explain this to a model" is the same class of concern.

So it goes in `typewire.config.ts`, keyed by endpoint id, exactly the way
`relations` declares invalidation once at the setup site:

```ts
export default defineConfig({
  typefetch: { contracts },
  mcp: {
    out: './mcp/server.ts',
    include: ['catalog.*', 'order.get*'],
    tools: {
      'order.list': {
        title: 'List orders',
        description:
          'Orders for the signed-in customer, newest first. Page with `cursor` ' +
          'from the previous response; omit it for the first page. Use ' +
          '`order.get` when you already have an id.',
        examples: [{ input: { query: { limit: 20 } } }],
      },
      'order.cancel': { destructive: true, confirm: true },
    },
  },
})
```

Anything without an entry falls back to the schema's own descriptions
(`.describe()` in zod surfaces as `description` in the JSON Schema, so a
well-annotated contract already carries most of this) and then to `describe()`.
`typewire generate mcp --audit` lists the tools that got the mechanical fallback,
so the gap is visible instead of being discovered by a confused agent.

## 4. Arguments

`{ path, query, body, headers }` is honest but awkward for a model: three
nesting levels for what is conceptually one argument object.

- `headers` is **dropped**. An agent has no business setting them, and leaving
  them in invites prompt-injected header values.
- `flatten: true` (the default) merges `path` and `query` into the top level and
  spreads a `body` object beside them, refusing — at generate time, with the
  endpoint named — when two parts declare the same key. A collision is rare and
  a silent overwrite would be a data bug.
- `flatten: false` emits the contract shape verbatim, for anyone who prefers it.

Whatever the shape, the _runtime_ call goes through the generated client, so the
request is validated by the endpoint's own schema before it goes anywhere. An
agent that hallucinates an argument gets a validation error naming the field, not
a 400 from production.

## 5. Permission, auth and the safe default

The contract may carry `permission?: PermissionRequirement`
([`types.ts:307`](../packages/typefetch/src/types.ts#L307)) — the inline link to
`type-permission`. Two consequences the generator takes:

1. **Tools are filtered by the agent's own bits.** The generated server resolves
   a permission set for the caller and omits tools the caller could not call
   anyway. An agent that cannot see a tool cannot be talked into trying it, which
   is a materially better outcome than a 403 it will retry three times.
2. **`--read-only` is the default.** Only endpoints whose annotations say
   read-only are emitted unless `--allow-writes` is passed. A generator whose
   default output lets a model delete things is a generator that gets banned by
   the first security review.

Credentials never enter the generated file. It reads them from the environment
through the same `tokenProvider` the app's client uses — the CLI's `init` wizard
already knows how to pick the right env accessor per framework, and this reuses
it rather than inventing a second convention.

## 6. Command surface

```bash
typewire generate mcp                    # → ./mcp/server.ts, read-only tools
typewire generate mcp --allow-writes --out ./tools/server.ts
typewire generate mcp --project admin    # one API surface out of several
typewire generate mcp --check            # CI: fail if the emitted file has drifted
typewire generate mcp --audit            # which tools have no written description
```

It joins `TypeFetchCliCommand` in [`cli/src/types.ts:8`](../packages/cli/src/types.ts#L8)
and the switch in [`run-cli.ts:32`](../packages/cli/src/run-cli.ts#L32) as
`generate`, with the target as a positional — `generate openapi` and
`generate mcp` share the config loading, the `--project` selection and the
contract walk, and differ only in the emitter.

Like `list`, it needs **contracts only**: no client is constructed, no API is
reachable, so it runs in CI against a repo with no backend running.

## 7. What the generated file looks like

```ts
// typewire generate mcp · @tahanabavi/typewire-cli 0.2.0 · 14 tools · read-only
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ApiClient } from '@tahanabavi/typefetch'
import { contracts } from '../src/contracts'

const api = new ApiClient(
  { baseUrl: process.env.API_URL!, tokenProvider: () => process.env.API_TOKEN },
  contracts
)

const server = new McpServer({ name: 'acme-api', version: '1.4.2' })

server.registerTool(
  'order_list',
  {
    title: 'List orders',
    description: 'Orders for the signed-in customer, newest first. …',
    inputSchema: {/* generated from contracts.order.list.request */},
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args) => toolResult(() => api.modules.order.list(unflatten(args)))
)

await server.connect(new StdioServerTransport())
```

`toolResult` is emitted alongside: it catches the client's `RichError` and
returns the MCP error shape carrying the normalized `ErrorKind` and the
contract's own name for the failure. An agent seeing `"kind": "resource_exhausted"`
can back off; one seeing `"Request failed"` retries immediately, three times.

## 8. Failure modes, named

| Mode                                           | Behaviour                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Endpoint id is not a legal tool name           | substitution is total; a post-substitution collision fails the command, naming both ids |
| Schema cannot become JSON Schema               | the endpoint is skipped with a named warning, not emitted half-formed                   |
| Two parts declare the same key under `flatten` | generate-time error naming the endpoint and the key                                     |
| Contract adds an endpoint after generation     | `--check` fails in CI; that is the whole point of `--check`                             |
| Agent sends an invalid argument                | the endpoint's own request schema rejects it, before the network                        |
| Tool the caller lacks permission for           | never listed (§5)                                                                       |
| Streaming endpoint (`transport: "sse"`)        | skipped with a warning — MCP tools return a value, not a stream ([`SSE.md`](./SSE.md))  |

## 9. Test matrix

| Test                                                                                 | Asserts |
| ------------------------------------------------------------------------------------ | ------- |
| `an endpoint id becomes a legal mcp tool name`                                       | §2      |
| `two ids that collide after substitution fail the command`                           | §8      |
| `a described zod field becomes the argument description`                             | §3      |
| `a config tools entry overrides the mechanical description`                          | §3      |
| `flatten refuses when path and query share a key`                                    | §4      |
| `headers are never emitted as an argument`                                           | §4      |
| `writes are absent without --allow-writes`                                           | §5      |
| `an endpoint with a permission requirement is filtered for a caller without the bit` | §5      |
| `--check fails after a contract gains an endpoint`                                   | §8      |
| `a generated tool call validates its input against the contract`                     | §4      |
| `an ErrorKind survives into the mcp error payload`                                   | §7      |
| `generate runs with contracts only and no client`                                    | §6      |

## 10. Milestones

| #   | Milestone                   | Contains                                                            |
| --- | --------------------------- | ------------------------------------------------------------------- |
| C1  | `generate` command scaffold | config loading, `--project`, the emitter seam shared with `openapi` |
| C2  | The mapping                 | names, input/output schemas, annotations, `toolResult`              |
| C3  | Descriptions                | config `tools` block, schema-description fallback, `--audit`        |
| C4  | Safety                      | `--read-only` default, permission filtering, header stripping       |
| C5  | `--check`                   | drift detection, and the CI recipe in the docs                      |

C1 is shared with `generate openapi`, so whichever ships first pays for it.

## 11. Open questions

1. **Does this depend on [`SCHEMA.md`](./SCHEMA.md)?** `z.toJSONSchema()` covers
   zod today and would ship sooner. Generating tools only for zod users, then
   widening, is the pragmatic order — but it means writing the ladder twice.
2. **Resources and prompts, not just tools.** MCP has all three. A `GET`
   returning a document is arguably a resource. Tools first; the rest needs a
   real use case before guessing.
3. **One server per project, or one per API surface?** `projects` already models
   several APIs in a repo; an agent probably wants one server with a prefixed
   tool namespace, which is a naming decision with no obvious right answer.
4. **Elicitation for `confirm: true`.** MCP can ask the user to confirm before a
   destructive call. Worth emitting automatically for `destructiveHint` tools, or
   is that the host application's job?
