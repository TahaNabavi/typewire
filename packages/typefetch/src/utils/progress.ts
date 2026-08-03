import type { ProgressHandler, TransferProgress } from "../types";

/**
 * Build a {@link TransferProgress} tick.
 *
 * `total` is only trusted when it is a positive finite number: XHR reports `0`
 * for an unknown length, and a `Content-Length` header can be missing, empty,
 * or non-numeric. Dividing by any of those yields `Infinity` or `NaN`, which is
 * worse in a progress bar than admitting the length is unknown — so those cases
 * collapse to `lengthComputable: false` and omit `total`/`percent` entirely.
 */
export function toProgress(
  phase: "upload" | "download",
  loaded: number,
  total: number | undefined,
  lengthComputable = true,
): TransferProgress {
  const hasTotal =
    lengthComputable &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0;

  if (!hasTotal) {
    return { phase, loaded, lengthComputable: false };
  }

  return {
    phase,
    loaded,
    total,
    // Two decimals: enough to animate smoothly on a large file, without
    // emitting a distinct value for every packet.
    percent: Math.round(Math.min(loaded / total!, 1) * 10000) / 100,
    lengthComputable: true,
  };
}

/**
 * Invoke a progress handler without letting it affect the request.
 *
 * A throwing progress callback is a UI bug (a bad `setState`, an unmounted
 * component); it must not reject the upload the user is watching. Report it and
 * carry on.
 */
export function safeProgress(
  handler: ProgressHandler | undefined,
  progress: TransferProgress,
): void {
  if (!handler) return;
  try {
    handler(progress);
  } catch (err) {
    console.error("[typefetch] progress handler threw:", err);
  }
}
