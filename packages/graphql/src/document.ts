import { z } from 'zod'

/**
 * Document generation
 * ===================
 * The reason to use this transport rather than a GraphQL client: **the selection
 * set is derived from the Zod schema that validates the response**, so the shape
 * that requests the data and the shape that checks it are the same object and
 * cannot drift. A field added to the schema is requested; a field removed stops
 * being requested; a typo is a type error rather than a `null` in production.
 *
 * It walks `z.toJSONSchema()` output rather than Zod's internals — that is
 * public, stable API in Zod 4, and it already resolves the representation
 * questions (what is optional, what is nullable, what is a union) that make
 * schema introspection fragile.
 *
 * Where a selection set genuinely cannot be inferred — unions, records, cycles —
 * it refuses with the path that caused it and points at `document`. Guessing
 * would produce a query the server rejects at runtime, which is strictly worse
 * than a clear failure at client construction.
 */

type JsonSchema = Record<string, any>

export class DocumentGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentGenerationError'
  }
}

/** Resolve a `$ref` against the document's `$defs`. */
function deref(node: JsonSchema, root: JsonSchema): JsonSchema {
  let current = node
  let hops = 0

  while (current && typeof current.$ref === 'string') {
    if (++hops > 100) {
      throw new DocumentGenerationError('Unresolvable $ref chain in schema.')
    }

    const path = current.$ref.replace(/^#\//, '').split('/')
    let target: any = root
    for (const segment of path) target = target?.[segment]

    if (!target) {
      throw new DocumentGenerationError(
        `Could not resolve "${current.$ref}" while generating a selection set.`
      )
    }

    current = target
  }

  return current
}

/**
 * Strip the `null` branch a nullable schema produces.
 *
 * Nullability is not expressible in a selection set — you ask for a field the
 * same way whether or not it can come back null — so it is dropped here rather
 * than treated as a union the generator cannot handle.
 */
function withoutNull(node: JsonSchema): JsonSchema {
  const branches: JsonSchema[] | undefined = node.anyOf ?? node.oneOf

  if (Array.isArray(branches)) {
    const real = branches.filter((b) => b?.type !== 'null')
    if (real.length === 1) return real[0]!
    if (real.length > 1) return { ...node, anyOf: real, oneOf: undefined }
  }

  if (Array.isArray(node.type)) {
    const types = node.type.filter((t: string) => t !== 'null')
    if (types.length === 1) return { ...node, type: types[0] }
  }

  return node
}

/**
 * The selection set for one schema node, or `null` when it is a leaf.
 *
 * `null` means "a scalar — request it by name with no braces". Anything with
 * fields returns `{ a b { c } }`.
 */
function selectionFor(
  node: JsonSchema,
  root: JsonSchema,
  path: string,
  seen: ReadonlySet<JsonSchema>
): string | null {
  const resolved = withoutNull(deref(node, root))

  if (seen.has(resolved)) {
    throw new DocumentGenerationError(
      `Recursive schema at "${path}". A GraphQL query must be finite, so its ` +
        `depth has to be chosen by hand — supply \`document\` for this endpoint.`
    )
  }

  if (resolved.anyOf || resolved.oneOf) {
    throw new DocumentGenerationError(
      `Cannot generate a selection set for the union at "${path}". GraphQL ` +
        `needs inline fragments (\`... on Type { … }\`) and the schema does not ` +
        `say which types those are — supply \`document\` for this endpoint.`
    )
  }

  if (resolved.type === 'array') {
    // A list selects exactly like its element; GraphQL has no bracket syntax in
    // a selection set.
    return selectionFor(resolved.items ?? {}, root, `${path}[]`, seen)
  }

  if (resolved.type !== 'object' && !resolved.properties) {
    // Scalars, enums, dates, and anything untyped (`z.any()`): a leaf field.
    return null
  }

  const properties = resolved.properties as
    Record<string, JsonSchema> | undefined

  if (!properties || Object.keys(properties).length === 0) {
    throw new DocumentGenerationError(
      `Cannot generate a selection set for "${path}": it is an object with no ` +
        `declared fields (a \`z.record\` or passthrough object). GraphQL has no ` +
        `way to ask for "everything" — supply \`document\` for this endpoint.`
    )
  }

  const nested = new Set(seen)
  nested.add(resolved)

  const fields = Object.entries(properties).map(([name, child]) => {
    const sub = selectionFor(child, root, `${path}.${name}`, nested)
    return sub ? `${name} ${sub}` : name
  })

  return `{ ${fields.join(' ')} }`
}

/** Map a JSON Schema node to a GraphQL type reference. */
function graphqlTypeFor(
  node: JsonSchema,
  root: JsonSchema,
  name: string,
  required: boolean
): string {
  const resolved = withoutNull(deref(node, root))
  const nullable = resolved !== deref(node, root) || !required
  const suffix = nullable ? '' : '!'

  if (resolved.type === 'array') {
    const inner = graphqlTypeFor(resolved.items ?? {}, root, name, true)
    return `[${inner}]${suffix}`
  }

  // An enum is a named GraphQL type this generator cannot invent a name for.
  if (Array.isArray(resolved.enum) || resolved.type === 'object') {
    throw new DocumentGenerationError(
      `Cannot infer a GraphQL type for variable "$${name}". Name it explicitly ` +
        `with \`variableTypes: { ${name}: "SomeInput!" }\`.`
    )
  }

  switch (resolved.type) {
    case 'string':
      return `String${suffix}`
    case 'integer':
      return `Int${suffix}`
    case 'number':
      return `Float${suffix}`
    case 'boolean':
      return `Boolean${suffix}`
    default:
      throw new DocumentGenerationError(
        `Cannot infer a GraphQL type for variable "$${name}". Name it ` +
          `explicitly with \`variableTypes: { ${name}: "…" }\`.`
      )
  }
}

/** `chat.sendMessage` → `ChatSendMessage`, so server logs read sensibly. */
export function operationNameFrom(endpointId: string): string {
  const name = endpointId
    .split(/[.\-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

  return name || 'Anonymous'
}

/** Pull the operation name out of a hand-written document, if it declares one. */
export function operationNameOf(document: string): string | undefined {
  return /\b(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(document)?.[1]
}

export type GenerateDocumentInput = {
  operation: 'query' | 'mutation'
  request: z.ZodTypeAny
  response: z.ZodTypeAny
  root?: string
  operationName: string
  variableTypes?: Record<string, string>
}

/**
 * Build a complete operation document from the endpoint's schemas.
 *
 * Variables become the root field's arguments — `user(id: $id)` — which is the
 * convention that makes the common case need no configuration at all. Without
 * `root` there is no single field to attach them to, so variables and no root is
 * refused rather than silently dropping the arguments.
 */
export function generateDocument(input: GenerateDocumentInput): string {
  const { operation, request, response, root, operationName } = input

  const requestSchema = z.toJSONSchema(request, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema
  const responseSchema = z.toJSONSchema(response, {
    io: 'output',
    unrepresentable: 'any',
  }) as JsonSchema

  const properties = (requestSchema.properties ?? {}) as Record<
    string,
    JsonSchema
  >
  const required: string[] = requestSchema.required ?? []
  const names = Object.keys(properties)

  const declarations = names.map((name) => {
    const declared = input.variableTypes?.[name]
    const type =
      declared ??
      graphqlTypeFor(
        properties[name]!,
        requestSchema,
        name,
        required.includes(name)
      )
    return `$${name}: ${type}`
  })

  const header = declarations.length
    ? `${operation} ${operationName}(${declarations.join(', ')})`
    : `${operation} ${operationName}`

  if (!root) {
    if (names.length) {
      throw new DocumentGenerationError(
        `Endpoint "${operationName}" has variables but no \`root\`, so there is ` +
          `no field to attach them to as arguments. Set \`root\` to the field ` +
          `being queried, or supply \`document\`.`
      )
    }

    const selection = selectionFor(
      responseSchema,
      responseSchema,
      'response',
      new Set()
    )

    if (!selection) {
      throw new DocumentGenerationError(
        `The response schema for "${operationName}" is a scalar, so there is ` +
          `nothing to select. Set \`root\`, or supply \`document\`.`
      )
    }

    return `${header} ${selection}`
  }

  const args = names.length
    ? `(${names.map((name) => `${name}: $${name}`).join(', ')})`
    : ''
  const selection = selectionFor(
    responseSchema,
    responseSchema,
    root,
    new Set()
  )

  return `${header} { ${root}${args}${selection ? ` ${selection}` : ''} }`
}
