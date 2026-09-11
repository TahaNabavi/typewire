import type { ReactNode } from 'react'

import { cn } from '@/utils'

/**
 * The site's one small label. Feature-agnostic: it knows a colour and a shape,
 * never what is being labelled — see the packages feature for the chips that
 * carry domain meaning.
 */
export function Chip({
  children,
  tone,
  dashed,
  className,
  title,
}: {
  children: ReactNode
  /** Any CSS colour — usually a token like var(--green). */
  tone?: string
  dashed?: boolean
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.05em]',
        dashed !== null && dashed !== undefined && dashed === true
          ? 'border-dashed'
          : '',
        className
      )}
      style={
        tone !== null && tone !== undefined && tone !== ''
          ? {
              color: tone,
              borderColor: `color-mix(in oklab, ${tone} 30%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${tone} 10%, transparent)`,
            }
          : {
              color: 'var(--muted-foreground)',
              borderColor: 'var(--hair-strong)',
            }
      }
    >
      {children}
    </span>
  )
}
