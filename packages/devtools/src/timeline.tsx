import type {
  InspectorEntry,
  InspectorProgress,
} from '@tahanabavi/type-devtools-core'
import { type CSSProperties, type ReactNode } from 'react'
import { ANIM, IconButton, useChrome } from './chrome'
import { JsonTree } from './json-tree'
import { OverrideControls, type OverridesApi } from './overrides'
import { copyToClipboard, safeStringify } from './serialize'
import type { Palette } from './theme'

export function statusColor(
  palette: Palette,
  status: InspectorEntry['status']
): string {
  switch (status) {
    case 'pending':
      return palette.pending
    case 'success':
      return palette.success
    case 'error':
      return palette.error
    case 'dropped':
      return palette.dropped
    default:
      return palette.info
  }
}

/**
 * The wire a row travelled on, which is what the badge shows.
 *
 * Falls back to `source` for a client that reports no transport: typesocket has
 * exactly one wire, and a typefetch older than the transport registry only ever
 * had one either. So the fallback is never a guess.
 */
export function transportOf(entry: InspectorEntry): string {
  return entry.transport ?? entry.source
}

export function transportColor(palette: Palette, transport: string): string {
  switch (transport) {
    case 'http':
      return palette.http
    case 'ws':
      return palette.ws
    case 'graphql':
      return palette.graphql
    case 'grpc':
      return palette.grpc
    default:
      // A third-party adapter. It gets a badge and a neutral colour rather than
      // no badge — the registry is open, so this is a supported case, not a bug.
      return palette.info
  }
}

export function Timeline({
  visible,
  selected,
  onSelect,
  overrides,
  search,
}: {
  visible: InspectorEntry[]
  selected: InspectorEntry | null
  onSelect: (key: string | null) => void
  overrides: OverridesApi
  search: string
}) {
  const { styles, palette, motionOk } = useChrome()

  return (
    <div style={styles.body}>
      <ol style={styles.list} data-testid="typewire-rows">
        {visible.length === 0 ? (
          <li style={styles.empty}>No traffic yet.</li>
        ) : (
          visible.map((entry) => (
            <li
              key={entry.key}
              style={{ animation: motionOk ? ANIM.rowIn : undefined }}
            >
              <button
                type="button"
                onClick={() => onSelect(entry.key)}
                style={{
                  ...styles.row,
                  ...(entry.key === selected?.key ? styles.rowActive : null),
                }}
              >
                <span
                  style={{
                    ...styles.badge,
                    background: transportColor(palette, transportOf(entry)),
                  }}
                >
                  {transportOf(entry)}
                </span>
                <span style={styles.label}>{entry.label}</span>
                {entry.errorKind && (
                  <span
                    data-testid="typewire-row-kind"
                    style={{ ...styles.kindTag, color: palette.error }}
                  >
                    {entry.errorKind}
                  </span>
                )}
                <span
                  style={{
                    ...styles.statusText,
                    color: statusColor(palette, entry.status),
                    animation:
                      motionOk && entry.status === 'pending'
                        ? ANIM.pulse
                        : undefined,
                  }}
                >
                  {entry.status}
                </span>
                <span style={styles.duration}>
                  {entry.durationMs === undefined
                    ? ''
                    : `${entry.durationMs}ms`}
                </span>
              </button>
              {entry.progress && (
                <ProgressBar progress={entry.progress} motionOk={motionOk} />
              )}
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
  )
}

function Detail({
  entry,
  overrides,
  search,
}: {
  entry: InspectorEntry
  overrides: OverridesApi
  search: string
}) {
  const { styles, palette } = useChrome()
  const meta = entry.events.find(
    (e) => e.kind === 'start' || e.kind === 'outbound'
  )?.meta
  // The HTTP status lives on the *error* event, not the opening one. Only
  // meaningful for wires that have one — gRPC and GraphQL report none, which is
  // the whole reason `errorKind` exists.
  const status = entry.events.find((e) => e.kind === 'error')?.meta?.status

  return (
    <>
      <div style={styles.detailHead}>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {entry.label}
        </strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {/*
            Offered for REST only. The button reconstructs a command from the
            start event's method and URL, and on GraphQL that is `query` against
            the root field — `curl -X query` is not a command anyone can run.
            Reconstructing the real POST would mean rebuilding the document and
            the envelope here, which is the adapter's job, not the panel's.
          */}
          {transportOf(entry) === 'http' && (
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
            onClick={() =>
              void copyToClipboard(safeStringify(entryPayload(entry)))
            }
          >
            ⧉
          </IconButton>
        </div>
      </div>

      <Field label="transport" palette={palette}>
        <span style={{ color: transportColor(palette, transportOf(entry)) }}>
          {transportOf(entry)}
        </span>
      </Field>
      <Field label="status" palette={palette}>
        <span style={{ color: statusColor(palette, entry.status) }}>
          {entry.status}
        </span>
        {entry.durationMs !== undefined && (
          <span style={{ color: palette.textFaint }}>
            {' '}
            · {entry.durationMs}ms
          </span>
        )}
      </Field>
      {entry.errorKind && (
        <Field label="kind" palette={palette}>
          <span
            data-testid="typewire-detail-kind"
            style={{ color: palette.error }}
          >
            {entry.errorKind}
          </span>
          {typeof status === 'number' && (
            <span style={{ color: palette.textFaint }}> · {status}</span>
          )}
        </Field>
      )}
      {typeof meta?.method === 'string' && (
        <Field label="request" palette={palette}>
          <span style={{ color: palette.textMuted }}>
            {String(meta.method)} {String(meta.url ?? '')}
          </span>
        </Field>
      )}
      {entry.progress && (
        <Field label="transfer" palette={palette}>
          <span style={{ color: palette.textMuted }}>
            {describeProgress(entry.progress)}
          </span>
        </Field>
      )}

      <JsonField label="input" value={entry.input} search={search} />
      <JsonField label="output" value={entry.output} search={search} />
      <JsonField label="error" value={entry.error} search={search} />

      <OverrideControls
        source={entry.source}
        label={entry.label}
        overrides={overrides}
      />
    </>
  )
}

/**
 * A live transfer, drawn under its row.
 *
 * `lengthComputable: false` is common — a chunked download reports bytes with no
 * total — so that case gets a moving indeterminate bar rather than a bar stuck
 * at zero, which would read as a stall.
 */
function ProgressBar({
  progress,
  motionOk,
}: {
  progress: InspectorProgress
  motionOk: boolean
}) {
  const { palette } = useChrome()
  const known = progress.percent !== undefined
  const color = progress.phase === 'upload' ? palette.accent : palette.success

  return (
    <div
      data-testid="typewire-progress"
      data-phase={progress.phase}
      role="progressbar"
      aria-valuenow={known ? Math.round(progress.percent as number) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${progress.phase} progress`}
      style={{ ...progressTrack, background: palette.bgInset }}
    >
      <div
        style={{
          ...progressFill,
          background: color,
          width: known
            ? `${clampPercent(progress.percent as number)}%`
            : '100%',
          opacity: known ? 1 : 0.4,
          animation: !known && motionOk ? ANIM.pulse : undefined,
        }}
      />
    </div>
  )
}

/** `↑ 62% · 1.2 MB / 2.0 MB`, degrading to just the byte count when unknown. */
function describeProgress(progress: InspectorProgress): string {
  const arrow = progress.phase === 'upload' ? '↑' : '↓'
  const loaded = formatBytes(progress.loaded)
  if (progress.percent === undefined || progress.total === undefined) {
    return `${arrow} ${loaded}`
  }
  return `${arrow} ${Math.round(progress.percent)}% · ${loaded} / ${formatBytes(progress.total)}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** A server may report `loaded > total`; the bar must not overflow its track. */
function clampPercent(percent: number): number {
  return Math.min(100, Math.max(0, percent))
}

function Field({
  label,
  palette,
  children,
}: {
  label: string
  palette: Palette
  children: ReactNode
}) {
  return (
    <p style={fieldStyle}>
      <span
        style={{
          color: palette.textFaint,
          fontSize: 10,
          textTransform: 'uppercase',
          marginRight: 8,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      {children}
    </p>
  )
}

function JsonField({
  label,
  value,
  search,
}: {
  label: string
  value: unknown
  search: string
}) {
  const { styles, palette } = useChrome()
  if (value === undefined) return null
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <div style={styles.inset}>
        <JsonTree value={value} palette={palette} search={search} />
      </div>
    </div>
  )
}

/** The parts of an entry worth copying as one JSON blob. */
function entryPayload(entry: InspectorEntry) {
  return {
    label: entry.label,
    source: entry.source,
    transport: transportOf(entry),
    status: entry.status,
    errorKind: entry.errorKind,
    durationMs: entry.durationMs,
    input: entry.input,
    output: entry.output,
    error: entry.error,
  }
}

/** Reconstruct a cURL command from an HTTP entry's start meta and input. */
function toCurl(entry: InspectorEntry): string {
  const start = entry.events.find((e) => e.kind === 'start')
  const method = String(start?.meta?.method ?? 'GET')
  const url = String(start?.meta?.url ?? entry.label)
  const input = entry.input as { body?: unknown } | undefined
  const parts = [`curl -X ${method} '${url}'`]
  if (input && 'body' in input && input.body !== undefined) {
    parts.push(`-H 'Content-Type: application/json'`)
    parts.push(`-d '${safeStringify(input.body, 0)}'`)
  }
  return parts.join(' \\\n  ')
}

const fieldStyle: CSSProperties = {
  margin: '0 0 6px',
  display: 'flex',
  alignItems: 'baseline',
}

const progressTrack: CSSProperties = {
  height: 2,
  width: '100%',
  // Pulled up over the row's bottom border so the bar reads as part of the row
  // rather than as a separator between two of them.
  marginTop: -1,
  overflow: 'hidden',
}

const progressFill: CSSProperties = {
  height: '100%',
  transition: 'width 120ms linear',
}
