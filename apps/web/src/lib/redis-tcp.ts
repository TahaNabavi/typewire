import net from 'node:net'

/**
 * A minimal RESP2 client for a local Redis, in about a hundred lines.
 *
 * Development runs against a Redis on localhost; production runs against
 * Upstash, which speaks HTTP. Rather than take a client library for the dev
 * half of that, this speaks the protocol directly — the command set the site
 * uses is small, replies arrive in order, and the whole thing stays a Node-only
 * module the edge never loads.
 *
 * Not a general-purpose client: no pub/sub, no cluster, no TLS. It is enough
 * for counters on a laptop.
 */

type Reply = string | number | null | Reply[]

const HOST = process.env.REDIS_HOST
const PORT = Number(process.env.REDIS_PORT ?? 6379)
const PASSWORD = process.env.REDIS_PASSWORD

export const tcpConfigured = Boolean(HOST)

interface Pending {
  resolve: (value: Reply) => void
  reject: (error: Error) => void
}

let socket: net.Socket | null = null
let buffer = Buffer.alloc(0)
const pending: Pending[] = []

function fail(error: Error) {
  while (pending.length > 0) pending.shift()!.reject(error)
  socket?.destroy()
  socket = null
  buffer = Buffer.alloc(0)
}

/**
 * Parse one reply starting at `offset`.
 * Returns null when the buffer does not yet hold a complete reply.
 */
function parse(
  buf: Buffer,
  offset: number
): { value: Reply; next: number } | null {
  const lineEnd = buf.indexOf('\r\n', offset)
  if (lineEnd === -1) return null

  const type = String.fromCharCode(buf[offset]!)
  const body = buf.toString('utf8', offset + 1, lineEnd)
  const afterLine = lineEnd + 2

  switch (type) {
    case '+':
      return { value: body, next: afterLine }
    case '-':
      throw new Error(body)
    case ':':
      return { value: Number(body), next: afterLine }
    case '$': {
      const length = Number(body)
      if (length === -1) return { value: null, next: afterLine }
      const end = afterLine + length
      if (buf.length < end + 2) return null
      return { value: buf.toString('utf8', afterLine, end), next: end + 2 }
    }
    case '*': {
      const count = Number(body)
      if (count === -1) return { value: null, next: afterLine }
      const items: Reply[] = []
      let cursor = afterLine
      for (let i = 0; i < count; i++) {
        const item = parse(buf, cursor)
        if (!item) return null
        items.push(item.value)
        cursor = item.next
      }
      return { value: items, next: cursor }
    }
    default:
      throw new Error(`Unexpected RESP type ${type}`)
  }
}

function drain() {
  while (pending.length > 0) {
    let result: { value: Reply; next: number } | null
    try {
      result = parse(buffer, 0)
    } catch (error) {
      // A command-level error belongs to the command that caused it, not to
      // the connection: reject that one and keep the socket.
      pending.shift()?.reject(error as Error)
      const lineEnd = buffer.indexOf('\r\n')
      buffer = lineEnd === -1 ? Buffer.alloc(0) : buffer.subarray(lineEnd + 2)
      continue
    }
    if (!result) return
    buffer = buffer.subarray(result.next)
    pending.shift()!.resolve(result.value)
  }
}

function connect(): net.Socket | null {
  if (!HOST) return null
  if (socket && !socket.destroyed) return socket

  const created = net.createConnection({ host: HOST, port: PORT })
  created.setNoDelay(true)
  created.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    drain()
  })
  created.on('error', (error) => fail(error))
  created.on('close', () => fail(new Error('redis: connection closed')))

  socket = created
  if (PASSWORD) void send(['AUTH', PASSWORD])
  return created
}

function encode(args: (string | number)[]): string {
  let out = `*${args.length}\r\n`
  for (const arg of args) {
    const value = String(arg)
    out += `$${Buffer.byteLength(value)}\r\n${value}\r\n`
  }
  return out
}

export function send(args: (string | number)[]): Promise<Reply> {
  const connection = connect()
  if (!connection) return Promise.resolve(null)

  return new Promise<Reply>((resolve, reject) => {
    pending.push({ resolve, reject })
    connection.write(encode(args), (error) => {
      if (error) reject(error)
    })
  })
}
