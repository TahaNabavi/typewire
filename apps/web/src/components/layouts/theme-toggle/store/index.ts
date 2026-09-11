'use client'

import { create } from 'zustand'

/**
 * The theme slice.
 *
 * Owned by the theme feature rather than a shared UI store: nothing else on the
 * site reads it, and the pre-paint script in the layout — not React — is what
 * decides the first frame. This store adopts that decision on hydrate.
 */

export type Theme = 'dark' | 'light'

const THEME_KEY = 'typewire-theme'

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* private mode — the theme just does not persist */
  }
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  /** Adopt whatever the pre-paint script already put on <html>. */
  hydrateTheme: () => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  // Matches what the layout renders with no stored preference, so first paint
  // and first render agree and there is nothing to flash.
  theme: 'light',
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  hydrateTheme: () => {
    if (typeof document === 'undefined') return
    const attr = document.documentElement.getAttribute('data-theme')
    const theme: Theme = attr === 'dark' ? 'dark' : 'light'
    if (theme !== get().theme) set({ theme })
  },
}))
