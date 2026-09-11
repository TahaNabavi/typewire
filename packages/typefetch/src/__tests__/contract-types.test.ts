import { z } from 'zod'
import { isContractError, RichError } from '../client'
import type {
  AnyEndpointDef,
  Contracts,
  EndpointDef,
  EndpointFor,
  TransportKind,
} from '../types'

/**
 * Contract type guarantees
 * ========================
 * These assertions are the deliverable of the transport-registry change, so
 * they are checked the same way everything else is — `ts-jest` type-checks each
 * test file, which makes `@ts-expect-error` a real assertion that fails the run
 * when the error it expects stops happening.
 *
 * The registry is an open `interface`, so the union it produces cannot be
 * verified from inside this package beyond "http is in it and nothing else is".
 * That an adapter package can *add* to it is proven by the first real adapter —
 * see `docs/TRANSPORTS.md`, where building the GraphQL package outside the core
 * is deliberately the test of the seam.
 */

describe('contract types', () => {
  it('accepts a contract written before transports existed', () => {
    const contracts = {
      user: {
        getUser: {
          method: 'GET',
          path: '/users/:id',
          request: z.object({ path: z.object({ id: z.string() }) }),
          response: z.object({ id: z.string() }),
        },
      },
    } satisfies Contracts

    // Omitting `transport` resolves to the http variant, unchanged — and the
    // same object satisfies both the http-only and the any-transport type.
    const asHttp: EndpointDef<z.ZodTypeAny, z.ZodTypeAny> =
      contracts.user.getUser
    const asAny: AnyEndpointDef<z.ZodTypeAny, z.ZodTypeAny> =
      contracts.user.getUser

    expect(asHttp.method).toBe('GET')
    expect(asAny.path).toBe('/users/:id')
  })

  it('accepts an explicit transport: "http"', () => {
    const contracts = {
      user: {
        getUser: {
          transport: 'http',
          method: 'GET',
          path: '/users',
          request: z.object({}),
          response: z.object({}),
        },
      },
    } satisfies Contracts

    expect(contracts.user.getUser.transport).toBe('http')
  })

  it('rejects a transport whose adapter package is not installed', () => {
    const contracts = {
      user: {
        getUser: {
          // @ts-expect-error "grpc" is only a valid transport once
          // @tahanabavi/typefetch-grpc augments TransportRegistry.
          transport: 'grpc',
          service: 'user.v1.UserService',
          rpc: 'GetUser',
          request: z.object({}),
          response: z.object({}),
        },
      },
    } satisfies Contracts

    expect(contracts.user.getUser).toBeDefined()
  })

  it('still rejects a misspelled key on an endpoint', () => {
    const contracts = {
      user: {
        getUser: {
          method: 'GET',
          path: '/users',
          request: z.object({}),
          response: z.object({}),
          // @ts-expect-error `responsType` is not a key on any variant; the
          // intersection must not weaken excess-property checking.
          responsType: 'json',
        },
      },
    } satisfies Contracts

    expect(contracts.user.getUser).toBeDefined()
  })

  it('exposes http as the only registered transport for now', () => {
    const kind: TransportKind = 'http'
    // @ts-expect-error nothing else is registered in the core package.
    const missing: TransportKind = 'graphql'

    type HttpDef = EndpointFor<'http', z.ZodTypeAny, z.ZodTypeAny>
    const def: HttpDef = {
      method: 'POST',
      path: '/x',
      request: z.object({}),
      response: z.object({}),
    }

    expect(kind).toBe('http')
    expect(missing).toBe('graphql')
    expect(def.method).toBe('POST')
  })
})

/**
 * The `errors` key space belongs to the transport, so it had to widen from
 * `number` to `number | string` — a GraphQL endpoint keys its declared errors by
 * `extensions.code`. Numeric keys must keep working exactly as before, and
 * `isContractError` must narrow off either.
 */
describe('error maps accept both key spaces', () => {
  const contracts = {
    user: {
      createUser: {
        method: 'POST',
        path: '/users',
        request: z.object({}),
        response: z.object({ id: z.string() }),
        errors: {
          409: z.object({ conflictField: z.string() }),
          UNAUTHENTICATED: z.object({ realm: z.string() }),
        },
      },
    },
  } satisfies Contracts

  it('narrows on a numeric key', () => {
    const error = new RichError({
      message: 'conflict',
      status: 409,
      errorKey: 409,
      data: { conflictField: 'email' },
      dataParsed: true,
    })

    if (isContractError(contracts.user.createUser, error, 409)) {
      expect(error.data.conflictField).toBe('email')
    } else {
      throw new Error('expected the 409 to narrow')
    }
  })

  it('narrows on a string key', () => {
    const error = new RichError({
      message: 'denied',
      status: 200,
      errorKey: 'UNAUTHENTICATED',
      data: { realm: 'api' },
      dataParsed: true,
    })

    if (isContractError(contracts.user.createUser, error, 'UNAUTHENTICATED')) {
      expect(error.data.realm).toBe('api')
    } else {
      throw new Error('expected the string key to narrow')
    }
  })

  it('rejects a key the contract never declared', () => {
    const error = new RichError({ message: 'x' })

    expect(
      // @ts-expect-error 418 is not a declared error key on this endpoint.
      isContractError(contracts.user.createUser, error, 418)
    ).toBe(false)
  })
})
