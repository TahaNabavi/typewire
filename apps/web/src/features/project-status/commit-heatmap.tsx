import { cn } from "@/utils";

/**
 * The commit heatmap: one column per week, one cell per day.
 *
 * Intensity is bucketed rather than continuous — five steps read as a scale,
 * a smooth ramp reads as noise. The empty bucket keeps a visible floor so the
 * grid itself stays legible on a quiet repo.
 */
export function CommitHeatmap({
  weeks,
  tone = "var(--green)",
  className,
}: {
  weeks: Array<{ week: number; days: number[] }>;
  tone?: string;
  className?: string;
}) {
  if (weeks.length === 0) return null;

  const peak = Math.max(1, ...weeks.flatMap((w) => w.days));
  const bucket = (count: number) => {
    if (count === 0) return 0;
    return Math.min(4, Math.ceil((count / peak) * 4));
  };
  const fill = (level: number) =>
    level === 0
      ? "var(--hair)"
      : `color-mix(in oklab, ${tone} ${level * 22 + 12}%, transparent)`;

  const cell = 9;
  const gap = 2;

  return (
    <svg
      viewBox={`0 0 ${weeks.length * (cell + gap)} ${7 * (cell + gap)}`}
      role="img"
      aria-label={`Commits per day over the last ${weeks.length} weeks`}
      className={cn("w-full", className)}
    >
      {weeks.map((week, x) =>
        week.days.map((count, y) => (
          <rect
            key={`${week.week}-${y}`}
            x={x * (cell + gap)}
            y={y * (cell + gap)}
            width={cell}
            height={cell}
            rx={2}
            fill={fill(bucket(count))}
          >
            <title>{`${count} commit${count === 1 ? "" : "s"}`}</title>
          </rect>
        )),
      )}
    </svg>
  );
}
