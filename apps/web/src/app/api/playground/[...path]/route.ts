import { NextResponse, type NextRequest } from 'next/server'

import { contracts } from '@/features/playground/contracts'

/**
 * The playground's server — the other half of the same contract.
 *
 * Every route below implements an endpoint declared in
 * src/features/playground/contracts.ts
 * and validates its own response against that endpoint's schema before it
 * answers. That is the point: the server is held to the same object the client
 * holds it to, so "the route cannot drift from the client" is something a
 * visitor can watch happen rather than read about.
 *
 * ## The drift switch
 *
 * Mounting the client at `/api/playground/_drift` instead of `/api/playground`
 * makes the handlers return a shape the contract forbids — `fullName` where the
 * schema says `name`. The client's response validation then fails at the
 * boundary and names the field, which is the demonstration the whole site is
 * built around.
 *
 * It is a path prefix rather than a query parameter because typefetch appends
 * the endpoint path to `baseUrl` verbatim: a query string on the base would end
 * up in the middle of the URL. A prefix survives concatenation, and it has the
 * pleasant side effect of making the mode visible in the request URL.
 *
 * Data is a module-level fixture and resets whenever the serverless instance
 * does. Nothing here is persisted and nothing is per-visitor, so a POST from one
 * reader can be seen by the next — which is fine for a fixture and is stated in
 * the UI.
 */

interface Row {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
}

const SEED: Row[] = [
  { id: '1', name: 'Taha Nabavi', email: 'taha@example.com', role: 'admin' },
  { id: '2', name: 'Ada Lovelace', email: 'ada@example.com', role: 'member' },
  { id: '3', name: 'Grace Hopper', email: 'grace@example.com', role: 'member' },
]

let rows: Row[] = [...SEED]

/** Drift renames the one field the contract names — nothing else. */
function shape(row: Row, drift: boolean): unknown {
  if (!drift) return row
  const { name, ...rest } = row
  return { ...rest, fullName: name }
}

/**
 * Validate the response before sending it.
 *
 * A server that answers with a shape its own contract forbids is a bug, and it
 * should be loud on the server rather than mysterious on the client — except
 * when the drift switch is on, which is the whole point of the switch, so that
 * path deliberately skips the check and lets the client catch it instead.
 */
function send(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  body: unknown,
  drift: boolean
) {
  if (!drift) {
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'bad_implementation',
          detail: 'the route returned a shape its contract forbids',
        },
        { status: 500 }
      )
    }
  }
  return NextResponse.json(body)
}

const DRIFT_SEGMENT = '_drift'

/** Splits the mode prefix off the route, so handlers see the contract's path. */
function route(path: string[]): { route: string; drift: boolean } {
  const drift = path[0] === DRIFT_SEGMENT
  const rest = drift ? path.slice(1) : path
  return { route: `/${rest.join('/')}`, drift }
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params
  const { route: pathname, drift } = route(path)

  // GET /users/:id
  const match = /^\/users\/(.+)$/.exec(pathname)
  if (match !== null) {
    const row = rows.find((r) => r.id === match[1])
    if (row === undefined) {
      return NextResponse.json(
        { code: 'not_found', id: match[1] },
        { status: 404 }
      )
    }
    return send(contracts.user.getUser.response, shape(row, drift), drift)
  }

  // GET /users
  if (pathname === '/users') {
    const role = request.nextUrl.searchParams.get('role')
    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = Number.isFinite(Number(limitParam ?? '10'))
      ? Number(limitParam ?? '10')
      : 10
    const filtered = role !== null ? rows.filter((r) => r.role === role) : rows
    const items = filtered.slice(0, limit)
    return send(
      contracts.user.listUsers.response,
      { items: items.map((r) => shape(r, drift)), total: filtered.length },
      drift
    )
  }

  return NextResponse.json(
    { code: 'no_such_route', route: pathname },
    { status: 404 }
  )
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params
  const { route: pathname, drift } = route(path)

  if (pathname !== '/users') {
    return NextResponse.json(
      { code: 'no_such_route', route: pathname },
      { status: 404 }
    )
  }

  const body = (await request.json().catch(() => ({}))) as Partial<Row>

  if (rows.some((r) => r.email === body.email)) {
    return NextResponse.json(
      { code: 'email_taken', email: body.email },
      { status: 409 }
    )
  }

  const row: Row = {
    id: String(rows.length + 1),
    name: String(body.name ?? ''),
    email: String(body.email ?? ''),
    role: body.role === 'admin' ? 'admin' : 'member',
  }

  // Keep the fixture from growing without bound across a long-lived instance.
  rows = [...rows, row].slice(-12)

  return send(contracts.user.createUser.response, shape(row, drift), drift)
}

/** Resets the fixture — the console offers it, because a demo should be resettable. */
export async function DELETE() {
  rows = [...SEED]
  return NextResponse.json({ ok: true, rows: rows.length })
}
