import type { DeepEncryptionMap, EncryptionMethod } from "@tahanabavi/typefetch";

/**
 * The following helpers are ported **verbatim** from the typefetch client's
 * `encryptionMiddleware`. Keeping the traversal identical guarantees the
 * backend walks a `DeepEncryptionMap` exactly as the client did, so the same
 * fields are transformed on both ends.
 */

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function hasKey(value: unknown, key: string): value is Record<string, unknown> {
  return (
    isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key)
  );
}

export async function processDeep<T = unknown>(
  data: unknown,
  map: DeepEncryptionMap | null | undefined,
  defaultMethod: EncryptionMethod,
  transform: (value: unknown, method: EncryptionMethod) => Promise<unknown>,
): Promise<T> {
  if (data == null || map == null) return data as T;

  if (typeof map === "string") return (await transform(data, map)) as T;

  if (typeof map === "boolean") {
    return (map ? await transform(data, defaultMethod) : data) as T;
  }

  if (Array.isArray(data)) {
    if (!Array.isArray(map)) {
      return Promise.all(
        data.map((item) => processDeep(item, map, defaultMethod, transform)),
      ) as Promise<T>;
    }

    return Promise.all(
      data.map((item, idx) =>
        processDeep(item, map[idx] ?? map[0], defaultMethod, transform),
      ),
    ) as Promise<T>;
  }

  if (isPlainObject(data) && isPlainObject(map)) {
    const result: Record<string, unknown> = { ...data };

    for (const key of Object.keys(map)) {
      const childMap = (map as Record<string, DeepEncryptionMap>)[key];
      if (childMap == null) continue;

      const currentVal = result[key];
      if (currentVal !== undefined) {
        result[key] = await processDeep(
          currentVal,
          childMap,
          defaultMethod,
          transform,
        );
      }
    }

    return result as T;
  }

  return data as T;
}

/**
 * A request encryption map may target body fields directly
 * (`{ password: true }`) or nest them under `body` (`{ body: { password:
 * true } }`). The client applies the map to the JSON body, so the backend —
 * whose `req.body` is that same body — unwraps the `body` key identically.
 */
export function getRequestBodyMap(map: DeepEncryptionMap): DeepEncryptionMap {
  if (hasKey(map, "body")) {
    return map.body as DeepEncryptionMap;
  }
  return map;
}
