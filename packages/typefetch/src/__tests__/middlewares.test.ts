import z from 'zod'
import { authMiddleware } from '../middlewares/auth'
import { cacheMiddleware } from '../middlewares/cache'
import { loggingMiddleware } from '../middlewares/logging'
import { retryMiddleware } from '../middlewares/retry'
import { EndpointDefZ, MiddlewareContext } from '@/types'

describe('middlewares', () => {
  const defaultEndpoint: EndpointDefZ = {
    method: 'GET',
    path: '/test',
    request: z.object({}),
    response: z.object({}),
    auth: false,
  }

  const createCtx = (
    url: string = '/test',
    method: string = 'GET'
  ): MiddlewareContext => ({
    url,
    init: {
      method,
      headers: {},
    },
    endpoint: defaultEndpoint,
  })

  const createNext = (payload: unknown = { ok: true, status: 200 }) =>
    jest.fn<Promise<Response>, []>(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: (payload as any)?.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )

  // ---------------- AUTH ----------------
  it('authMiddleware should add refreshed token', async () => {
    const ctx = createCtx()
    const next = createNext()

    await authMiddleware(ctx, next, {
      refreshToken: async () => 'NEW_TOKEN',
    })

    expect((ctx.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer NEW_TOKEN'
    )
    expect(next).toHaveBeenCalled()
  })

  it('authMiddleware should skip if no refreshToken provided', async () => {
    const ctx = createCtx()
    const next = createNext()

    await authMiddleware(ctx, next, {})

    expect(
      (ctx.init.headers as Record<string, string>)['Authorization']
    ).toBeUndefined()
    expect(next).toHaveBeenCalled()
  })

  // ---------------- CACHE ----------------
  it('cacheMiddleware should cache GET responses', async () => {
    const ctx = createCtx('/users', 'GET')
    const next = createNext({ users: [1, 2, 3], status: 200 })
    const middleware = cacheMiddleware({ ttl: 1000 })

    const res1 = await middleware(ctx, next)
    const data1 = await res1.json()
    expect(data1.users).toEqual([1, 2, 3])

    const res2 = await middleware(ctx, next)
    const data2 = await res2.json()

    // underlying fetch called only once
    expect(next).toHaveBeenCalledTimes(1)
    expect(data2.users).toEqual([1, 2, 3])
  })

  it('cacheMiddleware should bypass cache for non-GET requests', async () => {
    const ctx = createCtx('/users', 'POST')
    const next = createNext({ ok: true, status: 200 })
    const middleware = cacheMiddleware()

    const res = await middleware(ctx, next)
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('cacheMiddleware should cache per URL (different URLs do not share cache)', async () => {
    const middleware = cacheMiddleware({ ttl: 1000 })

    const ctxA = createCtx('/users?page=1', 'GET')
    const ctxB = createCtx('/users?page=2', 'GET')

    const nextA = createNext({ users: ['A'], status: 200 })
    const nextB = createNext({ users: ['B'], status: 200 })

    const resA1 = await middleware(ctxA, nextA)
    const resB1 = await middleware(ctxB, nextB)

    const dataA1 = await resA1.json()
    const dataB1 = await resB1.json()

    expect(dataA1.users).toEqual(['A'])
    expect(dataB1.users).toEqual(['B'])

    const resA2 = await middleware(ctxA, nextA)
    const resB2 = await middleware(ctxB, nextB)

    await resA2.json()
    await resB2.json()

    // each underlying call executed only once per URL
    expect(nextA).toHaveBeenCalledTimes(1)
    expect(nextB).toHaveBeenCalledTimes(1)
  })

  it('cacheMiddleware should expire cache after ttl', async () => {
    jest.useFakeTimers()

    const ctx = createCtx('/items', 'GET')
    const next = createNext({ items: [1], status: 200 })
    const middleware = cacheMiddleware({ ttl: 100 })

    const res1 = await middleware(ctx, next)
    const data1 = await res1.json()
    expect(data1.items).toEqual([1])

    // immediate second call -> cached
    const res2 = await middleware(ctx, next)
    await res2.json()
    expect(next).toHaveBeenCalledTimes(1)

    // advance time beyond ttl
    jest.advanceTimersByTime(150)

    const res3 = await middleware(ctx, next)
    const data3 = await res3.json()
    expect(data3.items).toEqual([1])
    // called again after cache expiry
    expect(next).toHaveBeenCalledTimes(2)

    jest.useRealTimers()
  })

  // ---------------- LOGGING ----------------
  it('loggingMiddleware should log request and response', async () => {
    const ctx = createCtx()
    const next = createNext({ ok: true, status: 200 })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await loggingMiddleware(ctx, next, {
      logRequest: true,
      logResponse: true,
      debug: true,
    })

    expect(logSpy).toHaveBeenCalledWith('➡️ Request:', ctx.url, ctx.init)
    expect(logSpy).toHaveBeenCalledWith('⬅️ Response:', 200)

    logSpy.mockRestore()
  })

  it('loggingMiddleware should NOT log when debug is false', async () => {
    const ctx = createCtx()
    const next = createNext({ ok: true, status: 200 })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    await loggingMiddleware(ctx, next, {
      logRequest: true,
      logResponse: true,
      debug: false,
    })

    expect(logSpy).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  it('loggingMiddleware should respect logRequest / logResponse flags', async () => {
    const ctx = createCtx()
    const next = createNext({ ok: true, status: 200 })

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    // only request logging
    await loggingMiddleware(ctx, next, {
      logRequest: true,
      logResponse: false,
      debug: true,
    })

    expect(logSpy).toHaveBeenCalledWith('➡️ Request:', ctx.url, ctx.init)
    expect(logSpy).not.toHaveBeenCalledWith('⬅️ Response:', 200)

    logSpy.mockClear()

    // only response logging
    await loggingMiddleware(ctx, next, {
      logRequest: false,
      logResponse: true,
      debug: true,
    })

    expect(logSpy).not.toHaveBeenCalledWith('➡️ Request:', ctx.url, ctx.init)
    expect(logSpy).toHaveBeenCalledWith('⬅️ Response:', 200)

    logSpy.mockRestore()
  })

  // ---------------- RETRY ----------------
  it('retryMiddleware should retry failed requests', async () => {
    const ctx = createCtx()
    let attempt = 0

    const next = jest.fn<Promise<Response>, []>(() => {
      attempt++
      if (attempt < 2) {
        return Promise.reject(new Error('fail'))
      }

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })

    const middleware = retryMiddleware({ maxRetries: 3, delay: 10 })

    const res = await middleware(ctx, next)
    const json = await res.json()

    expect(json.ok).toBe(true)
    // 1st attempt fails, 2nd succeeds
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('retryMiddleware should throw after exceeding maxRetries', async () => {
    const ctx = createCtx()

    const next = jest.fn<Promise<Response>, []>(() =>
      Promise.reject(new Error('fail always'))
    )

    const middleware = retryMiddleware({ maxRetries: 2, delay: 10 })

    await expect(middleware(ctx, next)).rejects.toThrow('fail always')
    // initial + 2 retries = 3 total
    expect(next).toHaveBeenCalledTimes(3)
  })

  it('retryMiddleware should not retry when maxRetries is 0', async () => {
    const ctx = createCtx()

    const next = jest.fn<Promise<Response>, []>(() =>
      Promise.reject(new Error('no retry'))
    )

    const middleware = retryMiddleware({ maxRetries: 0, delay: 10 })

    await expect(middleware(ctx, next)).rejects.toThrow('no retry')
    expect(next).toHaveBeenCalledTimes(1)
  })
})
