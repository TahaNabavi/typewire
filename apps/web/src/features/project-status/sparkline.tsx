import { cn } from "@/utils";

/**
 * A filled line, drawn from a series that may be all zeroes.
 *
 * Plain SVG with no client JS — a picture of numbers that were already
 * resolved on the server, with no hover state a title attribute cannot carry.
 */
export function Sparkline({
  values,
  tone = "var(--blue)",
  className,
  height = 44,
}: {
  values: number[];
  tone?: string;
  className?: string;
  height?: number;
}) {
  if (values.length < 2) return null;

  const width = 240;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const y = (value: number) => height - 3 - (value / max) * (height - 8);
  const points = values.map((value, i) => `${(i * step).toFixed(1)},${y(value).toFixed(1)}`);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${values.reduce((a, b) => a + b, 0)} commits over the last ${values.length} weeks`}
      className={cn("w-full", className)}
      style={{ height }}
    >
      <polygon
        points={`0,${height} ${points.join(" ")} ${width},${height}`}
        fill={`color-mix(in oklab, ${tone} 18%, transparent)`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={tone}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
