'use client'

import { useEffect } from 'react'

import { useTheme } from '@/components/layouts/theme-toggle/store'

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const hydrateTheme = useTheme((s) => s.hydrateTheme)

  // The pre-paint script in the layout has already applied the stored choice;
  // this just tells the store what it did, after hydration.
  useEffect(() => hydrateTheme(), [hydrateTheme])

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      className="rounded-lg border border-hair px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-hair-strong hover:text-fg"
    >
      {theme === 'light' ? 'light' : 'dark'}
    </button>
  )
}
