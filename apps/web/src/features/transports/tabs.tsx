'use client'

import type { ReactNode } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTransport, type TransportTab } from '@/features/transports/store'
import type { Transport } from '@/lib/registry'

/**
 * The tab strip is the only interactive part of the transports section, so it
 * is the only part that ships as a client component. The contract panel is
 * rendered on the server and handed in as `contract` — it never changes, and
 * pushing it through the client boundary would mean shipping the highlighter's
 * output as a prop for no reason.
 */

export interface Wire {
  tab: TransportTab
  transport: Transport
  via: string
  note: string
  /** Pre-highlighted on the server. */
  html: string
}

const TONE: Record<Transport, string> = {
  http: 'var(--wire-http)',
  graphql: 'var(--wire-graphql)',
  grpc: 'var(--wire-grpc)',
  ws: 'var(--wire-ws)',
}

export function TransportTabs({
  wires,
  contract,
}: {
  wires: Wire[]
  contract: ReactNode
}) {
  const transport = useTransport((s) => s.transport)
  const setTransport = useTransport((s) => s.setTransport)

  return (
    <Tabs
      value={transport}
      onValueChange={(value) => setTransport(value as TransportTab)}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TabsList>
          {wires.map((wire) => (
            <TabsTrigger key={wire.tab} value={wire.tab}>
              <span
                aria-hidden
                className="mr-2 inline-block size-1.5 rounded-full align-middle"
                style={{ background: TONE[wire.transport] }}
              />
              {wire.tab}
            </TabsTrigger>
          ))}
        </TabsList>
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.1em] text-dim">
          CONTRACT UNCHANGED
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        {contract}

        {wires.map((wire) => (
          <TabsContent key={wire.tab} value={wire.tab} className="m-0 min-w-0">
            <div
              className="code-surface h-full min-w-0 overflow-hidden rounded-xl border"
              style={{
                borderColor: `color-mix(in oklab, ${TONE[wire.transport]} 30%, transparent)`,
              }}
            >
              <div
                className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
                style={{
                  borderColor: `color-mix(in oklab, ${TONE[wire.transport]} 22%, transparent)`,
                }}
              >
                <span
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10.5px] tracking-[0.08em]"
                  style={{
                    color: TONE[wire.transport],
                    borderColor: `color-mix(in oklab, ${TONE[wire.transport]} 45%, transparent)`,
                    background: `color-mix(in oklab, ${TONE[wire.transport]} 12%, transparent)`,
                  }}
                >
                  {wire.tab.toUpperCase()}
                </span>
                <span className="font-mono text-[11px] text-dim">
                  via {wire.via}
                </span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">
                <code dangerouslySetInnerHTML={{ __html: wire.html }} />
              </pre>
              <p className="border-t border-hair px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                {wire.note}
              </p>
            </div>
          </TabsContent>
        ))}
      </div>
    </Tabs>
  )
}
