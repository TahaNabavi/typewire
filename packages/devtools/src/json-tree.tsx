import {
  Fragment,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { copyToClipboard, safeStringify } from "./serialize";
import type { Palette } from "./theme";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const INDENT = 12;

export interface JsonTreeProps {
  value: unknown;
  palette: Palette;
  /** Case-insensitive term to highlight; a match also force-expands the tree. */
  search?: string;
  /** Depth expanded on first render. Deeper nodes start collapsed. Default 1. */
  defaultExpandedDepth?: number;
}

/**
 * A collapsible, syntax-colored view of any value. Hand-rolled rather than a
 * dependency, because the panel ships no libraries — it walks the value itself,
 * colors each leaf by type, normalizes exotic values (`Error`, `Map`, `Date`,
 * …), and guards cycles by tracking the ancestor chain.
 */
export function JsonTree({
  value,
  palette,
  search,
  defaultExpandedDepth = 1,
}: JsonTreeProps) {
  const term = search?.trim().toLowerCase() ?? "";
  return (
    <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.5 }}>
      <Node
        label={undefined}
        value={value}
        palette={palette}
        term={term}
        depth={0}
        defaultExpandedDepth={defaultExpandedDepth}
        ancestors={[]}
      />
    </div>
  );
}

interface NodeProps {
  label: string | number | undefined;
  value: unknown;
  palette: Palette;
  term: string;
  depth: number;
  defaultExpandedDepth: number;
  ancestors: object[];
}

function Node(props: NodeProps) {
  const { label, value, palette, term, depth, ancestors } = props;
  const display = normalize(value);

  if (isObjectLike(display) && ancestors.includes(display)) {
    return (
      <Row depth={depth}>
        <KeyLabel label={label} palette={palette} term={term} />
        <span style={{ color: palette.jsonNull }}>[Circular]</span>
      </Row>
    );
  }

  const branch = asBranch(display);
  if (!branch) {
    return (
      <Row depth={depth}>
        <KeyLabel label={label} palette={palette} term={term} />
        <Primitive value={display} palette={palette} term={term} />
      </Row>
    );
  }
  // `asBranch` returned non-null, so `display` is an array or object.
  return <BranchNode {...props} display={display as object} branch={branch} />;
}

interface BranchInfo {
  entries: Array<[string | number, unknown]>;
  bracket: "array" | "object";
}

function BranchNode({
  label,
  palette,
  term,
  depth,
  defaultExpandedDepth,
  ancestors,
  display,
  branch,
}: NodeProps & { display: object; branch: BranchInfo }) {
  const searchActive = term.length > 0;
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);
  const open = searchActive || expanded;

  const [openBracket, closeBracket] =
    branch.bracket === "array" ? ["[", "]"] : ["{", "}"];
  const count = branch.entries.length;
  const childAncestors = [...ancestors, display];

  return (
    <div style={{ paddingLeft: depth * INDENT }}>
      <div style={styles.line}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ ...styles.twisty, color: palette.textFaint, cursor: searchActive ? "default" : "pointer" }}
          aria-label={open ? "collapse" : "expand"}
          disabled={searchActive || count === 0}
        >
          {count === 0 ? "" : open ? "▾" : "▸"}
        </button>
        <KeyLabel label={label} palette={palette} term={term} />
        <span style={{ color: palette.jsonPunct }}>{openBracket}</span>
        {!open && (
          <span style={{ color: palette.textFaint }}>
            {count === 0 ? "" : `…${count}`}
            <span style={{ color: palette.jsonPunct }}>{closeBracket}</span>
          </span>
        )}
        <CopyDot value={display} palette={palette} />
      </div>

      {open && (
        <>
          {branch.entries.map(([childLabel, childValue]) => (
            <Node
              key={childLabel}
              label={childLabel}
              value={childValue}
              palette={palette}
              term={term}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              ancestors={childAncestors}
            />
          ))}
          <div style={{ paddingLeft: (depth + 1) * INDENT }}>
            <span style={{ color: palette.jsonPunct }}>{closeBracket}</span>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div style={{ paddingLeft: depth * INDENT }}>
      <div style={styles.line}>
        <span style={styles.twisty} />
        {children}
      </div>
    </div>
  );
}

function KeyLabel({
  label,
  palette,
  term,
}: {
  label: string | number | undefined;
  palette: Palette;
  term: string;
}) {
  if (label === undefined) return null;
  const isIndex = typeof label === "number";
  return (
    <>
      <span style={{ color: isIndex ? palette.textFaint : palette.jsonKey }}>
        {isIndex ? (
          label
        ) : (
          <Highlighted text={String(label)} term={term} palette={palette} />
        )}
      </span>
      <span style={{ color: palette.jsonPunct }}>: </span>
    </>
  );
}

function Primitive({
  value,
  palette,
  term,
}: {
  value: unknown;
  palette: Palette;
  term: string;
}) {
  if (value === null) return <span style={{ color: palette.jsonNull }}>null</span>;
  if (value === undefined)
    return <span style={{ color: palette.jsonNull }}>undefined</span>;

  switch (typeof value) {
    case "string":
      return (
        <span style={{ color: palette.jsonString }}>
          "<Highlighted text={value} term={term} palette={palette} />"
        </span>
      );
    case "number":
      return (
        <span style={{ color: palette.jsonNumber }}>
          <Highlighted text={String(value)} term={term} palette={palette} />
        </span>
      );
    case "boolean":
      return <span style={{ color: palette.jsonBoolean }}>{String(value)}</span>;
    default:
      return <span style={{ color: palette.text }}>{String(value)}</span>;
  }
}

/** Wrap every case-insensitive occurrence of `term` in a highlight mark. */
function Highlighted({
  text,
  term,
  palette,
}: {
  text: string;
  term: string;
  palette: Palette;
}) {
  if (!term) return <>{text}</>;
  const lower = text.toLowerCase();
  let index = lower.indexOf(term);
  if (index === -1) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let piece = 0;
  while (index !== -1) {
    if (index > cursor) {
      parts.push(<Fragment key={piece++}>{text.slice(cursor, index)}</Fragment>);
    }
    parts.push(
      <mark
        key={piece++}
        style={{ background: palette.highlightBg, color: palette.highlightText }}
      >
        {text.slice(index, index + term.length)}
      </mark>,
    );
    cursor = index + term.length;
    index = lower.indexOf(term, cursor);
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={piece++}>{text.slice(cursor)}</Fragment>);
  }
  return <>{parts}</>;
}

/** A tiny per-node copy affordance. Always visible — inline styles can't hover. */
function CopyDot({ value, palette }: { value: unknown; palette: Palette }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy this value"
      onClick={(e) => {
        e.stopPropagation();
        void copyToClipboard(safeStringify(value)).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        });
      }}
      style={{
        ...styles.copyDot,
        color: copied ? palette.success : palette.textFaint,
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

/**
 * Reduce exotic values to a plain shape the walker understands. Plain objects
 * and arrays pass through by identity, so the cycle guard still works.
 */
function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") {
    return `ƒ ${(value as { name?: string }).name || "anonymous"}()`;
  }
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

function asBranch(value: unknown): BranchInfo | null {
  if (Array.isArray(value)) {
    return {
      bracket: "array",
      entries: value.map((v, i) => [i, v] as [number, unknown]),
    };
  }
  if (isObjectLike(value)) {
    return {
      bracket: "object",
      entries: Object.entries(value as Record<string, unknown>),
    };
  }
  return null;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

const styles = {
  line: { display: "flex", alignItems: "center", whiteSpace: "nowrap" },
  twisty: {
    display: "inline-block",
    width: 14,
    minWidth: 14,
    padding: 0,
    border: "none",
    background: "transparent",
    font: "inherit",
    textAlign: "left",
  },
  copyDot: {
    marginLeft: 6,
    padding: "0 2px",
    border: "none",
    background: "transparent",
    font: "inherit",
    fontSize: 10,
    cursor: "pointer",
    opacity: 0.7,
  },
} satisfies Record<string, CSSProperties>;
