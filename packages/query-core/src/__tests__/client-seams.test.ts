import { buildQueryKey } from '../hash-key'
import { QueryClient } from '../query-client'
import { collectSources } from '../source'
import type { GateContext } from '../types'
import { makeEndpoint, makeEvent } from './helpers'

/**
 * The four seams step 8c adds for cross-tab sync and offline replay. Each is
 * additive: the "absent" case here is the contract that shipping them ahead of
 * their consumers is safe — the engine must behave exactly as before.
 */
describe('query client seams', () => {
  describe('gate', () => {
    it('routes a query fetch through the gate with its context', async () => {
      const seen: GateContext[] = []
      const client = new QueryClient({
        gate: (ctx, run) => {
          seen.push(ctx)
          return run()
        },
      })
      const endpoint = makeEndpoint('user.getUser', async () => ({ id: '1' }))

      await client.fetchQuery(endpoint, { id: '1' })

      expect(seen).toEqual([
        {
          key: buildQueryKey('user.getUser', { id: '1' }),
          endpointId: 'user.getUser',
          input: { id: '1' },
          kind: 'query',
        },
      ])
    })

    it('lets the gate supply a result without ever calling the endpoint', async () => {
      // A single-flight loser adopts a value broadcast by the winning tab; its
      // own request never goes out.
      const endpoint = makeEndpoint('user.getUser', async () => ({
        id: 'server',
      }))
      const client = new QueryClient({ gate: async () => ({ id: 'adopted' }) })

      const data = await client.fetchQuery(endpoint, { id: '1' })

      expect(data).toEqual({ id: 'adopted' })
      expect(endpoint.calls).toHaveLength(0)
    })

    it('routes a mutation through the gate with kind mutation', async () => {
      const seen: GateContext[] = []
      const client = new QueryClient({
        gate: (ctx, run) => {
          seen.push(ctx)
          return run()
        },
      })
      const update = makeEndpoint('user.updateUser', async () => ({ ok: true }))

      await client.watchMutation(update).mutateAsync({ id: '1' })

      expect(seen).toEqual([
        {
          key: buildQueryKey('user.updateUser', { id: '1' }),
          endpointId: 'user.updateUser',
          input: { id: '1' },
          kind: 'mutation',
        },
      ])
    })

    it('without a gate calls the endpoint exactly once — byte-for-byte', async () => {
      const client = new QueryClient()
      const endpoint = makeEndpoint('user.getUser', async () => ({ id: '1' }))

      await client.fetchQuery(endpoint, { id: '1' })

      expect(endpoint.calls).toEqual([{ id: '1' }])
    })
  })

  describe('setQueryData updatedAt', () => {
    it('keeps the supplied timestamp instead of restamping now', () => {
      const client = new QueryClient()
      const endpoint = makeEndpoint('user.getUser', async () => ({ id: '1' }))
      const origin = 1_000_000

      client.setQueryData(
        endpoint,
        { id: '1' },
        { id: '1' },
        { updatedAt: origin }
      )

      const key = buildQueryKey('user.getUser', { id: '1' })
      expect(client.cache.get(key)?.getState().dataUpdatedAt).toBe(origin)
    })

    it('stamps now when updatedAt is omitted', () => {
      const before = Date.now()
      const client = new QueryClient()
      const endpoint = makeEndpoint('user.getUser', async () => ({ id: '1' }))

      client.setQueryData(endpoint, { id: '1' }, { id: '1' })

      const key = buildQueryKey('user.getUser', { id: '1' })
      const at = client.cache.get(key)?.getState().dataUpdatedAt ?? 0
      expect(at).toBeGreaterThanOrEqual(before)
    })
  })

  describe('sources', () => {
    it('resolves an id back to its source from a record', () => {
      const endpoint = makeEndpoint('user.getUser', async () => ({ id: '1' }))
      const client = new QueryClient({ sources: { 'user.getUser': endpoint } })

      expect(client.resolveSource('user.getUser')).toBe(endpoint)
      expect(client.resolveSource('nope.missing')).toBeUndefined()
    })

    it('resolves through a function resolver', () => {
      const endpoint = makeEndpoint('user.getUser', async () => ({ id: '1' }))
      const client = new QueryClient({
        sources: (id) => (id === 'user.getUser' ? endpoint : undefined),
      })

      expect(client.resolveSource('user.getUser')).toBe(endpoint)
    })

    it('returns undefined when no sources are configured', () => {
      expect(new QueryClient().resolveSource('user.getUser')).toBeUndefined()
    })

    it('collectSources walks a modules tree and keys leaves by id', () => {
      const getUser = makeEndpoint('user.getUser', async () => ({ id: '1' }))
      const listUsers = makeEndpoint('user.listUsers', async () => [])
      const send = makeEvent('chat.sendMessage', async () => ({ ok: true }))
      const modules = { user: { getUser, listUsers }, chat: { send } }

      expect(collectSources(modules)).toEqual({
        'user.getUser': getUser,
        'user.listUsers': listUsers,
        'chat.sendMessage': send,
      })
    })

    it('a later tree wins a collision, so the specific client is passed last', () => {
      const generic = makeEndpoint('user.getUser', async () => ({
        id: 'generic',
      }))
      const specific = makeEndpoint('user.getUser', async () => ({
        id: 'specific',
      }))

      const map = collectSources(
        { user: { getUser: generic } },
        { user: { getUser: specific } }
      )

      expect(map['user.getUser']).toBe(specific)
    })
  })
})
