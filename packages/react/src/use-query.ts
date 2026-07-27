import {
  hashKey,
  resolveSourceId,
  type AnyQuerySource,
  type InferInput,
  type InferOutput,
  type QueryObserver,
  type QueryObserverOptions,
  type QueryObserverResult,
} from "@tahanabavi/typefetch-query-core";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "./context";

/**
 * Subscribe to one endpoint+input.
 *
 * The daily call site the second design law freezes: two arguments, no cache
 * keys. Everything configurable lives in `options` or on the client, never as a
 * new positional parameter here.
 */
export function useQuery<E extends AnyQuerySource, TSelected = InferOutput<E>>(
  endpoint: E,
  input: InferInput<E>,
  options?: QueryObserverOptions<InferOutput<E>, Error, TSelected>,
): QueryObserverResult<TSelected, Error> {
  const client = useQueryClient();

  const observerRef = useRef<QueryObserver<
    InferOutput<E>,
    Error,
    TSelected
  > | null>(null);
  if (observerRef.current === null) {
    observerRef.current = client.watchQuery(endpoint, input, options);
  }
  const observer = observerRef.current;

  // Rebind during render rather than in an effect: an effect would leave one
  // paint showing the *previous* input's data before correcting itself.
  // `update` is silent by contract — it refreshes the snapshot but never
  // notifies or fetches, so nothing touches React's store mid-render.
  const signature = `${resolveSourceId(endpoint)}|${hashKey(input)}`;
  observer.update(input, options ?? {});

  const subscribe = useCallback(
    (onStoreChange: () => void) => observer.subscribe(onStoreChange),
    [observer],
  );
  const getSnapshot = useCallback(() => observer.getSnapshot(), [observer]);

  // The same snapshot serves the server: it is the observer's cached result
  // object, so hydration compares equal instead of tearing.
  const result = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The fetch decision belongs in the commit phase. On mount `subscribe` has
  // already made it; this covers every later input change.
  useEffect(() => {
    observer.sync();
  }, [observer, signature]);

  return result;
}
