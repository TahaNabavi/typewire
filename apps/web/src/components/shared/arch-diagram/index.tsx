'use client'

import { useMemo, useState } from 'react'
import { VIEWBOX_WIDTH, VIEWBOX_HEIGHT, W } from './constants'
import { NODES } from './data/nodes'
import { SECTIONS } from './data/sections'
import { NodeKey, EdgeSpec, SplitEdgeSpec } from './types'
import {
  edgeBelongsToSection,
  splitEdgeBelongsToSection,
  getSectionForNode,
  getSectionBounds,
  pathFor,
  splitPathFor,
  getNodePosition,
} from './utils/svg'
import { EDGES, SPLIT_EDGES } from './data/edges'

export function ArchDiagram() {
  const [focus, setFocus] = useState<NodeKey | null>(null)
  const [focusSection, setFocusSection] = useState<string | null>(null)

  const lit = useMemo(() => {
    if (focus === null) return null

    const set = new Set<NodeKey>([focus])

    for (const e of EDGES) {
      if (e.from === focus) set.add(e.to)
      if (e.to === focus) set.add(e.from)
    }

    for (const e of SPLIT_EDGES) {
      if (e.from === focus) {
        e.to.forEach((node) => set.add(node))
      }

      if (e.to.includes(focus)) {
        set.add(e.from)
        e.to.forEach((node) => set.add(node))
      }
    }

    return set
  }, [focus])

  const edgeOn = (e: EdgeSpec) => {
    // Node focus has priority
    if (focus !== null) {
      return e.from === focus || e.to === focus
    }

    // Section focus
    if (focusSection !== null) {
      return edgeBelongsToSection(e, focusSection)
    }

    return true
  }

  const splitEdgeOn = (e: SplitEdgeSpec) => {
    // Node focus has priority
    if (focus !== null) {
      return e.from === focus || e.to.includes(focus)
    }

    // Section focus
    if (focusSection !== null) {
      return splitEdgeBelongsToSection(e, focusSection)
    }

    return true
  }
  const nodeOn = (key: NodeKey) => lit === null || lit.has(key)

  const nodeVisible = (key: NodeKey) => {
    const section = getSectionForNode(key)

    // Node hover has priority
    if (focus !== null) {
      return nodeOn(key)
    }

    // Section hover
    if (focusSection !== null) {
      return section === focusSection
    }

    return true
  }

  return (
    <div className="h-165 overflow-hidden">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="block w-full"
        role="img"
        aria-label="TypeWire package graph"
        onPointerLeave={() => {
          setFocus(null)
          setFocusSection(null)
        }}
      >
        {/* ─────────────────────────────────────────
            SECTIONS
            Rendered first → always behind edges/nodes
        ───────────────────────────────────────── */}

        {SECTIONS.map((section) => {
          const bounds = getSectionBounds(section)
          const style = section.style ?? {}

          const active = focusSection === section.id
          const dimmed = focusSection !== null && !active

          const padding = style.padding ?? 12

          return (
            <g
              key={section.id}
              tabIndex={0}
              role="button"
              aria-label={`${section.title} — highlight section`}
              onPointerEnter={() => {
                setFocus(null)
                setFocusSection(section.id)
              }}
              onFocus={() => {
                setFocus(null)
                setFocusSection(section.id)
              }}
              onBlur={() => setFocusSection(null)}
              className="cursor-pointer transition-all duration-200"
              style={{
                opacity: active
                  ? (style.hoverOpacity ?? 1)
                  : dimmed
                    ? 0.12
                    : (style.opacity ?? 1),
              }}
            >
              {/* Card */}
              <rect
                x={bounds.x}
                y={bounds.y}
                width={bounds.width}
                height={bounds.height}
                rx={style.radius ?? 12}
                fill={
                  active
                    ? (style.hoverBackground ??
                      style.background ??
                      'var(--panel)')
                    : (style.background ?? 'var(--panel)')
                }
                stroke={
                  active
                    ? (style.hoverBorder ??
                      style.border ??
                      'var(--hair-strong)')
                    : (style.border ?? 'var(--hair-strong)')
                }
                strokeWidth={
                  active
                    ? (style.hoverBorderWidth ?? style.borderWidth ?? 1)
                    : (style.borderWidth ?? 1)
                }
                className="transition-all duration-200"
              />

              {/* Title */}
              <text
                x={bounds.x + padding}
                y={bounds.y + padding + (style.titleSize ?? 8)}
                fill={
                  active
                    ? (style.hoverTitleColor ??
                      style.titleColor ??
                      'var(--foreground)')
                    : (style.titleColor ?? 'var(--muted-foreground)')
                }
                fontSize={style.titleSize ?? 8}
                fontWeight={active ? 700 : 600}
                letterSpacing="0.12em"
                className="font-mono transition-all duration-200"
              >
                {section.title}
              </text>

              {/* Description */}
              {section.desc !== null &&
              section.desc !== undefined &&
              section.desc !== '' ? (
                <text
                  x={bounds.x + padding}
                  y={bounds.y + padding + (style.titleSize ?? 8) + 9}
                  fill={
                    active
                      ? (style.hoverDescColor ??
                        style.descColor ??
                        'var(--foreground)')
                      : (style.descColor ?? 'var(--muted-foreground)')
                  }
                  fontSize={style.descSize ?? 6.5}
                  opacity={active ? 0.9 : 0.65}
                  className="font-mono transition-all duration-200"
                >
                  {section.desc}
                </text>
              ) : null}
            </g>
          )
        })}

        {/* ─────────────────────────────────────────
            NORMAL EDGES
        ───────────────────────────────────────── */}

        {EDGES.map((e) => {
          const path = pathFor(e.from, e.to)
          const on = edgeOn(e)

          const base =
            e.dashed !== null && e.dashed !== undefined && e.dashed === true
              ? 0.5
              : 0.75

          const activeOpacity =
            focus !== null || focusSection !== null ? (on ? 1 : 0.08) : base
          return (
            <g
              key={`${e.from}-${e.to}`}
              className="transition-opacity duration-200"
              style={{
                opacity: on ? 1 : 0.08,
              }}
            >
              <path
                d={path}
                fill="none"
                stroke={e.color ?? 'var(--hair-strong)'}
                strokeWidth={
                  focus !== null && on
                    ? (e.width ?? 1.4) + 0.8
                    : (e.width ?? 1.4)
                }
                strokeDasharray={
                  e.dashed !== null &&
                  e.dashed !== undefined &&
                  e.dashed === true
                    ? '4 4'
                    : undefined
                }
                opacity={activeOpacity}
                className="transition-all duration-200"
              />

              {e.pulse !== null && e.pulse !== undefined && e.pulse ? (
                <circle
                  r={(e.width ?? 1.4) > 2 ? 3 : 2.2}
                  fill={e.color ?? 'var(--muted-foreground)'}
                >
                  <animateMotion
                    dur={`${e.dur ?? 3}s`}
                    repeatCount="indefinite"
                    path={path}
                  />
                </circle>
              ) : null}
            </g>
          )
        })}

        {/* ─────────────────────────────────────────
            SPLIT EDGES
        ───────────────────────────────────────── */}

        {SPLIT_EDGES.map((e) => {
          const split = splitPathFor(e.from, e.to)

          const on = splitEdgeOn(e)

          const base =
            e.dashed !== null && e.dashed !== undefined && e.dashed === true
              ? 0.5
              : 0.75

          const activeOpacity =
            focus !== null || focusSection !== null ? (on ? 1 : 0.08) : base

          return (
            <g
              key={`${e.from}-${e.to.join('-')}`}
              className="transition-opacity duration-200"
              style={{
                opacity: on ? 1 : 0.08,
              }}
            >
              {/* Shared trunk */}
              <path
                d={split.trunk}
                fill="none"
                stroke={e.color ?? 'var(--hair-strong)'}
                strokeWidth={
                  focus !== null && on
                    ? (e.width ?? 1.4) + 0.8
                    : (e.width ?? 1.4)
                }
                strokeDasharray={
                  e.dashed !== null &&
                  e.dashed !== undefined &&
                  e.dashed === true
                    ? '4 4'
                    : undefined
                }
                opacity={activeOpacity}
                className="transition-all duration-200"
              />

              {/* Branches */}
              {split.branches.map((branch, index) => (
                <path
                  key={index}
                  d={branch}
                  fill="none"
                  stroke={e.color ?? 'var(--hair-strong)'}
                  strokeWidth={
                    focus !== null && on
                      ? (e.width ?? 1.4) + 0.8
                      : (e.width ?? 1.4)
                  }
                  strokeDasharray={
                    e.dashed !== null &&
                    e.dashed !== undefined &&
                    e.dashed === true
                      ? '4 4'
                      : undefined
                  }
                  opacity={activeOpacity}
                  className="transition-all duration-200"
                />
              ))}

              {/* Junction */}
              <circle
                cx={split.junction.x}
                cy={split.junction.y}
                r={2}
                fill={e.color ?? 'var(--hair-strong)'}
                opacity={focus !== null && on ? 1 : base}
              />

              {/* Animated pulse */}
              {e.pulse !== null && e.pulse !== undefined && e.pulse ? (
                <circle
                  r={(e.width ?? 1.4) > 2 ? 3 : 2.2}
                  fill={e.color ?? 'var(--muted-foreground)'}
                >
                  <animateMotion
                    dur={`${e.dur ?? 3}s`}
                    repeatCount="indefinite"
                    path={split.trunk}
                  />
                </circle>
              ) : null}
            </g>
          )
        })}

        {/* ─────────────────────────────────────────
            NODES
        ───────────────────────────────────────── */}

        {(Object.keys(NODES) as NodeKey[]).map((key) => {
          const node = getNodePosition(key)

          const isContract = key === 'contract'

          const on = nodeVisible(key)
          const isFocus = key === focus

          return (
            <g
              key={key}
              tabIndex={0}
              role="button"
              aria-label={`${node.label} — highlight its links`}
              onPointerEnter={() => {
                const section = getSectionForNode(key)
                setFocusSection(
                  section !== null && section !== undefined ? section : null
                )
                setFocus(key)
              }}
              onFocus={() => {
                const section = getSectionForNode(key)
                setFocusSection(
                  section !== null && section !== undefined ? section : null
                )
                setFocus(key)
              }}
              onBlur={() => {
                setFocus(null)
                setFocusSection(null)
              }}
              className="cursor-pointer transition-opacity duration-200 focus:outline-none"
              style={{
                opacity: on ? 1 : 0.12,
              }}
            >
              {/* Opaque base */}
              <rect
                x={node.x - W / 2}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={node.radius}
                fill="var(--panel)"
              />

              {/* Node */}
              <rect
                x={node.x - W / 2}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={node.radius}
                fill={
                  isFocus
                    ? `color-mix(in oklab, ${node.color} 16%, var(--panel))`
                    : isContract
                      ? 'color-mix(in oklab, var(--cyan) 10%, transparent)'
                      : 'var(--panel)'
                }
                stroke={node.color}
                strokeOpacity={(isFocus || isContract) === true ? 1 : 0.45}
                strokeWidth={isFocus ? 1.8 : 1}
                strokeDasharray={key === 'permission' ? '4 3' : undefined}
                className="transition-all duration-200"
              />

              {/* Label */}
              <text
                x={node.x}
                y={node.y + node.height / 2 + 3.5}
                textAnchor="middle"
                fill={
                  (isFocus || isContract) === true
                    ? node.color
                    : 'var(--foreground)'
                }
                className="font-mono transition-colors duration-200"
                fontSize={9.5}
              >
                {node.label}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] text-dim">
        <span>— solid = consumes</span>
        <span>▬ thick = transport</span>
        <span>·· dotted = optional link</span>

        <span className="ml-auto hidden sm:inline">
          hover a package to isolate its links
        </span>
      </div>
    </div>
  )
}
