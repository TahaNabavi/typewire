/**
 * Turning arbitrary payloads into text, defensively. A logged value can be an
 * `Error`, a cycle, a `BigInt`, a `Map` — anything the app happened to pass — so
 * the inspector must always produce a string rather than throw inside the app it
 * is debugging.
 */
export function safeStringify(value: unknown, space: number | string = 2): string {
  try {
    if (value instanceof Error) {
      return value.stack ?? `${value.name}: ${value.message}`;
    }
    const seen = new WeakSet<object>();
    return JSON.stringify(value, makeReplacer(seen), space);
  } catch {
    return String(value);
  }
}

/** Compact one-line form, for row summaries. */
export function safeStringifyInline(value: unknown): string {
  return safeStringify(value, 0).replace(/\n/g, " ");
}

function makeReplacer(seen: WeakSet<object>) {
  return function replacer(this: unknown, _key: string, value: unknown): unknown {
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (value instanceof Map) return Object.fromEntries(value);
    if (value instanceof Set) return [...value];
    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

/** Copy text to the clipboard, guarded. Resolves to whether it succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission or an insecure context: fall through to failure.
  }
  return false;
}

/** Trigger a file download of `text`, guarded for non-DOM environments. */
export function downloadText(filename: string, text: string): void {
  try {
    if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
      return;
    }
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Best-effort: a blocked download should not crash the panel.
  }
}
