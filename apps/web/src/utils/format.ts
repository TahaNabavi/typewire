/** 21500 -> "21.5 KB" — the size-budget figures are gzipped ceilings. */
export function gzipSize(bytes: number): string {
  const kb = bytes / 1000;
  return `${kb >= 10 ? kb.toFixed(1) : kb.toFixed(2)} KB`;
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function relativeTime(iso: string | Date | null): string {
  if (!iso) return "—";
  const then = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((then - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit) return rtf.format(Math.round(seconds / secondsInUnit), unit);
  }
  return rtf.format(seconds, "second");
}
