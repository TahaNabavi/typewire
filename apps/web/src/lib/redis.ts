import { send, sendAll, tcpConfigured } from "@/lib/redis-tcp";

/**
 * Redis, over whichever transport the environment provides.
 *
 *   production   Upstash, which speaks HTTP — no connection to pool, no
 *                dependency, works from a serverless function.
 *   development  a Redis on localhost, over its own protocol (see redis-tcp).
 *
 * Callers never learn which. Every command degrades to null when neither is
 * configured, so the site runs with no Redis at all — only the live counters
 * go quiet, and the panel says so.
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
 * here — every counter this app keeps is a write (INCR, PFADD, ZINCRBY,
 * EXPIRE), and a read-only credential would turn all of them into silently
 * discarded errors while the panel still reported Redis as configured.
 */
const REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ??
  process.env.UPSTASH_KV_REST_API_URL ??
  process.env.KV_REST_API_URL;

const REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ??
  process.env.UPSTASH_KV_REST_API_TOKEN ??
  process.env.KV_REST_API_TOKEN;

const restConfigured = Boolean(REST_URL && REST_TOKEN);

export const redisConfigured = restConfigured || tcpConfigured;

/** Which transport is live — the panel reports this. */
export const redisTransport: "upstash" | "tcp" | "none" = restConfigured
  ? "upstash"
  : tcpConfigured
    ? "tcp"
    : "none";

type Command = (string | number)[];

async function exec<T>(command: Command): Promise<T | null> {
  if (restConfigured) {
    try {
      const res = await fetch(REST_URL!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { result?: T; error?: string };
      return json.error ? null : (json.result ?? null);
    } catch {
      return null;
    }
  }

  if (tcpConfigured) {
    try {
      return (await send(command)) as T;
    } catch {
      return null;
    }
  }

  return null;
}

/** One round trip for a batch of writes. */
async function pipeline(commands: Command[]): Promise<void> {
  if (commands.length === 0) return;

  if (restConfigured) {
    try {
      await fetch(`${REST_URL}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
        cache: "no-store",
      });
    } catch {
      /* counters are best-effort; never fail a request over them */
    }
    return;
  }

  if (tcpConfigured) {
    try {
      await sendAll(commands);
    } catch {
      /* same */
    }
  }
}

export const redis = {
  get configured() {
    return redisConfigured;
  },
  transport: redisTransport,
  exec,
  pipeline,
  incr: (key: string) => exec<number>(["INCR", key]),
  get: (key: string) => exec<string>(["GET", key]),
  /** HyperLogLog: unique visitors without storing a single identifier. */
  pfadd: (key: string, value: string) => exec<number>(["PFADD", key, value]),
  pfcount: (key: string) => exec<number>(["PFCOUNT", key]),
  zincrby: (key: string, member: string) => exec<string>(["ZINCRBY", key, 1, member]),
  // ZREVRANGE rather than ZRANGE ... REV: the newer spelling needs Redis 6.2,
  // and a laptop's Redis is often older than that.
  zrevrange: (key: string, limit: number) =>
    exec<string[]>(["ZREVRANGE", key, 0, limit - 1, "WITHSCORES"]),
};

/** ["a","2","b","1"] → [{member:"a",score:2},…] */
export function parseScored(flat: string[] | null): Array<{ member: string; score: number }> {
  if (!flat) return [];
  const out: Array<{ member: string; score: number }> = [];
  for (let i = 0; i < flat.length; i += 2) {
    const member = flat[i];
    const score = flat[i + 1];
    if (member === undefined || score === undefined) continue;
    out.push({ member, score: Number(score) });
  }
  return out;
}
