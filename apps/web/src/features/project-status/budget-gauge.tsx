/**
 * A size budget as a bar rather than a number.
 *
 * `used` is deliberately optional: CI asserts the ceiling but the site has no
 * measurement to show yet, so the bar renders as an unfilled track with the
 * ceiling marked. That is the honest picture — inventing a fill would imply a
 * measurement that does not exist.
 */
export function BudgetGauge({
  label,
  ceiling,
  used,
  tone = 'var(--cyan)',
}: {
  label: string
  /** Bytes. */
  ceiling: number
  /** Bytes, when a measurement exists. */
  used?: number | null
  tone?: string
}) {
  const pct = used == null ? null : Math.min(100, (used / ceiling) * 100)
  const over = pct !== null && pct > 100

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 text-dim">
          {used == null
            ? `≤ ${(ceiling / 1024).toFixed(0)} kB`
            : `${(used / 1024).toFixed(1)} / ${(ceiling / 1024).toFixed(0)} kB`}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hair"
        role="img"
        aria-label={
          used == null
            ? `${label}: ceiling ${(ceiling / 1024).toFixed(0)} kilobytes, no measurement published`
            : `${label}: ${(used / 1024).toFixed(1)} of ${(ceiling / 1024).toFixed(0)} kilobytes`
        }
      >
        {pct === null ? (
          /* No measurement — a dashed track, not a filled bar. */
          <div
            className="h-full w-full opacity-40"
            style={{
              backgroundImage: `repeating-linear-gradient(90deg, ${tone} 0 3px, transparent 3px 8px)`,
            }}
          />
        ) : (
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, pct)}%`,
              background: over ? 'var(--red)' : tone,
            }}
          />
        )}
      </div>
    </li>
  )
}
