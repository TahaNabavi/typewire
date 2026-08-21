/**
 * Merge an `extends` base with the config that extends it.
 *
 * Plain objects merge key by key; everything else is replaced. Arrays are
 * replaced rather than concatenated — a base listing `formats: ["markdown",
 * "json"]` must be *overridable* down to `["json"]`, and a concatenating merge
 * makes that impossible to express.
 *
 * `contracts` is a plain object too, so a base's contracts and a child's merge
 * module by module. That is the behaviour a monorepo wants: shared modules in
 * the base, package-specific ones in the leaf.
 */
export function mergeConfig<T>(base: T, override: T): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;

  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeConfig(current, value)
        : value;
  }

  return result as T;
}

/**
 * Zod schemas, class instances and functions must never be walked into — a
 * merged-together zod schema is not a zod schema. Only object literals qualify.
 *
 * Deliberately **not** `getPrototypeOf(value) === Object.prototype`: jiti
 * evaluates a config file in its own realm, so every object literal in
 * `typewire.config.ts` has a *different* `Object.prototype` than this module's.
 * The identity check passes for hand-built test fixtures and fails for every
 * real config file, which makes `extends` silently stop merging — the base's
 * `lint.rules` vanish instead of combining.
 *
 * So: an object literal is one whose prototype chain is at most one link deep
 * and ends at something named `Object`. A class instance's chain is longer, and
 * `Object.create(null)` has none at all.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;

  const proto = Object.getPrototypeOf(value) as Record<string, unknown> | null;
  if (proto === null) return true;
  if (Object.getPrototypeOf(proto) !== null) return false;

  const constructor = proto.constructor;
  return typeof constructor === "function" && constructor.name === "Object";
}
