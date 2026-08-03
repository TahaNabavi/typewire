import {
  type AnyQuerySource,
  type InferInput,
  type InferOutput,
  type MutationObserver,
  type MutationObserverOptions,
  type MutationObserverResult,
} from "@tahanabavi/typefetch-query-core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "./context";

/**
 * A write against one endpoint, plus whatever invalidation the client declares
 * for it. Returns `mutate` (fire and forget) and `mutateAsync` (awaitable).
 *
 * For an upload, pass `trackProgress` and read `result.progress` — it is part
 * of the observer's state, so each tick re-renders through the same
 * `useSyncExternalStore` subscription as `data` and `error`. No extra hook, and
 * no `useState` of your own:
 *
 * ```tsx
 * const upload = useMutation(api.file.upload, { trackProgress: "upload" });
 *
 * <progress value={upload.progress?.upload?.percent ?? 0} max={100} />
 * ```
 *
 * `percent` is `undefined` when the transfer length is unknown — render an
 * indeterminate bar for that case rather than treating it as zero.
 */
export function useMutation<E extends AnyQuerySource>(
  endpoint: E,
  options?: MutationObserverOptions<InferOutput<E>, Error, InferInput<E>>,
): MutationObserverResult<InferOutput<E>, Error, InferInput<E>> {
  const client = useQueryClient();

  const observerRef = useRef<MutationObserver<
    InferInput<E>,
    InferOutput<E>,
    Error
  > | null>(null);
  if (observerRef.current === null) {
    observerRef.current = client.watchMutation(endpoint, options);
  }
  const observer = observerRef.current;

  // Refresh every render: `onSuccess` and friends close over props and state,
  // so a stale copy would call yesterday's setState. Cheap — this only swaps a
  // reference and never notifies.
  observer.setOptions(options ?? {});

  const subscribe = useCallback(
    (onStoreChange: () => void) => observer.subscribe(onStoreChange),
    [observer],
  );
  const getSnapshot = useCallback(() => observer.getSnapshot(), [observer]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
