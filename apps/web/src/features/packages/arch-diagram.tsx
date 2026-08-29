"use client";

import { useMemo, useState } from "react";

/**
 * How the monorepo fits together.
 *
 * Edge weight carries meaning, and the legend says so: a thin edge consumes the
 * contract, a thick one *is* a transport merging into typefetch, a dotted one is
 * the optional permission link.
 *
 * Hovering a package answers the question the diagram is really asked — "what
 * does this one touch?" — by dropping everything unrelated to a whisper and
 * lifting that package's own wires and neighbours. A static graph of eleven
 * nodes and thirteen edges is a thicket; one hover turns it into a sentence.
 */

type NodeKey =
  | "contract"
  | "typefetch"
  | "typesocket"
  | "nestjs"
  | "cli"
  | "grpc"
  | "graphql"
  | "querycore"
  | "react"
  | "devtools"
  | "permission";

const NODES: Record<NodeKey, { x: number; y: number; label: string; color: string }> = {
  contract: { x: 430, y: 18, label: "contracts.ts", color: "var(--cyan)" },
  cli: { x: 92, y: 40, label: "typewire-cli", color: "var(--amber)" },
  nestjs: { x: 700, y: 40, label: "typewire-nestjs", color: "var(--wire-ws)" },
  grpc: { x: 92, y: 118, label: "typefetch-grpc", color: "var(--wire-grpc)" },
  typefetch: { x: 300, y: 118, label: "typefetch", color: "var(--wire-http)" },
  typesocket: { x: 545, y: 118, label: "typesocket", color: "var(--wire-ws)" },
  graphql: { x: 92, y: 178, label: "typefetch-graphql", color: "var(--wire-graphql)" },
  permission: { x: 780, y: 178, label: "type-permission", color: "var(--cyan)" },
  querycore: { x: 300, y: 218, label: "query-core", color: "var(--purple)" },
  devtools: { x: 610, y: 218, label: "type-devtools", color: "var(--purple)" },
  react: { x: 300, y: 278, label: "typefetch-react", color: "var(--purple)" },
};

const W = 104;
const H = 30;

interface EdgeSpec {
  from: NodeKey;
  to: NodeKey;
  color?: string;
  width?: number;
  dashed?: boolean;
  pulse?: boolean;
  dur?: number;
}

const EDGES: EdgeSpec[] = [
  // thin — consumes the contract
  { from: "contract", to: "typefetch", color: "var(--wire-http)", pulse: true, dur: 2.8 },
  { from: "contract", to: "typesocket", color: "var(--wire-ws)", pulse: true, dur: 3.2 },
  { from: "contract", to: "nestjs", color: "var(--wire-ws)" },
  { from: "contract", to: "cli", color: "var(--amber)" },

  // thick — a transport merging into the client
  { from: "grpc", to: "typefetch", color: "var(--wire-grpc)", width: 3, pulse: true, dur: 2.4 },
  { from: "graphql", to: "typefetch", color: "var(--wire-graphql)", width: 3, pulse: true, dur: 2.6 },

  // downstream
  { from: "typefetch", to: "querycore", color: "var(--purple)" },
  { from: "querycore", to: "react", color: "var(--purple)" },
  { from: "typefetch", to: "devtools", color: "var(--purple)" },
  { from: "typesocket", to: "devtools", color: "var(--purple)" },

  // dotted — the optional contract link
  { from: "permission", to: "typefetch", dashed: true },
  { from: "permission", to: "typesocket", dashed: true },
  { from: "permission", to: "nestjs", dashed: true },
];

/**
 * Attach to the edge of each box, not its centre. Running the curve from centre
 * to centre draws it straight through both labels — the contract node ends up
 * with four wires crossing its own name.
 */
function pathFor(from: NodeKey, to: NodeKey): string {
  const a = NODES[from];
  const b = NODES[to];
  const dx = b.x - a.x;

  if (Math.abs(dx) < W) {
    // Stacked boxes: leave the bottom of the upper one, enter the top of the lower.
    const down = b.y > a.y;
    const y1 = down ? a.y + H : a.y;
    const y2 = down ? b.y : b.y + H;
    const midY = (y1 + y2) / 2;
    return `M ${a.x} ${y1} C ${a.x} ${midY} ${b.x} ${midY} ${b.x} ${y2}`;
  }

  const right = dx > 0;
  const x1 = a.x + (right ? W / 2 : -W / 2);
  const x2 = b.x + (right ? -W / 2 : W / 2);
  const y1 = a.y + H / 2;
  const y2 = b.y + H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

export function ArchDiagram() {
  const [focus, setFocus] = useState<NodeKey | null>(null);

  /** Everything one hop from the focused node, plus the node itself. */
  const lit = useMemo(() => {
    if (!focus) return null;
    const set = new Set<NodeKey>([focus]);
    for (const e of EDGES) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [focus]);

  const edgeOn = (e: EdgeSpec) => !focus || e.from === focus || e.to === focus;
  const nodeOn = (key: NodeKey) => !lit || lit.has(key);

  return (
    <div>
      <svg
        viewBox="0 0 880 320"
        className="block w-full"
        role="img"
        aria-label="TypeWire package graph"
        onPointerLeave={() => setFocus(null)}
      >
        {EDGES.map((e) => {
          const path = pathFor(e.from, e.to);
          const on = edgeOn(e);
          const base = e.dashed ? 0.5 : 0.75;
          return (
            <g
              key={`${e.from}-${e.to}`}
              className="transition-opacity duration-200"
              style={{ opacity: on ? 1 : 0.08 }}
            >
              <path
                d={path}
                fill="none"
                stroke={e.color ?? "var(--hair-strong)"}
                strokeWidth={focus && on ? (e.width ?? 1.4) + 0.8 : (e.width ?? 1.4)}
                strokeDasharray={e.dashed ? "4 4" : undefined}
                // A lit edge goes to full strength; the resting state is
                // deliberately below it so hovering has somewhere to go.
                opacity={focus && on ? 1 : base}
                className="transition-all duration-200"
              />
              {e.pulse && (
                <circle r={(e.width ?? 1.4) > 2 ? 3 : 2.2} fill={e.color ?? "var(--muted-foreground)"}>
                  <animateMotion dur={`${e.dur ?? 3}s`} repeatCount="indefinite" path={path} />
                </circle>
              )}
            </g>
          );
        })}

        {(Object.keys(NODES) as NodeKey[]).map((key) => {
          const node = NODES[key];
          const isContract = key === "contract";
          const on = nodeOn(key);
          const isFocus = key === focus;

          return (
            <g
              key={key}
              tabIndex={0}
              role="button"
              aria-label={`${node.label} — highlight its links`}
              onPointerEnter={() => setFocus(key)}
              onFocus={() => setFocus(key)}
              onBlur={() => setFocus(null)}
              className="cursor-pointer transition-opacity duration-200 focus:outline-none"
              style={{ opacity: on ? 1 : 0.2 }}
            >
              {/* An opaque base under the tint: the contract node's fill is
                  mostly transparent, and without this the wires behind it
                  show through its own label. */}
              <rect x={node.x - W / 2} y={node.y} width={W} height={H} rx={8} fill="var(--panel)" />
              <rect
                x={node.x - W / 2}
                y={node.y}
                width={W}
                height={H}
                rx={8}
                fill={
                  isFocus
                    ? `color-mix(in oklab, ${node.color} 16%, var(--panel))`
                    : isContract
                      ? "color-mix(in oklab, var(--cyan) 10%, transparent)"
                      : "var(--panel)"
                }
                stroke={node.color}
                strokeOpacity={isFocus || isContract ? 1 : 0.45}
                strokeWidth={isFocus ? 1.8 : 1}
                strokeDasharray={key === "permission" ? "4 3" : undefined}
                className="transition-all duration-200"
              />
              <text
                x={node.x}
                y={node.y + 19}
                textAnchor="middle"
                fill={isFocus || isContract ? node.color : "var(--foreground)"}
                className="font-mono transition-colors duration-200"
                fontSize={9.5}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10.5px] tracking-[0.06em] text-dim">
        <span>— solid = consumes</span>
        <span>▬ thick = transport</span>
        <span>·· dotted = optional link</span>
        <span className="ml-auto hidden sm:inline">hover a package to isolate its links</span>
      </div>
    </div>
  );
}
