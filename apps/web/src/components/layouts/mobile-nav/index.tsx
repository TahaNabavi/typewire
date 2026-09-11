'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'

import { CopyButton } from '@/components/ui/copy-button'
import { nav } from '@/config/site'
import { install } from '@/lib/registry'

/**
 * Below `md` the header nav is hidden, which left phones with no way to reach
 * any page but the one they landed on. This is that way: a disclosure panel
 * under the header bar rather than a full-screen overlay, so the wordmark and
 * theme toggle stay put and the page never loses its place.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false)

  // A route change unmounts nothing here (the header is in the layout), so the
  // panel has to be told to close itself.
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="rounded-lg border border-hair p-2 text-muted-foreground transition-colors hover:border-hair-strong hover:text-fg md:hidden"
      >
        {open ? (
          <X className="size-4" aria-hidden />
        ) : (
          <Menu className="size-4" aria-hidden />
        )}
      </button>

      {open && (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-14 origin-top border-b border-hair bg-canvas/95 backdrop-blur-md duration-(--motion-panel) ease-(--ease-spring) animate-in fade-in slide-in-from-top-2 md:hidden"
        >
          <nav className="mx-auto flex max-w-[1200px] flex-col px-6 py-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-hair py-3 text-sm text-muted-foreground transition-colors last:border-0 hover:text-fg"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mx-auto flex max-w-[1200px] items-center gap-2 px-6 pb-4">
            <code className="flex-1 truncate rounded-lg border border-hair px-3 py-2 font-mono text-xs text-muted-foreground">
              {install.primary}
            </code>
            <CopyButton value={install.primary} label="copy" />
          </div>
        </div>
      )}
    </>
  )
}
