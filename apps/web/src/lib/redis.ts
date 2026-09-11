import { send, tcpConfigured } from '@/lib/redis-tcp'

/**
 * Redis, over whichever transport the environment provides.
 *
 *   production   Upstash, which speaks HTTP — no connection to pool, no
 *                dependency, works from a serverless function.
 *   development  a Redis on localhost, over its own protocol (see redis-tcp).
 *
 * Callers never learn which. Every command degrades to null when neither is
 * configured, so the site runs with no Redis at all — the rate limit simply
 * stops counting rather than failing the request it was asked about.
 *
 * Env — production:  UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 * Env — development: REDIS_HOST, REDIS_PORT (default 6379), REDIS_PASSWORD
 */

/**
 * The REST endpoint, under whichever name provisioned it.
 *
 * Upstash's own dashboard calls these UPSTASH_REDIS_REST_*. The Vercel
 * marketplace integration injects the same two values as UPSTASH_KV_REST_API_*,
 * and the older Vercel KV product used KV_REST_API_*. They are the same
 * endpoint and the same credential, so all three are accepted rather than
 * asking anyone to copy a secret into a second variable to satisfy this file.
 *
 * Note which token: the read-write one. The integration also injects
 * UPSTASH_KV_REST_API_READ_ONLY_TOKEN, and it is deliberately not consulted
 * here — the rate limit is a write (INCR, EXPIRE), so a read-only credential
 * would turn every attempt into a silently discarded error while `configured`
 * still reported true.
 */
const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ??
  process.env.UPSTASH_KV_REST_API_URL ??
  process.env.KV_REST_API_URL

const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ??
  process.env.UPSTASH_KV_REST_API_TOKEN ??
  process.env.KV_REST_API_TOKEN

const restConfigured = Boolean(REST_URL && REST_TOKEN)

const redisConfigured = restConfigured || tcpConfigured

type Command = (string | number)[]

async function exec<T>(command: Command): Promise<T | null> {
  if (restConfigured) {
    try {
      const res = await fetch(REST_URL!, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REST_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
        cache: 'no-store',
      })
      if (!res.ok) return null
      const json = (await res.json()) as { result?: T; error?: string }
      return json.error ? null : (json.result ?? null)
    } catch {
      return null
    }
  }

  if (tcpConfigured) {
    try {
      return (await send(command)) as T
    } catch {
      return null
    }
  }

  return null
}

export const redis = {
  get configured() {
    return redisConfigured
  },
  exec,
  incr: (key: string) => exec<number>(['INCR', key]),
}
