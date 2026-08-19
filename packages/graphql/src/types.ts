import type { TransportDescription } from "@tahanabavi/typefetch";

/**
 * GraphQL endpoint fields
 * =======================
 * Registered into typefetch's open `TransportRegistry` by the module
 * augmentation below, so `transport: "graphql"` does not compile until this
 * package is a dependency — and once it is, a GraphQL route is fully checked,
 * including that it may not carry `path` or `method`.
 */
export type GraphqlEndpointFields = {
  /**
   * Which GraphQL operation this is.
   *
   * Not cosmetic: it is what allows a `"query"` to travel over GET when the
   * transport is configured for it (CDN-cacheable), and what a query engine
   * reads to tell a read from a write.
   */
  operation: "query" | "mutation";

  /**
   * The operation document.
   *
   * **Optional on purpose.** When omitted, the selection set is generated from
   * the `response` schema, so the shape that validates the data and the shape
   * that requests it cannot drift. Supply it explicitly for anything the
   * generator refuses — fragments, aliases, unions, directives, or arguments on
   * nested fields.
   */
  document?: string;

  /**
   * The operation name. Inferred from `document` when it declares one, else from
   * the endpoint id. Sent alongside the query so server logs and APQ keys are
   * meaningful.
   */
  operationName?: string;

  /**
   * The single root field to unwrap before validating.
   *
   * With `root: "user"`, `response` describes `data.user` rather than `data`, so
   * schemas stay as tight as they are for REST instead of every one gaining an
   * outer wrapper key. It is also what lets a generated document know which
   * field to attach the variables to as arguments.
   */
  root?: string;

  /**
   * GraphQL types for the variables, by name — `{ id: "ID!" }`.
   *
   * Only needed where the Zod type is not enough to name the GraphQL one. The
   * classic case is `ID`: `z.string()` generates `String!`, and a server
   * expecting `ID!` rejects it. Object inputs always need an entry, since a Zod
   * object cannot name a GraphQL input type.
   */
  variableTypes?: Record<string, string>;

  /**
   * What to do when the server answers with **both** `data` and `errors`.
   *
   * - `"none"` (default) — throw. A partially-failed response is a failed one,
   *   and silently returning half a result is how a null slips into a UI three
   *   screens away from the cause.
   * - `"all"` — resolve the data and hand the errors to the transport's
   *   `onPartialErrors` callback. The return type stays `Promise<T>` rather than
   *   forcing every call site to unpack a result object.
   */
  errorPolicy?: "none" | "all";
};

declare module "@tahanabavi/typefetch" {
  interface TransportRegistry {
    graphql: GraphqlEndpointFields;
  }
}

/** One entry of a GraphQL response's `errors` array. */
export type GraphqlError = {
  message: string;
  path?: ReadonlyArray<string | number>;
  locations?: ReadonlyArray<{ line: number; column: number }>;
  extensions?: Record<string, unknown> & { code?: string };
};

/** The body shape of a GraphQL-over-HTTP response. */
export type GraphqlResponseBody = {
  data?: unknown;
  errors?: GraphqlError[];
  extensions?: Record<string, unknown>;
};

export type GraphqlTransportConfig = {
  /**
   * The endpoint URL. Defaults to the client's `baseUrl` + `/graphql`, which is
   * the convention often enough to be worth not repeating.
   */
  url?: string;

  /**
   * Send queries over GET (`?query=…&variables=…`), which makes them
   * CDN-cacheable. Mutations always POST — a mutation over GET is a cache
   * poisoning waiting to happen. Defaults to `"POST"`.
   */
  method?: "POST" | "GET";

  /** Default `errorPolicy` for endpoints that do not declare one. */
  errorPolicy?: "none" | "all";

  /**
   * Called when `errorPolicy: "all"` resolves data that arrived alongside
   * errors. Without this the errors are dropped, which is the one outcome worse
   * than throwing.
   */
  onPartialErrors?: (
    errors: readonly GraphqlError[],
    info: { endpointId: string; route: TransportDescription },
  ) => void;

  /** Extra headers on every GraphQL request. */
  headers?: Record<string, string>;
};
