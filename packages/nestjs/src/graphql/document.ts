/**
 * Reading just enough of a document
 * =================================
 * This package parses **no GraphQL**. It does not need to: both ends generate
 * their operation from the same contract, so an operation is identified by
 * **name** and answered from the endpoint's `response` schema — the schema that
 * produced the client's selection set in the first place.
 *
 * The name itself and the name-in-a-document reader come from
 * `@tahanabavi/typefetch-graphql`, deliberately: the client derives the name it
 * sends there, and a second copy of that rule here would be a routing table
 * that drifts silently.
 *
 * What is left is one reader, for the case where a request carries a document
 * but no `operationName`. typefetch always sends one; a hand-written `curl`, or
 * a GraphQL IDE pointed at this endpoint, may not.
 */

/**
 * The first field selected at the root — `{ user(id: $id) { … } }` → `user`.
 *
 * Only used to disambiguate when no name was sent, so a miss is harmless: the
 * caller falls back to reporting an unresolvable operation, which is what it
 * would have done anyway.
 */
export function rootFieldIn(document: string): string | undefined {
  const brace = document.indexOf('{')
  if (brace === -1) return undefined

  const rest = document.slice(brace + 1)
  return /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(rest)?.[1]
}
