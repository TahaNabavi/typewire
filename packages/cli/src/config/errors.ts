/**
 * A configuration problem, as distinct from a finding.
 *
 * `docs/CLI.md` §4 fixes the exit codes: `0` ok, `1` findings, `2`
 * misconfiguration. A CI job that gates on `lint` failing needs to tell "your
 * contracts have problems" apart from "your config file is broken" — the first
 * is the author's job to fix, the second is the pipeline's.
 */
export class TypeWireConfigError extends Error {
  /** Always 2. Kept as a field so `bin.ts` never has to pattern-match. */
  readonly exitCode = 2;

  /** The config file the problem was found in, when there is one. */
  readonly source: string | undefined;

  /** Dotted key path inside the config, e.g. `typefetch.contracts`. */
  readonly key: string | undefined;

  constructor(
    message: string,
    options: { source?: string; key?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : {});
    this.name = "TypeWireConfigError";
    this.source = options.source;
    this.key = options.key;
  }
}

/**
 * Point at the offending key rather than saying "invalid config".
 *
 * `docs/CLI.md` §2 calls this out specifically. The difference between
 * `Invalid TypeFetch config at /repo/typewire.config.ts` and
 * `typewire.config.ts › typefetch.contracts — expected an object, received undefined`
 * is whether the user has to bisect their own file.
 */
export function configError(
  key: string,
  problem: string,
  source: string,
): TypeWireConfigError {
  return new TypeWireConfigError(`${short(source)} › ${key} — ${problem}`, {
    source,
    key,
  });
}

/** `/long/absolute/path/typewire.config.ts` → `typewire.config.ts`. */
function short(source: string): string {
  return source.split(/[\\/]/).pop() ?? source;
}

export function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  if (typeof value === "function") return "a function";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  return String(value);
}
