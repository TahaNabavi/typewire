import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'

/**
 * One server, three protocols.
 *
 * Deliberately hand-written on `node:http` rather than built on Apollo and a
 * Connect runtime: the point of this example is what goes over the wire, and a
 * framework would hide exactly the part worth reading. Each handler below is
 * the *whole* server side of its protocol for a single unary call.
 *
 * The GraphQL handler is not a GraphQL engine — it reads `variables` and
 * answers the one root field this example queries. That is honest for a demo
 * and wrong for anything else; a real server parses the document.
 */

const USERS: Record<string, { id: string; name: string; email: string }> = {
  '1': { id: '1', name: 'Taha Nabavi', email: 'taha@example.com' },
  '2': { id: '2', name: 'Ada Lovelace', email: 'ada@example.com' },
}

export type RequestLog = {
  protocol: string
  method: string
  url: string
  /** The parsed request body, so the run can show what actually went over the wire. */
  body?: unknown
}

function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json'
) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/**
 * Start the demo server on an OS-assigned port.
 *
 * Port 0 rather than a fixed one: a hard-coded port collides with a second copy
 * of the run and with whatever else is listening on a developer's machine, and
 * the failure looks like a network bug rather than a port clash.
 */
export async function startServer(): Promise<{
  url: string
  log: RequestLog[]
  close: () => Promise<void>
}> {
  const log: RequestLog[] = []

  const server = createServer((req, res) => {
    void handle(req, res, log).catch(() => {
      json(res, 500, { message: 'server error' })
    })
  })

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })

  return {
    url: `http://127.0.0.1:${port}`,
    log,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  log: RequestLog[]
): Promise<void> {
  const url = req.url ?? '/'
  const method = req.method ?? 'GET'

  // ── gRPC, Connect unary JSON ───────────────────────────────────────────────
  // The URL *is* the routing: POST /{fully.qualified.Service}/{Method}. A
  // failure is a real HTTP status plus `{ code, message }` — which is what
  // makes this path curl-able, unlike binary grpc-web.
  if (method === 'POST' && url === '/user.v1.UserService/GetUser') {
    const body = await readJson(req)
    log.push({ protocol: 'gRPC', method, url, body })

    const user = USERS[String(body.id)]

    if (!user) {
      return json(res, 404, {
        code: 'not_found',
        message: `no user ${body.id}`,
      })
    }

    return json(res, 200, user)
  }

  // ── GraphQL ────────────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/graphql') {
    const body = await readJson(req)
    log.push({ protocol: 'GraphQL', method, url, body })

    const user = USERS[String(body.variables?.id)]

    if (!user) {
      // The legacy shape: HTTP 200, with the failure inside the envelope.
      // `extensions.code` is a convention rather than a spec, and it is the
      // only thing that says *what* went wrong.
      return json(res, 200, {
        errors: [
          {
            message: `no user ${body.variables?.id}`,
            path: ['user'],
            extensions: { code: 'NOT_FOUND' },
          },
        ],
      })
    }

    return json(res, 200, { data: { user } })
  }

  // ── REST ───────────────────────────────────────────────────────────────────
  const restMatch = /^\/users\/([^/?]+)/.exec(url)
  if (method === 'GET' && restMatch) {
    log.push({ protocol: 'HTTP', method, url })

    const user = USERS[decodeURIComponent(restMatch[1]!)]
    if (!user) return json(res, 404, { message: `no user ${restMatch[1]}` })

    return json(res, 200, user)
  }

  json(res, 404, { message: `no route for ${method} ${url}` })
}
