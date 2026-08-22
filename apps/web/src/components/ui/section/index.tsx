import type { ReactNode } from "react";

import { Kicker } from "@/components/ui/kicker";
import { Container } from "@/components/ui/container";
import { cn } from "@/utils";

/**
 * The page's rhythm: a full-width band, a hairline rule above it, and an
 * optional kicker/title/lede header. Feature organisms supply the body and
 * never lay out the band themselves.
 */
export function Section({
  id,
  kicker,
  title,
  lede,
  alt,
  children,
}: {
  id?: string;
  kicker?: string;
  title?: string;
  lede?: string;
  /** Alternates the background so the page has cadence. */
  alt?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn("scroll-mt-20 border-t border-hair py-20 md:py-28", alt && "bg-surface-alt/40")}
    >
      <Container>
        {(kicker || title) && (
          <header className="enter-group mb-12 max-w-3xl">
            {kicker && <Kicker>{kicker}</Kicker>}
            {title && (
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-fg md:text-4xl">
                {title}
              </h2>
            )}
            {lede && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{lede}</p>}
          </header>
        )}
        {children}
      </Container>
    </section>
  );
}
