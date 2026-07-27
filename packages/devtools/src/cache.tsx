import type {
  QueryInspector,
  QuerySnapshot,
  QueryStateLike,
} from "@tahanabavi/type-devtools-core";
import { useMemo, useState } from "react";
import { ANIM, Chip, IconButton, useChrome } from "./chrome";
import { JsonTree } from "./json-tree";
import { safeStringifyInline } from "./serialize";
import type { Palette } from "./theme";
import { useQueryInspector } from "./use-inspector";

/** Collapse the two orthogonal status fields into one badge label + color. */
function cacheStatus(
  palette: Palette,
  state: QueryStateLike,
): { text: string; color: string } {
  if (state.fetchStatus === "fetching") return { text: "fetching", color: palette.http };
  if (state.status === "error") return { text: "error", color: palette.error };
  if (state.isInvalidated) return { text: "stale", color: palette.dropped };
  if (state.status === "pending") return { text: "pending", color: palette.pending };
  return { text: "fresh", color: palette.success };
}

export function Cache({
  inspector,
  search,
}: {
  inspector: QueryInspector;
  search: string;
}) {
  const { styles, palette, motionOk } = useChrome();
  const snapshot = useQueryInspector(inspector);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const term = search.trim().toLowerCase();
  const queries = useMemo(() => {
    if (!term) return snapshot.queries;
    return snapshot.queries.filter(
      (q) =>
        q.endpointId.toLowerCase().includes(term) ||
        safeStringifyInline(q.input).toLowerCase().includes(term),
    );
  }, [snapshot.queries, term]);

  const selected =
    snapshot.queries.find((q) => q.key === selectedKey) ?? null;

  return (
    <div style={styles.body}>
      <div style={{ ...styles.list, display: "flex", flexDirection: "column" }}>
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }} data-testid="typewire-cache-rows">
          {queries.length === 0 ? (
            <li style={styles.empty}>No cached queries.</li>
          ) : (
            queries.map((query) => {
              const badge = cacheStatus(palette, query.state);
              return (
                <li key={query.key} style={{ animation: motionOk ? ANIM.rowIn : undefined }}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(query.key)}
                    style={{
                      ...styles.row,
                      ...(query.key === selectedKey ? styles.rowActive : null),
                    }}
                  >
                    <span style={styles.label}>
                      <span style={{ color: palette.query }}>{query.endpointId}</span>{" "}
                      <span style={{ color: palette.textFaint }}>
                        {inputSummary(query.input)}
                      </span>
                    </span>
                    <span style={{ ...styles.statusText, color: badge.color }}>
                      {badge.text}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ol>

        {snapshot.mutations.length > 0 && (
          <div style={{ borderTop: `1px solid ${palette.borderSubtle}` }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "5px 10px",
              }}
            >
              <span style={{ ...styles.setHint, textTransform: "uppercase" }}>
                recent mutations
              </span>
              <button
                type="button"
                onClick={() => inspector.clearMutations()}
                style={{
                  border: "none",
                  background: "transparent",
                  color: palette.textFaint,
                  cursor: "pointer",
                  font: "inherit",
                  fontSize: 10,
                }}
              >
                clear
              </button>
            </div>
            <ol
              style={{ margin: 0, padding: 0, listStyle: "none" }}
              data-testid="typewire-mutations"
            >
              {snapshot.mutations
                .slice()
                .reverse()
                .map((mutation) => (
                  <li
                    key={mutation.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "4px 10px",
                      color: palette.textMuted,
                    }}
                  >
                    <span style={{ color: palette.query, flex: 1 }}>
                      {mutation.endpointId}
                    </span>
                    <span
                      style={{
                        ...styles.statusText,
                        color:
                          mutation.status === "error"
                            ? palette.error
                            : mutation.status === "success"
                              ? palette.success
                              : palette.pending,
                      }}
                    >
                      {mutation.status}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        )}
      </div>

      <aside style={styles.detail} data-testid="typewire-cache-detail">
        {selected ? (
          <QueryDetail
            query={selected}
            inspector={inspector}
            search={search}
            onRemoved={() => setSelectedKey(null)}
          />
        ) : (
          <p style={styles.empty}>Select a query.</p>
        )}
      </aside>
    </div>
  );
}

function QueryDetail({
  query,
  inspector,
  search,
  onRemoved,
}: {
  query: QuerySnapshot;
  inspector: QueryInspector;
  search: string;
  onRemoved: () => void;
}) {
  const { styles, palette } = useChrome();
  const { state } = query;
  const target = { endpointId: query.endpointId, input: query.input };

  return (
    <>
      <div style={styles.detailHead}>
        <strong style={{ color: palette.query, overflow: "hidden", textOverflow: "ellipsis" }}>
          {query.endpointId}
        </strong>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        <Chip testId="typewire-query-refetch" onClick={() => inspector.refetch(target)}>
          refetch
        </Chip>
        <Chip testId="typewire-query-invalidate" onClick={() => inspector.invalidate(target)}>
          invalidate
        </Chip>
        <Chip
          danger
          testId="typewire-query-remove"
          onClick={() => {
            inspector.remove(target);
            onRemoved();
          }}
        >
          remove
        </Chip>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "2px 10px",
          marginBottom: 10,
          fontSize: 11,
        }}
      >
        <Meta label="status" palette={palette} value={state.status} />
        <Meta label="fetch" palette={palette} value={state.fetchStatus} />
        <Meta
          label="invalidated"
          palette={palette}
          value={state.isInvalidated ? "yes" : "no"}
        />
        <Meta label="failures" palette={palette} value={String(state.failureCount)} />
        <Meta label="updated" palette={palette} value={formatAgo(state.dataUpdatedAt)} />
      </div>

      <JsonField label="input" value={query.input} search={search} />
      {state.data !== undefined && (
        <JsonField label="data" value={state.data} search={search} />
      )}
      {state.error !== undefined && (
        <JsonField label="error" value={state.error} search={search} />
      )}
    </>
  );
}

function Meta({
  label,
  value,
  palette,
}: {
  label: string;
  value: string;
  palette: Palette;
}) {
  return (
    <>
      <span style={{ color: palette.textFaint }}>{label}</span>
      <span style={{ color: palette.text }}>{value}</span>
    </>
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
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <div style={styles.inset}>
        <JsonTree value={value} palette={palette} search={search} />
      </div>
    </div>
  );
}

/** A one-line input hint for the list row, e.g. `{"id":"1"}`. */
function inputSummary(input: unknown): string {
  const text = safeStringifyInline(input);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** Coarse relative time. `0` means the value was never written. */
function formatAgo(ts: number): string {
  if (!ts) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
