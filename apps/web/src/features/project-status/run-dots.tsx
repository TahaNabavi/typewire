import { cn } from '@/utils'

/**
 * Recent CI runs, oldest on the left. Colour carries the conclusion and the
 * title carries it in words, so the field is never colour-only.
 */
export function RunDots({
  runs,
  className,
}: {
  runs: Array<{ conclusion: string | null; url: string; sha: string }>
  className?: string
}) {
  const tone = (conclusion: string | null) => {
    if (conclusion === 'success') return 'var(--green)'
    if (conclusion === 'failure') return 'var(--red)'
    if (conclusion === 'cancelled' || conclusion === 'skipped')
      return 'var(--dim)'
    return 'var(--amber)'
  }

  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {[...runs].reverse().map((run, i) => (
        <li key={`${run.sha}-${i}`}>
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            title={`${run.sha} — ${run.conclusion ?? 'in progress'}`}
            className="block size-2.5 rounded-[3px] transition-transform hover:scale-125"
            style={{ background: tone(run.conclusion) }}
          >
            <span className="sr-only">{`${run.sha}: ${run.conclusion ?? 'in progress'}`}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
