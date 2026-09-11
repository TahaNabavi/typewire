'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDevtools, type WireName } from '@/features/devtools/store'
import { TRANSPORT_LABEL, type Transport } from '@/lib/registry'
import { cn } from '@/utils'

/**
 * The inspector, as the design draws it: one timeline for every wire, each row
 * badged by the transport it used, each failure named by the same taxonomy, and
 * a query-cache tab beside it.
 *
 * The rows are a fixture, not live data — this is a picture of the tool. What
 * is real is the behaviour: hovering a wire in the legend dims every other row,
 * which is the point being made (one timeline, four wires, one filter).
 */

interface Row {
  wire: Transport
  method: string
  id: string
  duration: string
  pct: number
  status: string
  ok: 'ok' | 'fail' | 'warn'
}

const ROWS: Row[] = [
  {
    wire: 'http',
    method: 'GET',
    id: 'user.getUser',
    duration: '142ms',
    pct: 34,
    status: '200',
    ok: 'ok',
  },
  {
    wire: 'graphql',
    method: 'QUERY',
    id: 'user.listUsers',
    duration: '268ms',
    pct: 64,
    status: '200',
    ok: 'ok',
  },
  {
    wire: 'grpc',
    method: 'UNARY',
    id: 'billing.getPlan',
    duration: '1.8s',
    pct: 96,
    status: 'timeout',
    ok: 'fail',
  },
  {
    wire: 'ws',
    method: 'EMIT',
    id: 'chat.sendMessage',
    duration: '18ms',
    pct: 8,
    status: 'ack ok',
    ok: 'ok',
  },
  {
    wire: 'http',
    method: 'POST',
    id: 'user.updateUser',
    duration: '312ms',
    pct: 72,
    status: 'validation',
    ok: 'fail',
  },
  {
    wire: 'graphql',
    method: 'QUERY',
    id: 'search.query',
    duration: '204ms',
    pct: 52,
    status: 'http_4xx',
    ok: 'warn',
  },
  {
    wire: 'ws',
    method: 'ON',
    id: 'chat.messageAdded',
    duration: '6ms',
    pct: 5,
    status: 'network',
    ok: 'fail',
  },
]

const CACHE = [
  {
    key: 'user.getUser({ id: 123 })',
    age: '12s',
    state: 'fresh',
    tone: 'var(--green)',
  },
  {
    key: 'user.listUsers({ page: 1 })',
    age: '1m 40s',
    state: 'stale',
    tone: 'var(--amber)',
  },
  {
    key: 'chat.history({ room: a })',
    age: '4s',
    state: 'fetching',
    tone: 'var(--cyan)',
  },
  {
    key: 'billing.getPlan()',
    age: '6m 02s',
    state: 'invalidated',
    tone: 'var(--muted-foreground)',
  },
]

const LEGEND: Array<{ wire: Transport; name: WireName; count: number }> = [
  { wire: 'http', name: 'HTTP', count: 412 },
  { wire: 'graphql', name: 'GraphQL', count: 168 },
  { wire: 'grpc', name: 'gRPC', count: 96 },
  { wire: 'ws', name: 'WebSocket', count: 214 },
]

const TONE: Record<Transport, string> = {
  http: 'var(--wire-http)',
  graphql: 'var(--wire-graphql)',
  grpc: 'var(--wire-grpc)',
  ws: 'var(--wire-ws)',
}

const BADGE: Record<Transport, string> = {
  http: 'HTTP',
  graphql: 'GQL',
  grpc: 'gRPC',
  ws: 'WS',
}

const STATUS_TONE = {
  ok: 'var(--green)',
  fail: 'var(--red)',
  warn: 'var(--amber)',
} as const

export function DevtoolsPanel() {
  const wireFocus = useDevtools((s) => s.wireFocus)
  const setWireFocus = useDevtools((s) => s.setWireFocus)
  const total = LEGEND.reduce((sum, l) => sum + l.count, 0)

  return (
    <div>
      {/* Legend: hovering a wire dims the rest, everywhere at once. */}
      <div className="mb-3 flex flex-wrap gap-2">
        {LEGEND.map((item) => {
          const active = !wireFocus || wireFocus === item.name
          return (
            <button
              key={item.name}
              type="button"
              onMouseEnter={() => setWireFocus(item.name)}
              onMouseLeave={() => setWireFocus(null)}
              onFocus={() => setWireFocus(item.name)}
              onBlur={() => setWireFocus(null)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 transition-opacity',
                active ? 'opacity-100' : 'opacity-35'
              )}
              style={{
                borderColor:
                  wireFocus === item.name ? TONE[item.wire] : 'var(--hair)',
              }}
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: TONE[item.wire] }}
              />
              <span className="font-mono text-[11px] text-foreground">
                {TRANSPORT_LABEL[item.wire]}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {item.count}
              </span>
              <span className="font-mono text-[10px] text-dim">
                {Math.round((item.count / total) * 100)}%
              </span>
            </button>
          )
        })}
      </div>

      <Tabs defaultValue="timeline">
        <div className="mb-3 flex items-center gap-3">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="cache">Query cache</TabsTrigger>
          </TabsList>
          <span className="ml-auto flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-dim">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-wire-ws"
              style={{
                animation: 'wire-pulse var(--motion-wire) ease-in-out infinite',
              }}
            />
            LIVE · 4 WIRES
          </span>
        </div>

        <div className="code-surface overflow-hidden rounded-xl border border-hair-strong">
          <TabsContent value="timeline" className="m-0">
            <div className="grid grid-cols-[64px_1fr_86px_92px] gap-3 border-b border-hair px-3.5 py-2.5 font-mono text-[10px] tracking-[0.12em] text-dim">
              <span>WIRE</span>
              <span>ENDPOINT</span>
              <span>DURATION</span>
              <span>STATUS</span>
            </div>

            {ROWS.map((row) => {
              const dimmed =
                wireFocus && wireFocus !== TRANSPORT_LABEL[row.wire]
              return (
                <div
                  key={`${row.wire}-${row.id}`}
                  className={cn(
                    'grid grid-cols-[64px_1fr_86px_92px] items-center gap-3 border-b border-hair/60 px-3.5 py-2.5 transition-opacity',
                    dimmed ? 'opacity-25' : 'opacity-100'
                  )}
                >
                  <span
                    className="inline-flex justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.06em]"
                    style={{
                      color: TONE[row.wire],
                      borderColor: `color-mix(in oklab, ${TONE[row.wire]} 40%, transparent)`,
                      background: `color-mix(in oklab, ${TONE[row.wire]} 12%, transparent)`,
                    }}
                  >
                    {BADGE[row.wire]}
                  </span>

                  <span className="truncate font-mono text-[11.5px] text-fg">
                    <span className="text-dim">{row.method}</span> {row.id}
                  </span>

                  <span className="flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-hair-strong">
                      <span
                        className="block h-1 rounded-full"
                        style={{
                          width: `${row.pct}%`,
                          background: TONE[row.wire],
                        }}
                      />
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {row.duration}
                    </span>
                  </span>

                  <span
                    className="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px]"
                    style={{
                      color: STATUS_TONE[row.ok],
                      borderColor: `color-mix(in oklab, ${STATUS_TONE[row.ok]} 40%, transparent)`,
                    }}
                  >
                    {row.status}
                  </span>
                </div>
              )
            })}

            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="font-mono text-[10px] text-dim">TRANSFER</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hair-strong">
                <span
                  className="block h-1.5 w-[64%] rounded-full bg-linear-to-r from-blue-strong to-cyan"
                  style={{
                    animation:
                      'wire-pulse var(--motion-wire) ease-in-out infinite',
                  }}
                />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                1.4 / 2.2 MB
              </span>
            </div>
          </TabsContent>

          <TabsContent value="cache" className="m-0">
            {CACHE.map((entry) => (
              <div
                key={entry.key}
                className="grid grid-cols-[1fr_86px_92px] items-center gap-3 border-b border-hair/60 px-3.5 py-2.5"
              >
                <span className="truncate font-mono text-[11.5px] text-fg">
                  {entry.key}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {entry.age}
                </span>
                <span
                  className="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    color: entry.tone,
                    borderColor: `color-mix(in oklab, ${entry.tone} 40%, transparent)`,
                  }}
                >
                  {entry.state}
                </span>
              </div>
            ))}
            <p className="px-3.5 py-2.5 font-mono text-[10px] text-dim">
              mirrored from query-core · dedup 3 · invalidations 1
            </p>
          </TabsContent>
        </div>
      </Tabs>

      <p className="mt-3 font-mono text-[11px] text-dim">
        overrides: force mock · force error · add latency · swap schema —
        without touching the contract
      </p>
    </div>
  )
}
