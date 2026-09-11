import type { ReactNode } from 'react'

import { Kicker } from '@/components/ui/kicker'
import { Container } from '@/components/ui/container'
import { cn } from '@/utils'

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
  id?: string
  kicker?: string
  title?: string
  lede?: string
  /** Alternates the background so the page has cadence. */
  alt?: boolean
  children?: ReactNode
}) {
  const showHeader =
    (kicker !== null && kicker !== undefined && kicker !== '') ||
    (title !== null && title !== undefined && title !== '')

  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-20 border-t border-hair py-20 md:py-28',
        alt !== null && alt !== undefined && alt === true
          ? 'bg-surface-alt/40'
          : undefined
      )}
    >
      <Container>
        {showHeader ? (
          <header className="enter-group mb-12 max-w-3xl">
            {kicker !== null && kicker !== undefined && kicker !== '' && (
              <Kicker>{kicker}</Kicker>
            )}
            {title !== null && title !== undefined && title !== '' && (
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-fg md:text-4xl">
                {title}
              </h2>
            )}
            {lede !== null && lede !== undefined && lede !== '' && (
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                {lede}
              </p>
            )}
          </header>
        ) : null}
        {children}
      </Container>
    </section>
  )
}
