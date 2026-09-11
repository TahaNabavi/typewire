import type { ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { cn } from '@/utils'

/**
 * shadcn's Card, wearing the brand: the panel gradient, a hairline border in
 * place of the default ring, and the deep soft shadow from the banners.
 *
 * Named Panel rather than Card so the branded surface and the shadcn primitive
 * it is built from can be told apart at the import site.
 *
 * Horizontal padding is applied here because shadcn leaves it to CardContent,
 * and most panels on this site are a single block of content rather than a
 * header/content/footer stack.
 */
export function Panel({
  className,
  children,
  dashed,
}: {
  className?: string
  children: ReactNode
  /** Marks something provisional — an unpublished package, an empty slot. */
  dashed?: boolean
}) {
  return (
    <Card
      className={cn(
        'gap-0 border bg-linear-to-b from-panel to-panel-2 px-(--card-spacing) ring-0',
        'shadow-[0_30px_70px_-34px_rgba(0,0,0,0.7)]',
        dashed !== null && dashed !== undefined && dashed === true
          ? 'border-dashed border-hair-strong'
          : 'border-hair',
        className
      )}
    >
      {children}
    </Card>
  )
}
