# Standard Schema — stop being a zod package (design)

TypeWire's pitch is "one contract, validated end-to-end". Today that sentence has
an unwritten clause: *…if your team uses zod*. Standard Schema removes it for
about a day of work, and the reason to do it is not fashion — a schema library is
the single hardest dependency to change in a codebase, so "rewrite your schemas
first" is where evaluation stops.

**Status: design, not implementation.** Roadmap row 11 in [`ROADMAP.md`](./ROADMAP.md).

---

## 1. The two specs, exactly

**Standard Schema v1** — the validation half. A validator implements one
property:

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { input: Input; output: Output };
    readonly validate: (
      value: unknown,
      options?: unknown,
    ) => Result<Output> | Promise<Result<Output>>;
  };
}

type Result<T> = { value: T; issues?: undefined } | { issues: ReadonlyArray<Issue> };
type Issue = { readonly message: string; readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> };
```

No runtime dependency comes with it: the spec is a type, and `~standard.validate`
is a method the schema object already carries.

**Standard JSON Schema v1** — the *introspection* half, which matters here more
than most projects because two features in this repo read a schema's shape rather
than validating with it:

```ts
readonly "~standard": {
  readonly jsonSchema: {
    input(options: { target: "draft-2020-12" | "draft-07" | "openapi-3.0" }): Record<string, unknown>;
    output(options: { … }): Record<string, unknown>;
  };
};
```

Implemented by Zod 4.2+, ArkType 2.1.28+, Valibot 1.2+, Zod Mini, VineJS 4.3+
and others. The `"openapi-3.0"` target is notable: `typewire generate openapi` is
already on the roadmap and this hands it the hard part.

## 2. Validate and introspect are different asks

| Need | Who has it | Spec that covers it |
| --- | --- | --- |
| Is this value valid, and what is the parsed output? | typefetch, typesocket, nestjs | Standard Schema |
| What *shape* is this schema? | graphql document generator, `generate openapi`, the tester's auto-input, `mock` | Standard **JSON** Schema |

Most libraries adopting Standard Schema only need the first. Skipping the second
here would mean the GraphQL transport — the headline feature, the reason to
choose this over Apollo — silently stays zod-only, which is a worse outcome than
not adopting at all.

## 3. Where zod actually is today

Ten non-test files in typefetch, three in typesocket, eight in nestjs, one in
graphql, one in the CLI. `query-core`, `permission`, `grpc` and `devtools-core`
import it **zero** times — they were built against ids and callables, so they need
nothing from this work.

| File | Uses zod for | After |
| --- | --- | --- |
| [`typefetch/src/client.ts:308,357,635,642,651,918`](../packages/typefetch/src/client.ts) | `.parse` / `.safeParse` | `validate()` helper |
| [`typefetch/src/client.ts:888`](../packages/typefetch/src/client.ts#L888) · [`utils/error-kind.ts:73`](../packages/typefetch/src/utils/error-kind.ts#L73) | `err instanceof z.ZodError` → `kind: "validation"` | issues, not `instanceof` (§5) |
| [`typefetch/src/schemas.ts`](../packages/typefetch/src/schemas.ts) | builds `zBlob()` / `zFile()` | moves to the `/zod` subpath |
| [`typefetch/src/utils/make-request-schema.ts`](../packages/typefetch/src/utils/make-request-schema.ts) | builds the `{path,query,body,headers}` object | moves to the `/zod` subpath |
| [`typefetch/src/modules/tester/generate-input.ts`](../packages/typefetch/src/modules/tester/generate-input.ts) | walks `_def` internals | rewritten as a JSON Schema walker (§6) |
| [`graphql/src/document.ts`](../packages/graphql/src/document.ts) | `z.toJSONSchema()` | `jsonSchemaOf()` ladder (§6) |
| [`nestjs/src/validation/*`](../packages/nestjs/src/validation/request-validator.ts) | `.safeParse` per field, coercion candidates | `validate()` helper |
| `typesocket` (3 files) | `.parse` on payloads and acks | `validate()` helper |

The good news is in the shape of that list: validation is a handful of call sites
that all do the same two things, and shape-reading is concentrated in two files.

## 4. The validate helper

One function, in typefetch, re-exported for the family:

```ts
export type AnySchema = StandardSchemaV1 | { parse(v: unknown): unknown; safeParse(v: unknown): any };

export class ValidationError extends Error {
  readonly kind = "validation" as const;
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
  readonly vendor: string;
}

/** Parse `value`, or throw `ValidationError`. Sync in, sync out — see below. */
export function validate<T>(schema: AnySchema, value: unknown): T;
export function validateAsync<T>(schema: AnySchema, value: unknown): Promise<T>;
```

Resolution order inside it:

1. `schema["~standard"]` present → call `validate`.
2. Else `schema.safeParse` present → call it (zod 3, and anything zod-shaped).
3. Else throw at **client construction** time, naming the endpoint — the same
   rule `TransportAdapter.validate()` follows: a misconfigured contract must fail
   at setup, never on the first call in production.

**The async question, decided:** `~standard.validate` may return a promise.
Zod, Valibot and ArkType return synchronously unless the schema itself is async,
so `validate()` checks the result for a `then` and throws a clear error
("this schema validates asynchronously; use an endpoint that awaits") rather than
silently returning a promise as if it were data. `validateAsync` is the path for
contracts that genuinely need it. Making every call site `await` unconditionally
would put a microtask between a cache read and its render for the 99% case that
does not need one.

## 5. `instanceof` was already a bug

`kind: "validation"` is currently derived from `err instanceof z.ZodError`. That
check fails whenever two copies of zod are resolved in one tree — the exact
condition `typewire doctor` exists to detect ([`CLI.md`](./CLI.md) §3.4). A
validation failure then reports as `unknown`, which is a silent misclassification
in the one field mixed-transport error handling depends on.

Standard Schema removes the class comparison entirely: a failed validation is a
returned `issues` array, and `ValidationError` is constructed by *us*, from *our*
module, so `kind` is set by construction rather than inferred. The dual-zod
symptom does not disappear (two zod copies still mean two schema identities), but
its worst consequence does.

## 6. Introspection: one ladder, two consumers

```ts
export function jsonSchemaOf(
  schema: AnySchema,
  target: "draft-2020-12" | "openapi-3.0" = "draft-2020-12",
  io: "input" | "output" = "output",
): Record<string, unknown>;
```

1. `schema["~standard"].jsonSchema` → use it. Vendor-neutral, spec'd, done.
2. Zod 4.0/4.1 without the companion spec → `z.toJSONSchema(schema)`, reached
   through an optional dynamic import so a Valibot user never bundles zod.
3. Neither → throw, naming the vendor and the escape hatch: `document` for
   GraphQL, an explicit `input` for the tester.

`graphql/src/document.ts` already walks JSON Schema rather than zod internals, so
it changes in exactly one place — the call that produces the document it walks —
and every unions/records/cycles refusal it already implements keeps working.

`tester/generate-input.ts` is the opposite: it sniffs `_def` and `kind` through
~40 branches. Rewriting it onto JSON Schema is the largest single piece of this
work and pays for itself twice, because `typewire mock` needs exactly the same
walker and would otherwise inherit the same zod-only limit.

## 7. What does not change

- **Every existing contract keeps working.** zod schemas satisfy Standard Schema
  as of 4.0; the fallback covers older ones.
- **zod stays the documented default.** Every example, the README, `typewire init`
  scaffolding: unchanged. This widens what typechecks, it does not move anyone.
- **`peerDependencies` stay peers.** One resolved instance per vendor is still
  required — `validate()` does not make two zod copies interchangeable.

## 8. Breaking changes, and the migration

Two, both in typefetch. `typefetch` **2.0.0 is already on npm**, so these are a
**v3** with real users behind it, not a free change folded into an unreleased
major. That is the argument for starting the additive milestones now and batching
this half with whatever else breaks, rather than shipping a major for it alone:

| Was | Becomes | Why |
| --- | --- | --- |
| `import { zBlob, zFile, makeRequestSchema } from "@tahanabavi/typefetch"` | `…/zod` | These *construct* zod schemas. Leaving them on the root entry means a Valibot app still bundles zod |
| `catch (e) { if (e instanceof z.ZodError) … }` | `catch (e) { if (e instanceof ValidationError) … }` | §5 |

Both are mechanical, so both are `typewire-codemod` entries (roadmap step 6) —
recorded against it as they land, per that step's rule, not reconstructed later.
`zod` moves from a required peer to an **optional** peer, which is also the
moment the "zero runtime dependencies" claim gets a second, sharper sentence:
zero dependencies *and* no opinion about your validator.

## 9. Test matrix

| Test | Asserts |
| --- | --- |
| `a valibot contract validates on the way out and the way in` | §4 path 1 |
| `an arktype contract validates on the way out and the way in` | §4 path 1 |
| `a zod 3 schema still validates through safeParse` | §4 path 2 |
| `a schema with neither interface fails at client construction` | §4 path 3 |
| `an async schema throws rather than returning a promise as data` | §4 |
| `a validation failure is kind "validation" with two zod copies loaded` | §5 — the old `instanceof` bug, named after it |
| `issues carry the failing path for every vendor` | §4 |
| `a selection set is generated from a valibot response schema` | §6 |
| `document generation names the vendor when introspection is unavailable` | §6 path 3 |
| `auto-generated input matches a valibot request schema` | §6 |
| `the root entry point does not import zod` | §8 — asserted on the built bundle, like `assert-no-deps.mjs` |

## 10. Milestones

| # | Milestone | Contains |
| --- | --- | --- |
| S1 | `validate()` + `ValidationError` in typefetch, every call site moved | No public API change; zod contracts behave identically |
| S2 | typesocket and nestjs onto the same helper | The server half stops being zod-only |
| S3 | `jsonSchemaOf()` + graphql document generation | The headline feature works for every vendor |
| S4 | `generate-input` rewritten onto JSON Schema | Unblocks `mock` and `generate openapi` |
| S5 | `/zod` subpath, optional peer, codemod entries | The major. Ships with the migration table above |

S1–S4 are all additive and ship as minors, so nothing on the roadmap waits for
them — they can run alongside the query-core seams and `typewire-sync`, which
touch no schema at all (`query-core` imports zod zero times). Only S5 breaks, and
it should ride one typefetch v3 together with the codemod (step 6), not a major
of its own. Every minor released in the meantime is one more version the v3
migration table has to cover, which is the cost of waiting — real, but bounded,
and much smaller than the cost of rushing a major.

## 11. Open questions

1. **Does `nestjs`'s query-param coercion survive vendor-neutrally?**
   [`validation/coerce.ts`](../packages/nestjs/src/validation/coerce.ts) tries a
   value against candidate branches with `safeParse`. `validate()` covers the
   attempt, but *enumerating union branches* is introspection — it may need the
   JSON Schema ladder too, or an explicit "coercion is zod-only" line in the
   README.
2. **`zBlob()` for other vendors.** The helper exists because
   `z.instanceof(Blob)` dereferences a global at module-eval time. Valibot and
   ArkType have the same trap and would want the same helper — one per vendor
   subpath, or documentation only?
3. **Do we accept Standard Schema *contracts* in the CLI's config?** `contracts`
   is imported, not parsed, so probably free — but `typewire list` prints request
   shapes, which is introspection.
4. **Validation cost.** `~standard.validate` is one extra property read and one
   call per validation. Worth a benchmark in the size/perf CI job before
   claiming it is free.
