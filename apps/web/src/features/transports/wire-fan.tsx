'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Chip } from '@/components/ui/chip'
import type { Transport } from '@/lib/registry'
import { cn } from '@/utils'

/**
 * The hero's money shot: one contract at the top, four consumers below, and a
 * signal travelling each wire.
 *
 * The wires are routed as a bus, not a fan. All four leave the contract as one
 * bundle — four parallel lines, four pixels apart — run straight down the
 * gutter between the two columns, and each peels off sideways into its own
 * card. That is the argument the picture is making: the wires are the same
 * object until the moment they are not.
 *
 * The bundle runs down the *gutter* because that is the only column of empty
 * space that reaches every card. A band above the grid can only touch the top
 * row, which leaves the bottom two cards connected to nothing.
 *
 * Geometry is measured rather than assumed. Card heights depend on how long
 * each snippet wraps, which depends on the viewport, so hard-coding a viewBox
 * puts the wires near the cards at one width and nowhere near them at another.
 * The SVG is laid out in real pixels over the block and re-measured on resize,
 * which also keeps the pulses circular — a normalised viewBox stretched to fit
 * would turn them into ellipses.
 *
 * A highlight cycles between the four. It is not decoration: when a branch is
 * active its pulse, its card's border and that card's badge are the same hue
 * and the other three drop back, which is what makes "one object, four
 * consumers, each on its own wire" legible without a caption.
 */

export interface Consumer {
  name: string
  role: string
  transport: Transport
  snippet: string
}

const COLOR: Record<Transport, string> = {
  http: 'var(--wire-http)',
  graphql: 'var(--wire-graphql)',
  grpc: 'var(--wire-grpc)',
  ws: 'var(--wire-ws)',
}

/** Height of the descent above the cards, in px. */
const BAND = 56
/** Distance between the parallel lines of the bundle, in px. */
const TRUNK_GAP = 4
const CORNER = 7

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Geometry {
  width: number
  height: number
  cards: Box[]
}

/**
 * One wire: down the bundle, out through the gutter, into the side of a card.
 *
 * `lane` staggers the break heights so two wires heading for the same side
 * never share a horizontal run.
 */
function busPath(cx: number, index: number, card: Box, lane: number): string {
  const from = cx + (index - 1.5) * TRUNK_GAP
  // Enter the edge that faces the gutter — the short way in.
  const rightward = card.left > cx
  const targetX = rightward ? card.left : card.left + card.width
  const targetY = card.top + Math.min(card.height / 2, 34 + lane * 8)

  const dir = rightward ? 1 : -1
  const r = Math.min(
    CORNER,
    Math.abs(targetX - from) / 2,
    Math.abs(targetY - BAND) / 2
  )

  if (r <= 1) return `M ${from} 0 V ${targetY} H ${targetX}`

  return [
    `M ${from} 0`,
    `V ${targetY - r}`,
    `Q ${from} ${targetY} ${from + dir * r} ${targetY}`,
    `H ${targetX}`,
  ].join(' ')
}

function useCycle(length: number) {
  // -1 means "no single branch is active" — every one renders lit. That is the
  // reduced-motion state, and also the state before the first tick.
  const [active, setActive] = useState(-1)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches) return

    let i = 0
    setActive(0)
    const timer = setInterval(() => {
      i = (i + 1) % length
      setActive(i)
    }, 2600)
    return () => clearInterval(timer)
  }, [length])

  return active
}

export function WireFan({ consumers }: { consumers: Consumer[] }) {
  const active = useCycle(consumers.length)
  const box = useRef<HTMLDivElement>(null)
  const cards = useRef<Array<HTMLDivElement | null>>([])
  const [geometry, setGeometry] = useState<Geometry | null>(null)

  const measure = useCallback(() => {
    const root = box.current
    if (!root) return
    const measured = cards.current.filter(Boolean).map((card) => ({
      left: card!.offsetLeft,
      top: card!.offsetTop,
      width: card!.offsetWidth,
      height: card!.offsetHeight,
    }))
    if (measured.length === 0) return
    setGeometry({
      width: root.offsetWidth,
      height: root.offsetHeight,
      cards: measured,
    })
  }, [])

  // Layout effect, so the wires are in place on the frame the cards first paint.
  useLayoutEffect(() => {
    measure()
    const root = box.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const card of cards.current) if (card) observer.observe(card)
    return () => observer.disconnect()
  }, [measure])

  // A single column stacks the cards, and the gutter the bundle runs down no
  // longer exists — so the wires are dropped rather than drawn somewhere wrong.
  const single =
    geometry !== null &&
    geometry.cards.every((c) => c.width > geometry.width * 0.9)

  return (
    <div ref={box} className="relative">
      <div aria-hidden style={{ height: BAND }} />

      {geometry && !single && (
        <svg
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={geometry.width}
          height={geometry.height}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          aria-hidden
        >
          {consumers.map((consumer, i) => {
            const card = geometry.cards[i]
            if (!card) return null
            const path = busPath(geometry.width / 2, i, card, Math.floor(i / 2))
            const lit = active === -1 || active === i
            return (
              <g
                key={consumer.name}
                style={{
                  opacity: lit ? 1 : 0.3,
                  transition: 'opacity var(--motion-ui) var(--ease-out)',
                }}
              >
                <path
                  d={path}
                  fill="none"
                  stroke={COLOR[consumer.transport]}
                  strokeWidth={lit ? 2 : 1.3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.8}
                  style={{
                    transition: 'stroke-width var(--motion-ui) var(--ease-out)',
                  }}
                />
                <circle r={2.8} fill={COLOR[consumer.transport]}>
                  <animateMotion
                    dur={`${2.4 + i * 0.3}s`}
                    begin={`${i * 0.12}s`}
                    repeatCount="indefinite"
                    path={path}
                  />
                </circle>
              </g>
            )
          })}
        </svg>
      )}

      {/* gap-x leaves the gutter the bundle runs down. Deliberately not
          positioned: `offsetTop` is measured against the nearest positioned
          ancestor, so a `relative` here would make the grid the origin and
          every card would measure one band-height too high. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-8">
        {consumers.map((consumer, i) => {
          const lit = active === -1 || active === i
          const tone = COLOR[consumer.transport]
          return (
            <div
              key={consumer.name}
              ref={(node) => {
                cards.current[i] = node
              }}
              className={cn(
                'min-w-0 rounded-xl border bg-linear-to-b from-panel to-panel-2 p-4',
                lit ? 'border-hair' : 'border-hair opacity-55'
              )}
              style={{
                borderTopColor: tone,
                borderTopWidth: 2,
                transform:
                  lit && active !== -1 ? 'translateY(-2px)' : undefined,
                boxShadow:
                  lit && active !== -1
                    ? `0 10px 30px -18px ${tone}`
                    : undefined,
                transition:
                  'transform var(--motion-ui) var(--ease-out), opacity var(--motion-ui) var(--ease-out), box-shadow var(--motion-ui) var(--ease-out)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-semibold text-fg">
                  {consumer.name}
                </span>
                <Chip tone={tone}>{consumer.role}</Chip>
              </div>
              {/* A snippet is one long token with no spaces to break at, so it
                  wraps anywhere rather than running past the card edge — and
                  `wrap-anywhere` (not `break-words`) is what also shrinks the
                  card's min-content width, so the grid track stops widening. */}
              <p className="mt-2 font-mono text-[11px] leading-relaxed wrap-anywhere text-muted-foreground">
                {consumer.snippet}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A short horizontal wire, for "this becomes that" pairs. */
export function WireLink({
  color = 'var(--cyan)',
  width = 44,
}: {
  color?: string
  width?: number
}) {
  const path = 'M 2 12 C 16 12 28 12 42 12'
  return (
    <svg
      viewBox="0 0 44 24"
      width={width}
      height={24}
      className="overflow-visible"
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        opacity={0.6}
      />
      <circle cx={42} cy={12} r={2.6} fill={color} />
      <circle r={2.8} fill={color}>
        <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
      </circle>
    </svg>
  )
}
