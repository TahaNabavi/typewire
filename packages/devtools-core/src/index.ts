/**
 * @tahanabavi/type-devtools-core
 * ==============================
 * Transport-agnostic inspector bridge. Knows nothing about HTTP or WS — each
 * transport plugs in as a Source (e.g. connectTypeFetch, connectTypeSocket).
 *
 * Scaffold — see ../../docs/ARCHITECTURE.md for the full bridge design.
 */

/** Which transport produced an event. Open string so new sources can be added. */
export type InspectorSource = "http" | "ws" | (string & {});

/**
 * A generic, source-tagged inspector event. Each transport maps its own events
 * (typefetch `RequestEvent`, typesocket frames, …) into this shape so the panel
 * can render one unified, source-tagged timeline.
 */
export interface InspectorEvent {
  source: InspectorSource;
  kind: string;
  /** Correlates related events (e.g. a request's start/success/error). */
  id: string;
  /** Timestamp (ms). */
  ts: number;
  payload: unknown;
}

export const version = "0.0.0";
