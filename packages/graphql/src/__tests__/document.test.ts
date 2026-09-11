import { z } from 'zod'
import { DocumentGenerationError, generateDocument } from '../document'

/**
 * Generating the selection set from the response schema is the reason this
 * package exists: the shape that asks for the data and the shape that validates
 * it are one object, so they cannot drift.
 *
 * Where it cannot infer an answer it refuses by name rather than guessing — a
 * query the server rejects at runtime is strictly worse than a clear failure at
 * client construction.
 */

const gen = (input: Parameters<typeof generateDocument>[0]) =>
  generateDocument(input).replace(/\s+/g, ' ').trim()

describe('selection sets from Zod', () => {
  it('generates the common case with no configuration', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'GetUser',
        root: 'user',
        request: z.object({ id: z.string() }),
        response: z.object({ id: z.string(), name: z.string() }),
      })
    ).toBe('query GetUser($id: String!) { user(id: $id) { id name } }')
  })

  it('recurses into nested objects', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'GetUser',
        root: 'user',
        request: z.object({}),
        response: z.object({
          id: z.string(),
          profile: z.object({
            bio: z.string(),
            avatar: z.object({ url: z.string() }),
          }),
        }),
      })
    ).toBe('query GetUser { user { id profile { bio avatar { url } } } }')
  })

  it('selects a list exactly like its element', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'ListPosts',
        root: 'posts',
        request: z.object({}),
        response: z.array(z.object({ id: z.string(), title: z.string() })),
      })
    ).toBe('query ListPosts { posts { id title } }')
  })

  it('treats optional and nullable fields as ordinary selections', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'GetUser',
        root: 'user',
        request: z.object({}),
        response: z.object({
          id: z.string(),
          nickname: z.string().optional(),
          deletedAt: z.string().nullable(),
        }),
      })
    ).toBe('query GetUser { user { id nickname deletedAt } }')
  })

  it('treats enums and dates as leaves', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'GetUser',
        root: 'user',
        request: z.object({}),
        response: z.object({
          role: z.enum(['ADMIN', 'USER']),
          joined: z.date(),
        }),
      })
    ).toBe('query GetUser { user { role joined } }')
  })

  it('infers variable types from the request schema', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'Search',
        root: 'search',
        request: z.object({
          term: z.string(),
          limit: z.number().int(),
          ratio: z.number(),
          fuzzy: z.boolean(),
          tags: z.array(z.string()),
        }),
        response: z.object({ id: z.string() }),
      })
    ).toBe(
      'query Search($term: String!, $limit: Int!, $ratio: Float!, $fuzzy: Boolean!, $tags: [String!]!) ' +
        '{ search(term: $term, limit: $limit, ratio: $ratio, fuzzy: $fuzzy, tags: $tags) { id } }'
    )
  })

  it('drops the ! for an optional variable', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'Search',
        root: 'search',
        request: z.object({ term: z.string().optional() }),
        response: z.object({ id: z.string() }),
      })
    ).toBe('query Search($term: String) { search(term: $term) { id } }')
  })

  /**
   * `z.string()` generates `String!`, and a server expecting `ID!` rejects it.
   * There is nothing in the Zod type that could say otherwise, so the override
   * is the honest answer.
   */
  it('honours an explicit variable type for ID', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'GetUser',
        root: 'user',
        request: z.object({ id: z.string() }),
        response: z.object({ id: z.string() }),
        variableTypes: { id: 'ID!' },
      })
    ).toBe('query GetUser($id: ID!) { user(id: $id) { id } }')
  })

  it('generates a mutation the same way', () => {
    expect(
      gen({
        operation: 'mutation',
        operationName: 'CreatePost',
        root: 'createPost',
        request: z.object({ title: z.string() }),
        response: z.object({ id: z.string() }),
      })
    ).toBe(
      'mutation CreatePost($title: String!) { createPost(title: $title) { id } }'
    )
  })

  it('generates a rootless document from the top-level response shape', () => {
    expect(
      gen({
        operation: 'query',
        operationName: 'Bootstrap',
        request: z.object({}),
        response: z.object({
          me: z.object({ id: z.string() }),
          settings: z.object({ theme: z.string() }),
        }),
      })
    ).toBe('query Bootstrap { me { id } settings { theme } }')
  })

  it('reuses a shared schema through $ref without duplicating it wrongly', () => {
    const Author = z.object({ id: z.string(), name: z.string() })
    expect(
      gen({
        operation: 'query',
        operationName: 'GetPost',
        root: 'post',
        request: z.object({}),
        response: z.object({ author: Author, editor: Author }),
      })
    ).toBe('query GetPost { post { author { id name } editor { id name } } }')
  })
})

describe('what it refuses, and why', () => {
  it('refuses a union rather than guessing at inline fragments', () => {
    expect(() =>
      gen({
        operation: 'query',
        operationName: 'GetResult',
        root: 'result',
        request: z.object({}),
        response: z.object({
          outcome: z.union([
            z.object({ ok: z.boolean() }),
            z.object({ error: z.string() }),
          ]),
        }),
      })
    ).toThrow(DocumentGenerationError)
  })

  it('names the path of the union it could not express', () => {
    expect(() =>
      gen({
        operation: 'query',
        operationName: 'GetResult',
        root: 'result',
        request: z.object({}),
        response: z.object({
          outcome: z.union([
            z.object({ a: z.string() }),
            z.object({ b: z.string() }),
          ]),
        }),
      })
    ).toThrow(/result\.outcome/)
  })

  it('refuses a record, because GraphQL cannot ask for every field', () => {
    expect(() =>
      gen({
        operation: 'query',
        operationName: 'GetMeta',
        root: 'meta',
        request: z.object({}),
        response: z.object({ tags: z.record(z.string(), z.string()) }),
      })
    ).toThrow(/document/)
  })

  it('refuses variables with no root to attach them to', () => {
    expect(() =>
      gen({
        operation: 'query',
        operationName: 'Search',
        request: z.object({ term: z.string() }),
        response: z.object({ hit: z.object({ id: z.string() }) }),
      })
    ).toThrow(/no `root`/)
  })

  it('refuses an object variable it cannot name', () => {
    expect(() =>
      gen({
        operation: 'mutation',
        operationName: 'CreatePost',
        root: 'createPost',
        request: z.object({ input: z.object({ title: z.string() }) }),
        response: z.object({ id: z.string() }),
      })
    ).toThrow(/variableTypes/)
  })

  it('accepts that same object variable once it is named', () => {
    expect(
      gen({
        operation: 'mutation',
        operationName: 'CreatePost',
        root: 'createPost',
        request: z.object({ input: z.object({ title: z.string() }) }),
        response: z.object({ id: z.string() }),
        variableTypes: { input: 'CreatePostInput!' },
      })
    ).toBe(
      'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { id } }'
    )
  })
})
