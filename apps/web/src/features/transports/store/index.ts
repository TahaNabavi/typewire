'use client'

import { create } from 'zustand'

/**
 * Which wire the transport section is showing.
 *
 * It lives in a store rather than in props because the tab strip and the panes
 * are rendered by different components — the panes are server-highlighted and
 * cannot own client state.
 */

export type TransportTab = 'REST' | 'GraphQL' | 'gRPC' | 'WebSocket'

interface TransportState {
  transport: TransportTab
  setTransport: (tab: TransportTab) => void
}

export const useTransport = create<TransportState>((set) => ({
  transport: 'REST',
  setTransport: (transport) => set({ transport }),
}))
