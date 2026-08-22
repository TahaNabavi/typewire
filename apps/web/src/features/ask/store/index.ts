"use client";

import { create } from "zustand";

/** Where the answer stream currently is. */
export type AskState = "idle" | "streaming" | "done";

interface AskStoreState {
  ask: AskState;
  setAsk: (state: AskState) => void;
  question: string;
  setQuestion: (question: string) => void;
}

export const useAsk = create<AskStoreState>((set) => ({
  ask: "idle",
  setAsk: (ask) => set({ ask }),
  question: "",
  setQuestion: (question) => set({ question }),
}));
