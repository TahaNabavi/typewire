import { z } from 'zod'

// Imported for their side effect on the *type* level: each transport package
// augments `TransportRegistry`, which is what makes `transport: "graphql"` and
// its `root`/`service`/`rpc` fields exist on the endpoint type at all. Without
// these two imports the contract below does not compile.
import '@tahanabavi/typefetch-graphql'
import '@tahanabavi/typefetch-grpc'

/**
 * One module, three wires.
 *
 * Every endpoint here returns the same `User`. What differs is only how it is
 * fetched — and that difference is confined entirely to this file. Nothing in
 * `main.ts` knows which route speaks which protocol, which is the whole claim
 * of the transport seam.
 */
const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

const NotFound = z.object({ message: z.string() })

export const contracts = {
  user: {
    /** REST. The default — no `transport` key means http. */
    getUser: {
      method: 'GET',
      path: '/users/:id',
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: User,
      errors: {
        404: NotFound,
      },
    },

    /**
     * GraphQL. No document is written here.
     *
     * The selection set is generated from the `response` schema above, so the
     * query and the type it validates against cannot drift — add a field to
     * `User` and the query asks for it. `root` names the field the variables
     * attach to, producing `user(id: $id) { id name email }`.
     */
    profile: {
      transport: 'graphql',
      operation: 'query',
      root: 'user',
      request: z.object({ id: z.string() }),
      response: User,
    },

    /**
     * gRPC, spoken as Connect unary JSON: a plain POST with a JSON body to
     * `/{service}/{rpc}`, real HTTP status codes, curl-able, and no protobuf
     * runtime anywhere in the dependency tree.
     */
    syncUser: {
      transport: 'grpc',
      service: 'user.v1.UserService',
      rpc: 'GetUser',
      request: z.object({ id: z.string() }),
      response: User,
      errors: {
        // Keyed by gRPC code rather than HTTP status — 5 is NOT_FOUND.
        5: NotFound,
      },
    },
  },
} as const
