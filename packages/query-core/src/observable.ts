/**
 * The universal reactivity contract. Everything the UI reads implements this;
 * framework adapters bind it natively (React `useSyncExternalStore`, Vue
 * `shallowRef`, Angular signals). The core never imports a framework.
 */
export interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * A synchronous listener set with unsubscribe.
 *
 * Iteration runs over a copy because a listener is allowed to unsubscribe
 * itself (or another listener) while being notified — mutating the live Set
 * mid-iteration would silently skip the following listener.
 */
export class Notifier {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** How many listeners are currently attached. Drives garbage collection. */
  get size(): number {
    return this.listeners.size;
  }

  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
