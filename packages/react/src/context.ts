import type { QueryClient } from "@tahanabavi/typefetch-query-core";
import { createContext, createElement, useContext, type ReactNode } from "react";

const QueryClientContext = createContext<QueryClient | null>(null);

export interface TypeFetchProviderProps {
  client: QueryClient;
  children?: ReactNode;
}

/**
 * Puts one `QueryClient` in scope for the tree below.
 *
 * Written with `createElement` rather than JSX so the package stays plain
 * TypeScript — a single provider element is not worth a JSX build config in a
 * package this thin.
 */
export function TypeFetchProvider({ client, children }: TypeFetchProviderProps) {
  return createElement(QueryClientContext.Provider, { value: client }, children);
}

/** The client from the nearest provider. Throws when there is none. */
export function useQueryClient(): QueryClient {
  const client = useContext(QueryClientContext);
  if (!client) {
    throw new Error(
      "No QueryClient found. Wrap your tree in <TypeFetchProvider client={...}>.",
    );
  }
  return client;
}
