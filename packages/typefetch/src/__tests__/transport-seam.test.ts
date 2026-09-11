import { z } from 'zod'
import { ApiClient, RichError } from '../client'
import { TRANSPORT_API_VERSION } from '../transport/adapter'
import type { TransportAdapter } from '../transport/adapter'
import { describeEndpoint } from '../transport/describe'
import { httpTransport } from '../transport/http'
import type { AnyEndpointDefZ, Contracts } from '../types'

global.fetch = jest.fn()

/**
 * The transport seam
 * ==================
 * These are written the way an adapter package will be: against the exported
 * interface only, with no access to client internals. That is the point — if a
 * transport cannot be built from the public surface, the seam is wrong, and the
 * first external adapter is the thing that proves it.
 *
 * The registry is augmented here rather than in the core so the union grows the
 * way a real adapter package makes it grow.
 */
declare module '../types' {
  interface TransportRegistry {
    echo: { channel: string }
  }
}

const echoTransport: TransportAdapter<'echo'> = {
  kind: 'echo',
  apiVersion: TRANSPORT_API_VERSION,
  capabilities: { uploadProgress: false, downloadProgress: false },

  validate(endpoint, endpointId) {
    if (!(endpoint as any).channel) {
      throw new Error(`[echo] Endpoint "${endpointId}" is missing "channel".`)
    }
  },

  describe(endpoint) {
    return {
      protocol: 'Echo',
      operation: 'send',
      target: (endpoint as any).channel,
    }
  },

  build(ctx) {
    return {
      url: `${ctx.baseUrl}/echo/${(ctx.endpoint as any).channel}`,
      init: {
        method: 'POST',
        headers: ctx.token
          ? { 'X-Echo-Token': ctx.token }
          : ({} as Record<string, string>),
        body: JSON.stringify(ctx.input),
      },
      parts: { headers: {}, isStructured: false, body: ctx.input },
    }
  },

  async decode(res) {
    const body = (await res.json()) as { payload: unknown }
    return { value: body.payload, enveloped: false }
  },

  async fail(res) {
    const body = (await res.json()) as { reason?: string; code?: string }
    return {
      error: {
        message: body.reason ?? 'echo failed',
        status: res.status,
        kind: 'unavailable',
        code: body.code,
        // The transport's own key space: a string, not an HTTP status.
        data: body,
        dataParsed: false,
        errorKey: body.code,
      },
      body,
      wasJson: true,
      enveloped: false,
    }
  },
}

const contracts = {
  chat: {
    send: {
      transport: 'echo',
      channel: 'general',
      request: z.object({ text: z.string() }),
      response: z.object({ id: z.string() }),
    },
    fetchOne: {
      method: 'GET',
      path: '/messages/:id',
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string() }),
    },
  },
} satisfies Contracts

function makeClient(extra: Record<string, unknown> = {}) {
  const client = new ApiClient(
    { baseUrl: 'https://api.test', transports: [echoTransport], ...extra },
    contracts
  )
  client.init()
  return client
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('a transport built only from the public seam', () => {
  beforeEach(() => (fetch as jest.Mock).mockReset())

  it('routes its own endpoints and leaves http alone', async () => {
    const client = makeClient()
    ;(fetch as jest.Mock).mockResolvedValueOnce(json({ payload: { id: 'm1' } }))

    await expect(client.modules.chat.send({ text: 'hi' })).resolves.toEqual({
      id: 'm1',
    })

    const [url, init] = (fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://api.test/echo/general')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ text: 'hi' })
  })

  it('still sends http endpoints over http', async () => {
    const client = makeClient()
    ;(fetch as jest.Mock).mockResolvedValueOnce(json({ id: 'm1' }))

    await client.modules.chat.fetchOne({ path: { id: 'm1' } })

    expect((fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.test/messages/m1'
    )
  })

  it('runs the same middleware chain', async () => {
    const client = makeClient()
    const seen: string[] = []
    client.use(async (ctx, next) => {
      seen.push(`${ctx.route?.transport}:${ctx.url}`)
      return next()
    })
    ;(fetch as jest.Mock).mockResolvedValueOnce(json({ payload: { id: 'm1' } }))

    await client.modules.chat.send({ text: 'hi' })

    expect(seen).toEqual(['echo:https://api.test/echo/general'])
  })

  it('builds its failures through the client, so they carry a kind', async () => {
    const client = makeClient()
    const handler = jest.fn()
    client.onError(handler)
    ;(fetch as jest.Mock).mockResolvedValueOnce(
      json({ reason: 'channel down', code: 'CHANNEL_DOWN' }, 500)
    )

    const error: RichError = await client.modules.chat
      .send({ text: 'hi' })
      .catch((e) => e)

    expect(error).toBeInstanceOf(RichError)
    expect(error.kind).toBe('unavailable')
    expect(error.errorKey).toBe('CHANNEL_DOWN')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('receives the resolved auth token without implementing token providers', async () => {
    const client = makeClient({ token: 't0k3n' })
    ;(client.modules.chat.send as any).endpoint.auth = true
    ;(fetch as jest.Mock).mockResolvedValueOnce(json({ payload: { id: 'm1' } }))

    await client.modules.chat.send({ text: 'hi' })

    expect((fetch as jest.Mock).mock.calls[0][1].headers).toEqual({
      'X-Echo-Token': 't0k3n',
    })
    ;(client.modules.chat.send as any).endpoint.auth = false
  })

  it('tags instrumentation with the transport that served the request', async () => {
    const client = makeClient()
    const kinds: Array<string | undefined> = []
    client.instrument({
      on: (event) => {
        if (event.type === 'start') kinds.push(event.transport)
      },
    })
    ;(fetch as jest.Mock).mockResolvedValueOnce(json({ payload: { id: 'm1' } }))

    await client.modules.chat.send({ text: 'hi' })

    expect(kinds).toEqual(['echo'])
  })
})

describe('registration', () => {
  it('rejects an adapter built against a different seam version', () => {
    const stale = { ...echoTransport, apiVersion: 99 }

    expect(
      () => new ApiClient({ baseUrl: 'x', transports: [stale] }, contracts)
    ).toThrow(/transport API version 99/)
  })

  it('fails at init() for an endpoint whose transport is not registered', () => {
    const client = new ApiClient({ baseUrl: 'https://api.test' }, contracts)

    expect(() => client.init()).toThrow(
      /"chat\.send" uses transport "echo", which is not registered/
    )
  })

  it("runs the adapter's own contract check at init(), not on first call", () => {
    const broken = {
      chat: {
        send: {
          transport: 'echo',
          request: z.object({}),
          response: z.object({}),
        },
      },
    } as unknown as Contracts
    const client = new ApiClient(
      { baseUrl: 'https://api.test', transports: [echoTransport] },
      broken
    )

    expect(() => client.init()).toThrow(/"chat\.send" is missing "channel"/)
  })

  it('catches a missing http field the same way', () => {
    const broken = {
      user: {
        get: { path: '/x', request: z.object({}), response: z.object({}) },
      },
    } as unknown as Contracts
    const client = new ApiClient({ baseUrl: 'https://api.test' }, broken)

    expect(() => client.init()).toThrow(/"user\.get" is missing "method"/)
  })
})

describe('describeEndpoint', () => {
  it('describes an http endpoint without a client', () => {
    expect(
      describeEndpoint(contracts.chat.fetchOne as AnyEndpointDefZ)
    ).toEqual({
      protocol: 'HTTP',
      operation: 'GET',
      target: '/messages/:id',
    })
  })

  it('uses a supplied adapter for a non-http endpoint', () => {
    expect(
      describeEndpoint(contracts.chat.send as AnyEndpointDefZ, [
        httpTransport as TransportAdapter,
        echoTransport as TransportAdapter,
      ])
    ).toEqual({ protocol: 'Echo', operation: 'send', target: 'general' })
  })

  /**
   * A listing that omits a route is worse than one that prints it with a `?`,
   * and a tool built before a transport existed should still run against
   * contracts that use it.
   */
  it('degrades instead of throwing for a transport it does not know', () => {
    expect(describeEndpoint(contracts.chat.send as AnyEndpointDefZ)).toEqual({
      protocol: 'echo',
      operation: '?',
      target: '?',
    })
  })
})

describe('capability warnings', () => {
  beforeEach(() => (fetch as jest.Mock).mockReset())

  /**
   * A capability the wire does not have is otherwise a silent no-op, and a
   * progress bar frozen at zero on a transfer that is working reads as a hung
   * app.
   */
  it('warns once when progress is asked of a transport that cannot report it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const client = makeClient()
    // A factory, not `mockResolvedValue`: a `Response` body can only be read
    // once, so reusing one instance locks its stream on the second request.
    ;(fetch as jest.Mock).mockImplementation(async () =>
      json({ payload: { id: 'm1' } })
    )

    await client.modules.chat.send(
      { text: 'a' },
      { onDownloadProgress: () => {} }
    )
    await client.modules.chat.send(
      { text: 'b' },
      { onDownloadProgress: () => {} }
    )

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/"echo".*cannot report download/s)
    warn.mockRestore()
  })
})
