'use client'

import { create } from 'zustand'

/**
 * The package grid's filter.
 *
 * Server data never enters this store — the packages themselves are rendered on
 * the server from the derived registry, and only the category and query cross
 * to the client.
 */

interface PackageFilterState {
  category: string
  setCategory: (category: string) => void
  query: string
  setQuery: (query: string) => void
}

export const usePackageFilter = create<PackageFilterState>((set) => ({
  category: 'All',
  setCategory: (category) => set({ category }),
  query: '',
  setQuery: (query) => set({ query }),
}))
