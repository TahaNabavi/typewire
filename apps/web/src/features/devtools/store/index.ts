'use client'

import { create } from 'zustand'

/**
 * The devtools preview's own state.
 *
 * Hovering a wire in the legend dims that wire everywhere in the panel at once,
 * which is why the focus is a store value rather than local state: the legend
 * and the timeline rows are siblings.
 */

/** The wire names the legend dims by — must match TRANSPORT_LABEL. */
export type WireName = 'HTTP' | 'GraphQL' | 'gRPC' | 'WebSocket'

interface DevtoolsState {
  wireFocus: WireName | null
  setWireFocus: (wire: WireName | null) => void
}

export const useDevtools = create<DevtoolsState>((set) => ({
  wireFocus: null,
  setWireFocus: (wireFocus) => set({ wireFocus }),
}))
