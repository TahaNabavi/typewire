import type {
  InspectorEntry,
  InspectorSource,
} from "@tahanabavi/type-devtools-core";
import { type CSSProperties, type ReactNode } from "react";
import { ANIM, IconButton, useChrome } from "./chrome";
import { JsonTree } from "./json-tree";
import { OverrideControls, type OverridesApi } from "./overrides";
import { copyToClipboard, safeStringify } from "./serialize";
import type { Palette } from "./theme";

export function statusColor(palette: Palette, status: InspectorEntry["status"]): string {
  switch (status) {
    case "pending":
      return palette.pending;
    case "success":
      return palette.success;
    case "error":
      return palette.error;
    case "dropped":
      return palette.dropped;
    default:
      return palette.info;
  }
}

export function sourceColor(palette: Palette, source: InspectorSource): string {
  if (source === "http") return palette.http;
  if (source === "ws") return palette.ws;
  return palette.info;
}

export function Timeline({
  visible,
  selected,
  onSelect,
  overrides,
  search,
}: {
  visible: InspectorEntry[];
  selected: InspectorEntry | null;
  onSelect: (key: string | null) => void;
  overrides: OverridesApi;
  search: string;
}) {
  const { styles, palette, motionOk } = useChrome();

  return (
    <div style={styles.body}>
      <ol style={styles.list} data-testid="typewire-rows">
        {visible.length === 0 ? (
          <li style={styles.empty}>No traffic yet.</li>
        ) : (
          visible.map((entry) => (
            <li key={entry.key} style={{ animation: motionOk ? ANIM.rowIn : undefined }}>
              <button
                type="button"
                onClick={() => onSelect(entry.key)}
                style={{
                  ...styles.row,
                  ...(entry.key === selected?.key ? styles.rowActive : null),
                }}
              >
                <span
                  style={{ ...styles.badge, background: sourceColor(palette, entry.source) }}
                >
                  {entry.source}
                </span>
                <span style={styles.label}>{entry.label}</span>
                <span
                  style={{
                    ...styles.statusText,
                    color: statusColor(palette, entry.status),
                    animation:
                      motionOk && entry.status === "pending" ? ANIM.pulse : undefined,
                  }}
                >
                  {entry.status}
                </span>
                <span style={styles.duration}>
                  {entry.durationMs === undefined ? "" : `${entry.durationMs}ms`}
                </span>
              </button>
            </li>
          ))
        )}
      </ol>

      <aside style={styles.detail} data-testid="typewire-detail">
        {selected ? (
          <Detail entry={selected} overrides={overrides} search={search} />
        ) : (
          <p style={styles.empty}>Select a row.</p>
        )}
      </aside>
    </div>
  );
}

function Detail({
  entry,
  overrides,
  search,
}: {
  entry: InspectorEntry;
  overrides: OverridesApi;
  search: string;
}) {
  const { styles, palette } = useChrome();
  const meta = entry.events.find((e) => e.kind === "start" || e.kind === "outbound")?.meta;

  return (
    <>
      <div style={styles.detailHead}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {entry.label}
        </strong>
        <div style={{ display: "flex", gap: 4 }}>
          {entry.source === "http" && (
            <IconButton
              title="Copy as cURL"
              testId="typewire-copy-curl"
              onClick={() => void copyToClipboard(toCurl(entry))}
            >
              cURL
            </IconButton>
          )}
          <IconButton
            title="Copy entry as JSON"
            testId="typewire-copy-entry"
            onClick={() => void copyToClipboard(safeStringify(entryPayload(entry)))}
          >
            ⧉
          </IconButton>
        </div>
      </div>

      <Field label="source" palette={palette}>
        <span style={{ color: sourceColor(palette, entry.source) }}>{entry.source}</span>
      </Field>
      <Field label="status" palette={palette}>
        <span style={{ color: statusColor(palette, entry.status) }}>{entry.status}</span>
        {entry.durationMs !== undefined && (
          <span style={{ color: palette.textFaint }}> · {entry.durationMs}ms</span>
        )}
      </Field>
      {typeof meta?.method === "string" && (
        <Field label="request" palette={palette}>
          <span style={{ color: palette.textMuted }}>
            {String(meta.method)} {String(meta.url ?? "")}
          </span>
        </Field>
      )}

      <JsonField label="input" value={entry.input} search={search} />
      <JsonField label="output" value={entry.output} search={search} />
      <JsonField label="error" value={entry.error} search={search} />

      <OverrideControls source={entry.source} label={entry.label} overrides={overrides} />
    </>
  );
}

function Field({
  label,
  palette,
  children,
}: {
  label: string;
  palette: Palette;
  children: ReactNode;
}) {
  return (
    <p style={fieldStyle}>
      <span
        style={{
          color: palette.textFaint,
          fontSize: 10,
          textTransform: "uppercase",
          marginRight: 8,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      {children}
    </p>
  );
}

function JsonField({
  label,
  value,
  search,
}: {
  label: string;
  value: unknown;
  search: string;
}) {
  const { styles, palette } = useChrome();
  if (value === undefined) return null;
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <div style={styles.inset}>
        <JsonTree value={value} palette={palette} search={search} />
      </div>
    </div>
  );
}

/** The parts of an entry worth copying as one JSON blob. */
function entryPayload(entry: InspectorEntry) {
  return {
    label: entry.label,
    source: entry.source,
    status: entry.status,
    durationMs: entry.durationMs,
    input: entry.input,
    output: entry.output,
    error: entry.error,
  };
}

/** Reconstruct a cURL command from an HTTP entry's start meta and input. */
function toCurl(entry: InspectorEntry): string {
  const start = entry.events.find((e) => e.kind === "start");
  const method = String(start?.meta?.method ?? "GET");
  const url = String(start?.meta?.url ?? entry.label);
  const input = entry.input as { body?: unknown } | undefined;
  const parts = [`curl -X ${method} '${url}'`];
  if (input && "body" in input && input.body !== undefined) {
    parts.push(`-H 'Content-Type: application/json'`);
    parts.push(`-d '${safeStringify(input.body, 0)}'`);
  }
  return parts.join(" \\\n  ");
}

const fieldStyle: CSSProperties = {
  margin: "0 0 6px",
  display: "flex",
  alignItems: "baseline",
};
