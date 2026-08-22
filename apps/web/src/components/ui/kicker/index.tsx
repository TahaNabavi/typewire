import type { ReactNode } from "react";

/** Mono, uppercase, letterspaced — every section carries one. */
export function Kicker({ children, tone = "blue" }: { children: ReactNode; tone?: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: `var(--${tone})` }}>
      {children}
    </p>
  );
}
